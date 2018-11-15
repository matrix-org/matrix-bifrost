import { Bridge, MatrixRoom, RemoteUser, MatrixUser } from "matrix-appservice-bridge";
import { IEventRequest, IBridgeContext, IEventRequestData } from "./MatrixTypes";
import { IMatrixRoomData, MROOM_TYPE_UADMIN, MROOM_TYPE_IM, MROOM_TYPE_GROUP } from "./StoreTypes";
import { PurpleInstance, PurpleProtocol } from "./purple/PurpleInstance";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import * as marked from "marked";
import { PurpleAccount } from "./purple/PurpleAccount";
import { Util } from "./Util";
import { Logging } from "matrix-appservice-bridge";
import { Deduplicator } from "./Deduplicator";
const log = Logging.get("MatrixEventHandler");

const RETRY_JOIN_MS = 5000;

/**
 * Handles events coming into the appservice.
 */
export class MatrixEventHandler {
    private bridge: Bridge;

    constructor(
        private purple: IPurpleInstance,
        private deduplicator: Deduplicator,
    ) {
    }

    /**
     * Set the bridge for us to use. This must be called after MatrixEventHandler
     * has been created.
     * @return [description]
     */
    public setBridge(bridge: Bridge) {
        this.bridge = bridge;
    }

    public async onEvent(request: IEventRequest, context: IBridgeContext) {
        const roomType: string|null = context.rooms.matrix ? context.rooms.matrix.get("type") : null;
        const event = request.getData();
        log.debug("Got event (id, type, sender, roomtype):", event.event_id, event.type, event.sender, roomType);
        const botUserId = this.bridge.getBot().client.getUserId();
        if (!roomType && event.content.membership === "invite" && event.state_key === botUserId) {
            try {
                await this.handleInviteForBot(event);
            } catch (e) {
                log.error("Failed to handle invite for bot:", e);
            }
            return;
        }

        if (roomType === MROOM_TYPE_UADMIN) {
            if (event.type === "m.room.message") {
                const args = event.content.body.split(" ");
                await this.handleCommand(args, event);
            } else if (event.content.membership === "leave") {
                await this.bridge.getRoomStore().removeEntriesByMatrixRoomId(event.room_id);
                await this.bridge.getIntent().leave(event.room_id);
                log.info(`Left and removed entry for ${event.room_id} because the user left`);
            }
            return;
        }

        // Validate room entries
        const roomProtocol = context.rooms.remote.get("protocol_id");
        if (roomProtocol == null) {
            log.error("Room protocol was null, we cannot handle this im!");
            return;
        }

        if (event.type === "m.room.member" && roomType === MROOM_TYPE_GROUP) {
            if (this.bridge.getBot().isRemoteUser(event.sender)) {
                return; // Don't really care about remote users
            }
            if (["join", "leave"].includes(event.content.membership)) {
                this.handleJoinLeaveGroup(context, event);
            }
        }

        if (event.type !== "m.room.message") {
            // We are only handling bridged room messages now.
            return;
        }

        if (roomType === MROOM_TYPE_IM) {
            await this.handleImMessage(context, event);
            return;
        }

        if (roomType === MROOM_TYPE_GROUP) {
            await this.handleGroupMessage(context, event);
            return;
        }
    }

