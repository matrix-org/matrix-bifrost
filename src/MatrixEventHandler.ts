import { Bridge, MatrixRoom, RemoteUser, MatrixUser, RemoteRoom } from "matrix-appservice-bridge";
import { IEventRequest, IBridgeContext, IEventRequestData } from "./MatrixTypes";
import { MROOM_TYPE_UADMIN, MROOM_TYPE_IM, MROOM_TYPE_GROUP } from "./StoreTypes";
import { PurpleProtocol } from "./purple/PurpleProtocol";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import * as marked from "marked";
import { IPurpleAccount } from "./purple/IPurpleAccount";
import { Util } from "./Util";
import { Logging } from "matrix-appservice-bridge";
import { Deduplicator } from "./Deduplicator";
import { AutoRegistration } from "./AutoRegistration";
import { Config } from "./Config";
import { Store } from "./Store";
import { IAccountEvent, IChatJoinProperties, IChatJoined, IConversationEvent } from "./purple/PurpleEvents";
import { ProtoHacks } from "./ProtoHacks";
import { RoomAliasSet } from "./RoomAliasSet";
import { MessageFormatter } from "./MessageFormatter";
const log = Logging.get("MatrixEventHandler");

const RETRY_JOIN_MS = 5000;

/**
 * Handles events coming into the appservice.
 */
export class MatrixEventHandler {
    private bridge: Bridge;
    private autoReg!: AutoRegistration | null;
    private roomAliases: RoomAliasSet;
    private pendingRoomAliases: Map<string, {protocol: PurpleProtocol, props: IChatJoinProperties}>;
    constructor(
        private purple: IPurpleInstance,
        private store: Store,
        private deduplicator: Deduplicator,
        private config: Config,
    ) {
        this.roomAliases = new RoomAliasSet(this.config.portals, this.purple);
        this.pendingRoomAliases = new Map();
    }

    /**
     * Set the bridge for us to use. This must be called after MatrixEventHandler
     * has been created.
     * @return [description]
     */
    public setBridge(bridge: Bridge) {
        this.bridge = bridge;
        if (this.config.autoRegistration.enabled && this.config.autoRegistration.protocolSteps !== undefined) {
            this.autoReg = new AutoRegistration(this.config.autoRegistration, this.bridge, this.store, this.purple);
        } else {
            this.autoReg = null;
        }
    }

    public async onAliasQuery(alias: string, aliasLocalpart: string) {
        const res = this.roomAliases.getOptsForAlias(aliasLocalpart);
        log.info(`Got request to bridge ${aliasLocalpart}`);
        if (!res) {
            log.warn(`..but there is no protocol configured to handle it.`);
            return;
        }
        const {protocol, properties} = res;
        // XXX: Check if this chat already has a portal and refuse to bridge it.
        if (await this.store.getRoomByRemoteData({
            properties: Util.sanitizeProperties(properties), // for joining
            protocol_id: protocol.id,
        }, "group")) {
            log.warn("Room for", properties, "already exists, not allowing alias.");
            return null;
        }
        log.info(`Creating new room for ${protocol.id} with`, properties);
        this.pendingRoomAliases.set(alias, {protocol, props: properties});
        return {
            creationOpts: {
                room_alias_name: aliasLocalpart,
                initial_state: [
                    {
                        type: "m.room.join_rules",
                        content: {
                            join_rule: "public",
                        },
                        state_key: "",
                    },
                ],
            },
        };
    }

    public onAliasQueried(alias: string, roomId: string) {
        log.debug(`onAliasQueried:`, alias, roomId);
        const {protocol, props} = this.pendingRoomAliases.get(alias)!;
        this.pendingRoomAliases.delete(alias);
        const remoteData = {
            protocol_id: protocol.id,
            room_name: ProtoHacks.getRoomNameFromProps(protocol.id, props),
            properties: Util.sanitizeProperties(props), // for joining
        } as any;
        const remoteId = Buffer.from(
            `${protocol.id}:${remoteData.room_name}`,
        ).toString("base64");
        return this.store.storeRoom(roomId, MROOM_TYPE_GROUP, remoteId, remoteData);
    }