    /* NOTE: Command handling should really be it's own class, but I am cutting corners.*/
    private async handleCommand(args: string[], event: IEventRequestData) {
        log.debug(`Handling command from ${event.sender} ${args.join(" ")}`);
        const intent = this.bridge.getIntent();
        if (args[0] === "protocols" && args.length === 1) {
            const protocols = this.purple.getProtocols();
            let body = "Available protocols:\n";
            body += protocols.map((plugin: PurpleProtocol) =>
                ` \`${plugin.name}\` - ${plugin.summary}`,
            ).join("\n");
            await intent.sendMessage(event.room_id, {
                msgtype: "m.notice",
                body,
                format: "org.matrix.custom.html",
                formatted_body: marked(body),
            });
        } else if (args[0] === "protocols" && args.length === 2) {
            await intent.sendMessage(event.room_id, {
                msgtype: "m.notice",
                body: "\/\/Placeholder",
            });
        } else if (args[0] === "accounts" && args.length === 1) {
            const users = await this.bridge.getUserStore().getRemoteUsersFromMatrixId(event.sender);
            let body = "Linked accounts:\n";
            body += users.map((remoteUser: RemoteUser) => {
                const pid = remoteUser.get("protocolId");
                const username = remoteUser.get("username");
                let account: PurpleAccount|null = null;
                try {
                    account = this.purple.getAccount(username, pid);
                } catch (ex) {
                    log.error("Account not found:", ex);
                }
                if (account) {
return `- ${account.protocol.name} (${username}) [Enabled=${account.isEnabled}] [Connected=${account.connected}]`;
                } else {
                    return `- ${pid} [Protocol not enabled] (${username})`;
                }
            }).join("\n");
            await intent.sendMessage(event.room_id, {
                msgtype: "m.notice",
                body,
                format: "org.matrix.custom.html",
                formatted_body: marked(body),
            });
        } else if (args[0] === "accounts" && args[1] === "add") {
            try {
                await this.handleNewAccount(args[2], args.slice(3), event);
            } catch (err) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "Failed to add account:" + err.message,
                });
            }
        } else if (args[0] === "accounts" && ["enable", "disable"].includes(args[1])) {
            try {
                await this.handleEnableAccount(args[2], args[3], args[1] === "enable");
                // Refresh our cache
                this.purple.getAccount(args[3], args[2]);
            } catch (err) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "Failed to enable account:" + err.message,
                });
            }
        } else if (args[0] === "accounts" && args[1] === "add-existing") {
            try {
                await this.handleAddExistingAccount(args[2], args[3], event);
            } catch (err) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "Failed to enable account:" + err.message,
                });
            }
        } else if (args[0] === "help") {
            const body = `
- \`protocols\` List available protocols.
- \`protocol $PROTOCOL\` List details about a protocol, including account options.
- \`accounts\` List accounts mapped to your matrix account.
- \`accounts add $PROTOCOL ...$OPTS\` Add a new account, this will take some options given.
- \`accounts add-existing $PROTOCOL $NAME\` Add an existing account from accounts.xml.
- \`accounts enable|disable $PROTOCOL $USERNAME\` Enables or disables an account.
- \`help\` This help prompt
`;
            await intent.sendMessage(event.room_id, {
                msgtype: "m.notice",
                body,
                format: "org.matrix.custom.html",
                formatted_body: marked(body),
            });
        } else {
            await intent.sendMessage(event.room_id, {
                msgtype: "m.notice",
                body: "Command not understood",
            });
        }
    }

    private async handleInviteForBot(event: IEventRequestData) {
        log.info(`Got invite from ${event.sender} to ${event.room_id}`);
        const intent = this.bridge.getIntent();
        try {
            await intent.join(event.room_id);
        } catch (e) {
            log.warn("Failed to join room, retrying in ", RETRY_JOIN_MS);
            await new Promise((reject, resolve) => {
                setTimeout(() => {
                    intent.join(event.room_id).then(resolve).catch(reject);
                }, RETRY_JOIN_MS);
            });
        }
        // Check to see if it's a 1 to 1.
        const members = await this.bridge.getBot().getJoinedMembers(event.room_id);
        if (members.length > 2) {
            log.info("Room is not a 1 to 1 room: Treating as a potential plumbable room.");
            // This is not a 1 to 1 room, so just keep us joined for now. We might want it later.
            return;
        }
        const roomStore = this.bridge.getRoomStore();
        const mxRoom = new MatrixRoom(event.room_id);
        mxRoom.set("type", MROOM_TYPE_UADMIN);
        await roomStore.setMatrixRoom(mxRoom);
        log.info("Created new 1 to 1 admin room");
        const body = `
Hello! This is the bridge bot for communicating with protocols via libpurple.
To begin, say \`protocols\` to see a list of protocols.
You can then connect your account to one of these protocols via \`create $PROTOCOL ..opts\`
See \`protocol $PROTOCOL\` for help on what options they take.
Say \`help\` for more commands.
`;
        await intent.sendMessage(event.room_id, {
            msgtype: "m.notice",
            body,
            format: "org.matrix.custom.html",
            formatted_body: marked(body),
        });
    }

    private async handleNewAccount(nameOrId: string, args: string[], event: IEventRequestData) {
        // TODO: Check to see if the user has an account matching this already.
        const protocol = this.purple.findProtocol(nameOrId);
        if (protocol === undefined) {
            throw new Error("Protocol was not found");
        }
        if (args[0] === undefined) {
            throw new Error("You need to specify a username");
        }
        const account = new PurpleAccount(args[0], protocol);
        account.createNew();
        const userStore = this.bridge.getUserStore();
        const mxUser = new MatrixUser(event.sender);
        const remoteUser = new RemoteUser(Util.createRemoteId(protocol.name, args[0]));
        remoteUser.set("protocolId", protocol.id);
        remoteUser.set("username", args[0]);
        await userStore.linkUsers(mxUser, remoteUser);
        await this.bridge.getIntent().sendMessage(event.room_id, {
            msgtype: "m.notice",
            body: "Created new account",
        });
    }

    private async handleAddExistingAccount(protocolId: string, name: string, event: IEventRequestData) {
        // TODO: Check to see if the user has an account matching this already.
        if (protocolId === undefined) {
            throw new Error("You need to specify a protocol");
        }
        if (name === undefined) {
            throw new Error("You need to specify a name");
        }
        const protocol = this.purple.findProtocol(protocolId);
        if (protocol === undefined) {
            throw new Error("Protocol was not found");
        }
        const account = new PurpleAccount(name, protocol);
        const userStore = this.bridge.getUserStore();
        const mxUser = new MatrixUser(event.sender);
        const remoteUser = new RemoteUser(Util.createRemoteId(protocol.id, name));
        remoteUser.set("protocolId", protocol.id);
        remoteUser.set("username", name);
        await userStore.linkUsers(mxUser, remoteUser);
        await this.bridge.getIntent().sendMessage(event.room_id, {
            msgtype: "m.notice",
            body: "Linked existing account",
        });
    }

    private async handleEnableAccount(protocolId: string, username: string, enable: boolean) {
        const protocol = this.purple.findProtocol(protocolId);
        if (!protocol) {
            throw Error("Protocol not found");
        }
        const acct = this.purple.getAccount(username, protocol.id);
        if (acct === null) {
            throw Error("Account not found");
        }
        acct.setEnabled(enable);
    }

    private async handleImMessage(context: IBridgeContext, event: IEventRequestData) {
        log.info("Handling IM message");
        const roomProtocol = context.rooms.remote.get("protocol_id");
        const remoteUser = context.senders.remotes.find((remote) => remote.get("protocolId") === roomProtocol);
        if (remoteUser == null) {
            log.error("Could not find a purple account for this matrix user, we cannot handle this im!");
            return;
        }
        // XXX: We assume the first remote, this needs to be fixed for multiple accounts
        const acct = this.purple.getAccount(remoteUser.get("username"), roomProtocol);
        if (!acct) {
            log.error("Account wasn't found in libpurple, we cannot handle this im!");
            return;
        }
        if (!acct.isEnabled) {
            log.error("Account isn't enabled, we cannot handle this im!");
            return;
        }
        log.info(`Sending IM to ${context.rooms.remote.get("recipient")}`);
        acct.sendIM(context.rooms.remote.get("recipient"), event.content.body);
    }

    private async handleGroupMessage(context: IBridgeContext, event: IEventRequestData) {
        log.info(`Handling group message for ${context.rooms.remote}`);
        const roomProtocol = context.rooms.remote.get("protocol_id");
        const remoteUser = context.senders.remotes.find((remote) => remote.get("protocolId") === roomProtocol);
        if (remoteUser == null) {
            log.debug(`Using bot user because ${event.sender} is not puppeted`);
            return;
        }
        const acct = this.purple.getAccount(remoteUser.get("username"), roomProtocol);
        if (!acct) {
            log.error("Account wasn't found in libpurple, we cannot handle this join/leave!");
            return;
        }
        if (!acct.isEnabled) {
            log.error("Account isn't enabled, we cannot handle this join/leave!");
            return;
        }
        try {
            const roomName = context.rooms.remote.get("room_name");
            const body = event.content.body;
            const conv = acct.getConversation(roomName);
            this.deduplicator.insertMessage(
                roomName,
                Util.createRemoteId(roomProtocol, this.purple.getNickForChat(conv)),
                body
            );
            acct.sendChat(context.rooms.remote.get("room_name"), body);
        } catch (ex) {
            log.error("Couldn't send message to chat:", ex);
        }
    }

    private handleJoinLeaveGroup(context: IBridgeContext, event: IEventRequestData) {
        // XXX: We are assuming here that the previous state was invite.
        const membership = event.content.membership;
        log.info(`Handling group ${event.sender} ${membership}`);
        const roomProtocol = context.rooms.remote.get("protocol_id");
        const remoteUser = context.senders.remotes.find((remote) => remote.get("protocolId") === roomProtocol);
        if (remoteUser == null) {
            log.error("Could not find a purple account for this matrix user, we cannot handle this im!");
            return;
        }
        // XXX: We assume the first remote, this needs to be fixed for multiple accounts
        const acct = this.purple.getAccount(remoteUser.get("username"), roomProtocol);
        if (!acct) {
            log.error("Account wasn't found in libpurple, we cannot handle this join/leave!");
            return;
        }
        if (!acct.isEnabled) {
            log.error("Account isn't enabled, we cannot handle this join/leave!");
            return;
        }
        log.info(`Sending ${membership} to`, context.rooms.remote.get("properties"));
        if (membership === "join") {
            acct.joinChat(context.rooms.remote.get("properties"));
        } else if (membership === "leave") {
            acct.rejectChat(context.rooms.remote.get("properties"));
        }
    }
}