    public async onEvent(request: IEventRequest, context: IBridgeContext) {
        const roomType: string|null = context.rooms.matrix ? context.rooms.matrix.get("type") : null;
        const event = request.getData();
        const newInvite = !roomType && event.type === "m.room.member" && event.content.membership === "invite";
        log.debug("Got event (id, type, sender, roomtype):", event.event_id, event.type, event.sender, roomType);
        const botUserId = this.bridge.getBot().client.getUserId();
        if (newInvite) {
            log.debug(`Handling invite from ${event.sender}.`);
            log.info(event.state_key, botUserId);
            if (event.state_key === botUserId) {
                try {
                    await this.handleInviteForBot(event);
                } catch (e) {
                    log.error("Failed to handle invite for bot:", e);
                }
            } else if (this.bridge.getBot().isRemoteUser(event.state_key)) {
                // This is a PM, maybe?
                log.debug("Got request to PM", event.state_key);
            }
        }

        if (
            event.type === "m.room.message" &&
            event.content.msgtype === "m.text" &&
            event.content.body.startsWith("!purple")) {
            // It's probably a room waiting to be given commands.
            const args = event.content.body.split(" ");
            await this.handlePlumbingCommand(args, context, event);
            return;
        }

        if (roomType === MROOM_TYPE_UADMIN) {
            if (event.type === "m.room.message" && event.content.msgtype === "m.text") {
                const args = event.content.body.trim().split(" ");
                await this.handleCommand(args, context, event);
            } else if (event.content.membership === "leave") {
                await this.bridge.getRoomStore().removeEntriesByMatrixRoomId(event.room_id);
                await this.bridge.getIntent().leave(event.room_id);
                log.info(`Left and removed entry for ${event.room_id} because the user left`);
            }
            return;
        }

        // Validate room entries
        const roomProtocol = roomType ? context.rooms.remote.get("protocol_id") : null;
        if (roomProtocol == null) {
            log.error("Room protocol was null, we cannot handle this event!");
            return;
        }

        if (event.type === "m.room.member" && roomType === MROOM_TYPE_GROUP) {
            if (this.bridge.getBot().isRemoteUser(event.sender)) {
                return; // Don't really care about remote users
            }
            if (["join", "leave"].includes(event.content.membership)) {
                await this.handleJoinLeaveGroup(context, event);
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
    private async handleCommand(args: string[], context: IBridgeContext, event: IEventRequestData) {
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
                let account: IPurpleAccount|null = null;
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
        // Syntax: join [protocol] opts...
        } else if (args[0] === "join") {
            try {
                await this.handleJoin(args.slice(1), context, event);
            } catch (err) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "Failed to join chat:" + err.message,
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
- \`join $PROTOCOL opts\` Join a chat. Don't include opts to find out what you need to supply.
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

    private async handlePlumbingCommand(args: string[], context: IBridgeContext, event: IEventRequestData) {
        log.debug(`Handling plumbing command ${args} for ${event.room_id}`);
        const intent = this.bridge.getIntent();
        if (args[0] !== "!purple") {
            return;
        }
        try {
            if (args[1] === "bridge") {
                log.info(event.sender, "is attempting to plumb", event.room_id);
                const cmdArgs = args.slice(2);
                if (!cmdArgs[0]) {
                    throw new Error("Protocol not supplied");
                }
                const protocol = this.purple.findProtocol(cmdArgs[0]);
                if (!protocol) {
                    throw new Error("Protocol not found");
                }
                const {acct} = await this.getAccountForMxid(context, event, protocol.id);
                const paramSet = await this.getJoinParametersForCommand(acct, cmdArgs, event.room_id);
                await ProtoHacks.addJoinProps(protocol.id, paramSet, event.sender, this.bridge.getIntent());
                log.debug("Got appropriate param set", paramSet);
                if (paramSet != null) {
                    // We want to join the room to make sure it works.
                    let res: IConversationEvent;
                    try {
                        log.debug("Attempting to join chat");
                        res = await acct.joinChat(paramSet, this.purple, 5000, false) as IConversationEvent;
                    } catch (ex) {
                        log.warn("Failed to join chat for plumbing:", ex);
                        throw Error("Failed to join chat");
                    }
                    const roomStore = this.bridge.getRoomStore();
                    const remoteData = {
                        protocol_id: acct.protocol.id,
                        room_name: res.conv.name,
                        properties: Util.sanitizeProperties(paramSet), // for joining
                    } as any;
                    const remoteId = Buffer.from(
                        `${acct.protocol.id}:${res.conv.name}`,
                    ).toString("base64");
                    await this.store.storeRoom(event.room_id, MROOM_TYPE_GROUP, remoteId, remoteData);
                }
            }
        } catch (ex) {
            log.warn("Plumbing attempt didn't succeed:", ex);
            await intent.sendMessage(event.room_id, {
                msgtype: "m.notice",
                body: "Failed to bridge:" + ex,
            });
        }
    }

    private async handleInviteForBot(event: IEventRequestData) {
        log.info(`Got invite from ${event.sender} to ${event.room_id}`);
        const intent = this.bridge.getIntent();
        await intent.join(event.room_id);
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
        /*await intent.sendMessage(event.room_id, {
            msgtype: "m.notice",
            body,
            format: "org.matrix.custom.html",
            formatted_body: marked(body),
        });*/
    }

    private async handleNewAccount(nameOrId: string, args: string[], event: IEventRequestData) {
        // TODO: Check to see if the user has an account matching this already.
        const protocol = this.purple.findProtocol(nameOrId);
        if (protocol === undefined) {
            throw new Error("Protocol was not found");
        }
        if (!protocol.canCreateNew) {
            throw Error("Protocol does not let you create new accounts");
        }
        if (!args[0]) {
            throw new Error("You need to specify a username");
        }
        if (!args[1]) {
            throw new Error("You need to specify a password");
        }
        const account = this.purple.createPurpleAccount(args[0], protocol);
        account.createNew(args[1]);
        await this.store.storeUserAccount(event.sender, protocol, args[0]);
        await this.bridge.getIntent().sendMessage(event.room_id, {
            msgtype: "m.notice",
            body: "Created new account",
        });
    }

    private async handleAddExistingAccount(protocolId: string, name: string, event: IEventRequestData) {
        // TODO: Check to see if the user has an account matching this already.
        if (protocolId === undefined) {
            throw Error("You need to specify a protocol");
        }
        if (name === undefined) {
            throw Error("You need to specify a name");
        }
        const protocol = this.purple.findProtocol(protocolId);
        if (protocol === undefined) {
            throw Error("Protocol was not found");
        }
        await this.store.storeUserAccount(event.sender, protocol, name);
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
        if (!protocol.canAddExisting) {
            throw Error("Protocol does not let you create new accounts");
        }
        const acct = this.purple.getAccount(username, protocol.id);
        if (acct === null) {
            throw Error("Account not found");
        }
        acct.setEnabled(enable);
    }

    private async handleImMessage(context: IBridgeContext, event: IEventRequestData) {
        log.info("Handling IM message");
        let acct: IPurpleAccount;
        try {
            acct = (await this.getAccountForMxid(context, event)).acct;
        } catch (ex) {
            log.error(`Couldn't handle ${event.event_id}, ${ex}`);
            return;
        }
        log.info(`Sending IM to ${context.rooms.remote.get("recipient")}`);
        acct.sendIM(context.rooms.remote.get("recipient"), event.content.body);
    }

    private async handleGroupMessage(context: IBridgeContext, event: IEventRequestData) {
        log.info(`Handling group message for ${event.room_id}`);
        const roomProtocol = context.rooms.remote.get("protocol_id");
        try {
            const {acct, newAcct} = await this.getAccountForMxid(context, event);
            log.info(`Got ${acct.name} for ${event.sender}`);
            const name = context.rooms.remote.get("room_name");
            if (!acct.isInRoom(name)) {
                log.debug(`${event.sender} talked in ${name}, joining them.`);
                const props = Util.desanitizeProperties(
                    Object.assign({}, context.rooms.remote.get("properties")),
                );
                await ProtoHacks.addJoinProps(acct.protocol.id, props, event.sender, this.bridge.getIntent());
                await this.joinOrDefer(acct, name, props);
            }
            const roomName = context.rooms.remote.get("room_name");
            const msg = MessageFormatter.matrixEventToBody(event, this.config.bridge);
            let nick = "";
            // XXX: Gnarly way of trying to determine who we are.
            try {
                const conv = acct.getConversation(roomName);
                if (!conv) {
                    throw Error();
                }
                nick = conv ? this.purple.getNickForChat(conv) || acct.name : acct.name;
            } catch (ex) {
                nick = acct.name;
            }
            if (this.purple.needsDedupe()) {
                this.deduplicator.insertMessage(
                    roomName,
                    Util.createRemoteId(roomProtocol,
                        ProtoHacks.getSenderId(
                            acct,
                            nick,
                            roomName,
                        ),
                    ),
                    msg.body,
                );
            }
            acct.sendChat(context.rooms.remote.get("room_name"), msg);
        } catch (ex) {
            log.error("Couldn't send message to chat:", ex);
        }
    }

    private async handleJoinLeaveGroup(context: IBridgeContext, event: IEventRequestData) {
        // XXX: We are assuming here that the previous state was invite.
        const membership = event.content.membership;
        log.info(`Handling group ${event.sender} ${membership}`);
        let acct: IPurpleAccount;
        try {
            acct = (await this.getAccountForMxid(context, event)).acct;
        } catch (ex) {
            log.error("Failed to handle join/leave:", ex);
            // Kick em if we cannot join em.
            if (membership === "join") {
                await this.bridge.getIntent().kick(
                    event.room_id, event.sender, "Could not find a compatible purple account.",
                );
            }
            return;
        }
        const name = context.rooms.remote.get("room_name");
        const props = Util.desanitizeProperties(Object.assign({}, context.rooms.remote.get("properties")));
        log.info(`Sending ${membership} to`, props);
        if (membership === "join") {
            await ProtoHacks.addJoinProps(acct.protocol.id, props, event.sender, this.bridge.getIntent());
            this.joinOrDefer(acct, name, props);
        } else if (membership === "leave") {
            acct.rejectChat(props);
            this.deduplicator.removeChosenOne(name, acct.remoteId);
            // Only do this if it's NOT an invite.
            this.deduplicator.decrementRoomUsers(name);
        }
    }

    private async handleJoin(args: string[], context: IBridgeContext, event: IEventRequestData) {
        // XXX: This only supports the first account of a protocol for now.
        log.debug("Handling join request");
        if (!args[0]) {
            throw Error("Protocol not supplied");
        }
        const protocol = this.purple.findProtocol(args[0]);
        if (!protocol) {
            throw Error("Protocol not found");
        }
        let paramSet;
        let acct;
        try {
            acct = await this.getAccountForMxid(context, event, protocol.id);
            paramSet = await this.getJoinParametersForCommand(acct.acct, args, event.room_id);
            await ProtoHacks.addJoinProps(protocol.id, paramSet, event.sender, this.bridge.getIntent());
        } catch (ex) {
            log.error("Failed to get account:", ex);
            throw Error("Failed to get account");
        }
        // We don't know the room name, so we have to join and wait for the callback.
        if (paramSet !== null) {
            acct.acct.joinChat(paramSet);
        }
    }

    private async getJoinParametersForCommand(acct: IPurpleAccount, args: string[], roomId: string)
    : Promise<IChatJoinProperties|null> {
        const params = acct.getChatParamsForProtocol();
        if (args.length === 1) {
            let optional = "";
            let required = "";
            params.forEach((param) => {
                if (param.label.startsWith("_")) {
                    param.label = param.label.substr(1);
                }
                if (param.label.endsWith(":")) {
                    param.label = param.label.substr(0, param.label.length - 1);
                }
                if (param.required) {
                    required += `- \`${param.label}\`\n`;
                } else {
                    optional += `- \`${param.identifier}=value\` (${param.label})\n`;
                }
            });
            const body =
`The following **required** parameters must be specified in order.
Optional parameters must be in the form of name=value *after* the required options.
The parameters ARE case sensitive.

E.g. \`join xmpp roomname conf.matrix.org password=$ecr£t!\`

**required**:\n\n${required}

**optional**:\n\n${optional}
`;
            await this.bridge.getIntent().sendMessage(roomId, {
                msgtype: "m.notice",
                body,
                format: "org.matrix.custom.html",
                formatted_body: marked(body),
            });
            return null;
        }

        const requiredParams = params.filter((p) => p.required);

        const argsParams = args.slice(1);
        const paramSet: IChatJoinProperties = {};
        for (let i = 0; i < requiredParams.length; i++) {
            const arg = argsParams[i];
            const param = requiredParams[i];
            // XXX: Hack so users do not have to specify handle.
            if (param.identifier === "handle") {
                log.info("Ignoring handle");
                continue;
            }
            paramSet[param.identifier] = arg;
        }

        const requiredCount = Object.keys(paramSet).length;

        if (Object.keys(argsParams).length < requiredCount) {
            throw Error("Incorrect number of parameters given");
        }

        // Optionals
        args.slice(1 + requiredCount).forEach((arg) => {
            const split = arg.split("=");
            if (split.length === 1) {
                throw Error("Optional parameter in the wrong format.");
            }
            paramSet[split[0]] = split[1];
        });
        log.debug("Parameters for join:", paramSet);
        return paramSet;
    }

    private joinOrDefer(acct: IPurpleAccount, name: string, properties: IChatJoinProperties): Promise<void> {
        if (!acct.connected) {
            log.debug("Account is not connected, deferring join until connected");
            return new Promise((resolve, reject) => {
                let cb;
                cb = (joinEvent: IAccountEvent) => {
                    if (joinEvent.account.username === acct.name &&
                        acct.protocol.id === joinEvent.account.protocol_id) {
                        log.debug("Account signed in, joining room");
                        const p = acct.joinChat(properties, this.purple, 5000) as Promise<any>;
                        acct.setJoinPropertiesForRoom(name, properties);
                        this.purple.removeListener("account-signed-on", cb);
                        resolve(p);
                    }
                };
                this.purple.on("account-signed-on", cb);
            });

        } else {
            acct.joinChat(properties);
            acct.setJoinPropertiesForRoom(name, properties);
            return Promise.resolve();
        }
    }

    private async getAccountForMxid(
        context: IBridgeContext, event: IEventRequestData, protocol?: string,
    ): Promise<{acct: IPurpleAccount, newAcct: boolean}> {
        const roomProtocol = protocol || context.rooms.remote.get("protocol_id");
        const remoteUser = context.senders.remotes.find((remote) => remote.get("protocolId") === roomProtocol);
        if (remoteUser == null) {
            log.info(`Account not found for ${event.sender}`);
            if (!this.autoReg) {
                throw Error("Autoregistration of accounts not supported");
            }
            if (!this.autoReg.isSupported(roomProtocol)) {
                throw Error(`${roomProtocol} cannot be autoregistered`);
            }
            return {
                acct: await this.autoReg.registerUser(roomProtocol, event.sender),
                newAcct: true,
            };
        }
        // XXX: We assume the first remote, this needs to be fixed for multiple accounts
        const acct = this.purple.getAccount(remoteUser.get("username"), roomProtocol);
        if (!acct) {
            log.error("Account wasn't found in libpurple, we cannot handle this im!");
            throw new Error("Account not found");
        }
        if (!acct.isEnabled) {
            log.error("Account isn't enabled, we cannot handle this im!");
            throw new Error("Account not enabled");
        }
        return {acct, newAcct: false};
    }
}
