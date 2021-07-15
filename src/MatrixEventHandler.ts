import { Bridge, RemoteUser, MatrixUser, Request, WeakEvent, RoomBridgeStoreEntry, UserMembership, TypingEvent } from "matrix-appservice-bridge";
import { MatrixMembershipEvent, MatrixMessageEvent } from "./MatrixTypes";
import { MROOM_TYPE_UADMIN, MROOM_TYPE_IM, MROOM_TYPE_GROUP,
    IRemoteUserAdminData } from "./store/Types";
import { BifrostProtocol } from "./bifrost/Protocol";
import { IBifrostInstance } from "./bifrost/Instance";
import marked from "marked";
import { IBifrostAccount } from "./bifrost/Account";
import { Util } from "./Util";
import { Logging } from "matrix-appservice-bridge";
import { Deduplicator } from "./Deduplicator";
import { AutoRegistration } from "./AutoRegistration";
import { Config } from "./Config";
import { IStore } from "./store/Store";
import { IAccountEvent, IChatJoinProperties, IChatJoined, IConversationEvent } from "./bifrost/Events";
import { ProtoHacks } from "./ProtoHacks";
import { RoomAliasSet } from "./RoomAliasSet";
import { MessageFormatter } from "./MessageFormatter";
import { GatewayHandler } from "./GatewayHandler";
import { BifrostRemoteUser } from "./store/BifrostRemoteUser";
const log = Logging.get("MatrixEventHandler");

/**
 * Handles events coming into the appservice.
 */
export class MatrixEventHandler {
    private bridge?: Bridge;
    private autoReg: AutoRegistration | null = null;
    private roomAliases: RoomAliasSet;
    private pendingRoomAliases: Map<string, {protocol: BifrostProtocol, props: IChatJoinProperties}>;
    constructor(
        private purple: IBifrostInstance,
        private store: IStore,
        private deduplicator: Deduplicator,
        private config: Config,
        private gatewayHandler: GatewayHandler,
    ) {
        this.roomAliases = new RoomAliasSet(this.config.portals, this.purple);
        this.pendingRoomAliases = new Map();
    }

    /**
     * Set the bridge for us to use. This must be called after MatrixEventHandler
     * has been created.
     * @return [description]
     */
    public setBridge(bridge: Bridge, autoReg?: AutoRegistration) {
        this.bridge = bridge;
        this.autoReg = autoReg || null;
    }

    public async onAliasQuery(alias: string, aliasLocalpart: string) {
        const res = this.roomAliases.getOptsForAlias(aliasLocalpart);
        log.info(`Got request to bridge ${aliasLocalpart}`);
        if (!res) {
            log.warn(`..but there is no protocol configured to handle it.`);
            throw Error("Could not match against an alias");
        }
        const protocol = res.protocol;

        const properties = Util.sanitizeProperties(res.properties);
        try {
            // Check if this chat already has a portal and refuse to bridge it.
            const existing = await this.store.getRoomByRemoteData({
                properties, // for joining
                protocol_id: protocol.id,
            });
            if (existing) {
                log.info("Room for", properties, "already exists, not allowing alias.");
                // Set the alias on the room.
                const botIntent = this.bridge.getIntent();
                await botIntent.createAlias(alias, existing.matrix.getId());
                return null;
            }
        } catch (ex) {
            log.error("Failed to query room store for existing rooms:", ex);
            throw Error("Failed to get room from room store.");
        }

        if(!await this.purple.checkGroupExists(properties, protocol)) {
            log.warn(`Protocol reported that ${aliasLocalpart} does not exist, not bridging`);
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

    public async onAliasQueried(alias: string, roomId: string) {
        log.info(`onAliasQueried:`, alias, roomId);
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
        try {
            await this.store.storeRoom(roomId, MROOM_TYPE_GROUP, remoteId, remoteData);
        } catch (ex) {
            log.error("Failed to store room:", ex);
        }
    }

    public async onEvent(request: Request<WeakEvent>) {
        if (!this.bridge) {
            throw Error('Bridge is not defined yet');
        }
        const event = request.getData();
        const ctx: RoomBridgeStoreEntry = (await this.store.getRoomEntryByMatrixId(event.room_id) || {
            matrix: undefined,
            remote: undefined,
            data: {},
        });

        let membershipEvent: MatrixMembershipEvent|undefined;

        if (event.type === "m.room.member" && event.state_key?.length && typeof event.content.membership === "string") {
            membershipEvent = event as MatrixMembershipEvent;
        }

        if (membershipEvent && membershipEvent.content.membership === "join") {
            this.deduplicator.waitForJoinResolve(event.room_id, event.sender);
        }

        const roomType: string|null = ctx.matrix ? ctx.matrix.get("type") : null;
        const newInvite = !roomType && membershipEvent?.content.membership === "invite";
        log.debug("Got event (id, type, sender, state_key, roomtype):", event.event_id, event.type, event.sender, event.state_key, roomType);
        const bridgeBot = this.bridge.getBot();
        const botUserId = bridgeBot.getUserId();
        if (newInvite && event.state_key) {
            log.debug(`Handling invite from ${event.sender}.`);
            if (event.state_key === botUserId) {
                try {
                    await this.handleInviteForBot(event);
                } catch (e) {
                    log.error("Failed to handle invite for bot:", e);
                }
            } else if (event.content.is_direct && bridgeBot.isRemoteUser(event.state_key)) {
                log.debug("Got request to PM", event.state_key);
                const {
                    username,
                    protocol,
                } = this.purple.getUsernameFromMxid(event.state_key!, this.config.bridge.userPrefix);
                log.debug("Mapped username to", username);
                const remoteData = {
                    matrixUser: event.sender,
                    protocol_id: protocol.id,
                    recipient: username,
                } as any;
                const ghostIntent = this.bridge.getIntent(event.state_key);
                 // If the join fails to join because it's not registered, it tries to get invited which will fail.
                log.debug(`Joining ${event.state_key} to ${event.room_id}.`);
                await ghostIntent.join(event.room_id);
                const remoteId = Buffer.from(
                    `${event.sender}:${protocol.id}:${username}`,
                ).toString("base64");
                const {remote} = await this.store.storeRoom(event.room_id, MROOM_TYPE_IM, remoteId, remoteData);
                ctx.remote = remote;
                // Fetch events from the room now we have joined to see if anything got missed.
                log.debug("Joined to IM room, now calling /messages to get any previous messages");
                try {
                    const messages = await Util.getMessagesBeforeJoin(ghostIntent, event.room_id);
                    for (const msg of messages) {
                        log.debug(`Got ${msg.event_id} before join, handling`);
                        await this.handleImMessage(ctx, msg);
                    }
                } catch (ex) {
                    log.error("Couldn't handle messages from before we were joined:", ex);
                }
            }
        }

        const body = event.content.body as string|undefined;

        if (
            event.type === "m.room.message" &&
            event.content.msgtype === "m.text" &&
            body?.startsWith("!purple")) {
            // It's probably a room waiting to be given commands.
            if (this.config.provisioning.enablePlumbing) {
                const args = body.split(" ");
                await this.handlePlumbingCommand(args, event);
            }
            return;
        }

        if (roomType === MROOM_TYPE_UADMIN) {
            if (event.type === "m.room.message" && event.content.msgtype === "m.text" && body) {
                const args = body.trim().split(" ");
                await this.handleCommand(args, event);
            } else if (event.content.membership === "leave") {
                await this.store.removeRoomByRoomId(event.room_id);
                await this.bridge.getIntent().leave(event.room_id);
                log.info(`Left and removed entry for ${event.room_id} because the user left`);
            }
            return;
        }

        // Validate room entries
        const roomProtocol = roomType ? ctx.remote?.get<string>("protocol_id") : undefined;
        if (!roomProtocol) {
            log.debug("Room protocol was null, we cannot handle this event!");
            return;
        }

        if (membershipEvent && roomType === MROOM_TYPE_GROUP) {
            if (this.bridge.getBot().isRemoteUser(event.sender)) {
                return; // Don't really care about remote users
            }
            if (["join", "leave"].includes(event.content.membership as string)) {
                await this.handleJoinLeaveGroup(ctx, membershipEvent);
                return;
            }
        }

        if (roomType === MROOM_TYPE_GROUP && event.state_key !== undefined) {
            this.handleStateEv(ctx, event);
        }

        if (event.type !== "m.room.message") {
            // We are only handling bridged room messages now.
            return;
        }

        if (roomType === MROOM_TYPE_IM) {
            await this.handleImMessage(ctx, event);
            return;
        }

        if (roomType === MROOM_TYPE_GROUP) {
            await this.handleGroupMessage(ctx, event);
            return;
        }
    }

    public async onTyping(r: Request<TypingEvent>) {
        const typing = r.getData();
        const ctx: RoomBridgeStoreEntry = (await this.store.getRoomEntryByMatrixId(typing.room_id) || {
            matrix: undefined,
            remote: undefined,
            data: {},
        });
        const roomType: string|null = ctx.matrix ? ctx.matrix.get("type") : null;

        if (roomType === MROOM_TYPE_IM) {
            // We only support this on IM rooms for now.
            // Assuming only one Matrix user present.
            log.info(`Handling IM typing for ${typing.room_id}`);
            if (!ctx.remote) {
                throw Error('Cannot handle message, remote or matrix not defined');
            }
            const isUserTyping = !!typing.content.user_ids.filter(u => !this.bridge.getBot().isRemoteUser(u))[0];
            const matrixUser = ctx.remote.get<string>("matrixUser");
            let acct: IBifrostAccount;
            const roomProtocol: string = ctx.remote.get("protocol_id");
            try {
                acct = (await this.getAccountForMxid(matrixUser, roomProtocol)).acct;
            } catch (ex) {
                log.error(`Couldn't handle ${matrixUser}'s typing event, ${ex}`);
                return;
            }
            const recipient: string = ctx.remote.get("recipient");
            log.info(`Sending typing to ${recipient}`);
            acct.sendIMTyping(recipient, isUserTyping);
            return;
        }
    }

    /* NOTE: Command handling should really be it's own class, but I am cutting corners.*/
    private async handleCommand(args: string[], event: WeakEvent) {
        if (!this.bridge) {
            throw Error('Bridge is not defined');
        }
        // Are we running a bridge for one protocol?
        const soloProtocol = this.purple.usingSingleProtocol();
        log.debug(`Handling command from ${event.sender} ${args.join(" ")}`);
        const intent = this.bridge.getIntent();
        if (args[0] === "protocols" && args.length === 1 && !soloProtocol) {
            const protocols = this.purple.getProtocols();
            let body = "Available protocols:\n\n";
            body += protocols.map((plugin: BifrostProtocol) =>
                ` \`${plugin.name}\` - ${plugin.summary}`,
            ).join("\n\n");
            await intent.sendMessage(event.room_id, {
                msgtype: "m.notice",
                body,
                format: "org.matrix.custom.html",
                formatted_body: marked(body),
            });
        } else if (args[0] === "accounts" && args.length === 1) {
            const users = await this.store.getRemoteUsersFromMxId(event.sender) || [];
            let body = "Linked accounts:\n";
            body += users.map((remoteUser: BifrostRemoteUser) => {
                let account: IBifrostAccount|null = null;
                try {
                    account = this.purple.getAccount(remoteUser.username, remoteUser.protocolId, event.sender);
                } catch (ex) {
                    log.error("Account not found:", ex);
                }
                if (account) {
return `- ${account.protocol.name} (${remoteUser.username}) [Enabled=${account.isEnabled}] [Connected=${account.connected}]`;
                } else {
                    return `- ${remoteUser.protocolId} [Protocol not enabled] (${remoteUser.username})`;
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
                if (soloProtocol) {
                    const acct = await this.handleNewAccount(soloProtocol, args.slice(2), event);
                    // TODO: This is hacky
                    log.info("Waiting 5000ms before enabling account");
                    setTimeout(() => {
                        acct.setEnabled(true);
                    }, 5000);
                } else {
                    await this.handleNewAccount(args[2], args.slice(3), event);
                }
            } catch (err) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "Failed to add account: " + err.message,
                });
            }
        } else if (args[0] === "accounts" && ["enable", "disable"].includes(args[1])) {
            try {
                if (soloProtocol) {
                    await this.handleEnableAccount(soloProtocol, args[2], event.sender, args[1] === "enable");
                } else {
                    await this.handleEnableAccount(args[2], args[3], event.sender, args[1] === "enable");
                }
            } catch (err) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "Failed to enable account:" + err.message,
                });
            }
        } else if (args[0] === "accounts" && args[1] === "add-existing" && !soloProtocol) {
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
                await this.handleJoin(args.slice(1), event);
            } catch (err) {
                await intent.sendMessage(event.room_id, {
                    msgtype: "m.notice",
                    body: "Failed to join chat:" + err.message,
                });
            }
        } else if (args[0] === "help") {
            let body = "\n";
            if (soloProtocol) {
                body += "- \`accounts\` List accounts mapped to your matrix account.\n";
                body += "- `accounts add $USERNAME $PASSWORD` Add a new account, this will take some options given.\n";
                body += "- `accounts enable|disable $USERNAME` Enables or disables an account.\n";
                body += "- `join` List required options for joining a chat.";
                body += "- `join $OPTS` Join a chat.";
            } else {
                body += `
                - \`protocols\` List available protocols.
                - \`accounts\` List accounts mapped to your matrix account.
                - \`accounts add $PROTOCOL ...$OPTS\` Add a new account, this will take some options given.
                - \`accounts add-existing $PROTOCOL $NAME\` Add an existing account from accounts.xml.
                - \`accounts enable|disable $PROTOCOL $USERNAME\` Enables or disables an account.
                - \`join $PROTOCOL opts\` Join a chat. Don't include opts to find out what you need to supply.
                `;
            }
            body += "- `help` This help prompt";

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

    private async handlePlumbingCommand(args: string[], event: WeakEvent) {
        if (!this.bridge) {
            throw Error('Bridge is not defined');
        }
        log.debug(`Handling plumbing command ${args} for ${event.room_id}`);
        // Check permissions
        if (args[0] !== "!purple") {
            return;
        }
        const requiredPl = this.config.provisioning.requiredUserPL;
        const intent = this.bridge.getIntent();
        const powerLevels = await intent.getStateEvent(event.room_id, "m.room.power_levels");
        const userPl = powerLevels.users[event.sender] === undefined ? powerLevels.users_default :
            powerLevels.users[event.sender];
        if (userPl < requiredPl) {
            log.warn(`${event.sender}'s PL is too low to run a plumbing command ${userPl} < ${requiredPl}`);
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
                const {acct} = await this.getAccountForMxid(event.sender, protocol.id);
                const paramSet = await this.getJoinParametersForCommand(acct, cmdArgs, event.room_id, "!purple bridge");
                log.debug("Got appropriate param set", paramSet);
                if (paramSet != null) {
                    await ProtoHacks.addJoinProps(protocol.id, paramSet, event.sender, intent);
                    // We want to join the room to make sure it works.
                    let res: IConversationEvent;
                    try {
                        log.debug("Attempting to join chat");
                        res = await acct.joinChat(paramSet, this.purple, 5000, false) as IConversationEvent;
                    } catch (ex) {
                        log.warn("Failed to join chat for plumbing:", ex);
                        throw Error("Failed to join chat");
                    }
                    const remoteData = {
                        protocol_id: acct.protocol.id,
                        room_name: res.conv.name,
                        plumbed: true,
                        properties: Util.sanitizeProperties(paramSet), // for joining
                    } as any;
                    const remoteId = Buffer.from(
                        `${acct.protocol.id}:${res.conv.name}`,
                    ).toString("base64");
                    await this.store.storeRoom(event.room_id, MROOM_TYPE_GROUP, remoteId, remoteData);
                    // Fetch Matrix members and join them.
                    try {
                        const userIds = Object.keys(await this.bridge.getBot().getJoinedMembers(event.room_id));
                        await Promise.all(userIds.map(async (userId) => {
                            if (this.bridge?.getBot().getUserId() === userId) {
                                return; // Don't join the bridge bot.
                            }
                            log.info(`Joining ${userId} to ${remoteId}`);
                            const getAcctRes = await this.getAccountForMxid(userId, protocol.id);
                            const joinParamSet = await this.getJoinParametersForCommand(
                                getAcctRes.acct, cmdArgs, event.room_id, "",
                            );
                            await ProtoHacks.addJoinProps(protocol.id, joinParamSet, userId, intent);
                            await getAcctRes.acct.joinChat(joinParamSet!, this.purple, 5000, false);
                        }));
                    } catch (ex) {
                        log.warn("Syncing users to newly plumbed room failed: ", ex);
                    }
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

    private async handleInviteForBot(event: WeakEvent) {
        if (!this.bridge) {
            throw Error('Bridge is not defined');
        }
        log.info(`Got invite from ${event.sender} to ${event.room_id}`);
        const intent = this.bridge.getIntent();
        await intent.join(event.room_id);
        // Check to see if it's a 1 to 1.
        // TODO: Use is_direct
        const members = await this.bridge.getBot().getJoinedMembers(event.room_id);
        if (Object.keys(members).length > 2) {
            log.info("Room is not a 1 to 1 room: Treating as a potential plumbable room.");
            if (this.config.provisioning.enablePlumbing) {
                // We don't need to be in the room.
                intent.leave(event.room_id);
            }
            // This is not a 1 to 1 room, so just keep us joined for now. We might want it later.
            return;
        }
        this.store.storeRoom(event.room_id, MROOM_TYPE_UADMIN, `UADMIN-${event.sender}`, {
            type: MROOM_TYPE_UADMIN,
            matrixUser: new MatrixUser(event.sender).getId(),
        } as IRemoteUserAdminData);
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

    private async handleNewAccount(nameOrId: string, args: string[], event: WeakEvent) {
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
        const account = this.purple.createBifrostAccount(args[0], protocol);
        account.createNew(args[1], this.config.purple.defaultAccountSettings[protocol.id] || {});
        await this.store.storeAccount(event.sender, protocol, account.name);
        await this.bridge?.getIntent().sendMessage(event.room_id, {
            msgtype: "m.notice",
            body: "Created new account",
        });
        return account;
    }

    private async handleAddExistingAccount(protocolId: string, name: string, event: WeakEvent) {
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
        await this.store.storeAccount(event.sender, protocol, name);
        await this.bridge?.getIntent().sendMessage(event.room_id, {
            msgtype: "m.notice",
            body: "Linked existing account",
        });
    }

    private async handleEnableAccount(protocolId: string, username: string, mxid: string, enable: boolean) {
        const protocol = this.purple.findProtocol(protocolId);
        if (!protocol) {
            throw Error("Protocol not found");
        }
        if (!protocol.canAddExisting) {
            throw Error("Protocol does not let you create new accounts");
        }
        const acct = this.purple.getAccount(username, protocol.id, mxid);
        if (acct === null) {
            throw Error("Account not found");
        }
        acct.setEnabled(enable);
    }

    private async handleImMessage(context: RoomBridgeStoreEntry, event: WeakEvent) {
        log.info("Handling IM message");
            if (!context.remote) {
            throw Error('Cannot handle message, remote or matrix not defined');
        }
        let acct: IBifrostAccount;
        const roomProtocol: string = context.remote.get("protocol_id");
        try {
            acct = (await this.getAccountForMxid(event.sender, roomProtocol)).acct;
        } catch (ex) {
            log.error(`Couldn't handle ${event.event_id}, ${ex}`);
            return;
        }
        const recipient: string = context.remote.get("recipient");
        log.info(`Sending IM to ${recipient}`);
        const msg = MessageFormatter.matrixEventToBody(event as MatrixMessageEvent, this.config.bridge);
        acct.sendIM(recipient, msg);
    }

    private async handleGroupMessage(context: RoomBridgeStoreEntry, event: WeakEvent) {
        if (!context.remote || !context.matrix) {
            throw Error('Cannot handle message, remote or matrix not defined');
        }
        if (!this.bridge) {
            throw Error('bridge is not defined yet')
        }
        log.info(`Handling group message for ${event.room_id}`);
        const roomProtocol: string = context.remote.get("protocol_id");
        const isGateway: boolean = context.remote.get("gateway");
        const name: string = context.remote.get("room_name");
        if (isGateway) {
            const msg = MessageFormatter.matrixEventToBody(event as MatrixMessageEvent, this.config.bridge);
            this.gatewayHandler.sendMatrixMessage(name, event.sender, msg, context);
            return;
        }
        try {
            const {acct, newAcct} = await this.getAccountForMxid(event.sender, roomProtocol);
            log.info(`Got ${acct.name} for ${event.sender}`);
            if (!acct.isInRoom(name)) {
                log.debug(`${event.sender} talked in ${name}, joining them.`);
                const props = Util.desanitizeProperties(
                    Object.assign({}, context.remote.get("properties")),
                );
                await ProtoHacks.addJoinProps(acct.protocol.id, props, event.sender, this.bridge.getIntent());
                await this.joinOrDefer(acct, name, props);
            }
            const roomName: string = context.remote.get("room_name");
            const msg = MessageFormatter.matrixEventToBody(event as MatrixMessageEvent, this.config.bridge);
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
            acct.sendChat(context.remote.get("room_name"), msg);
        } catch (ex) {
            log.error("Couldn't send message to chat:", ex);
        }
    }

    private async handleJoinLeaveGroup(context: RoomBridgeStoreEntry, event: MatrixMembershipEvent) {
        if (!context.remote) {
            throw Error('No remote context for room');
        }
        if (!this.bridge) {
            throw Error('bridge is not defined yet')
        }
        const membership: string = event.content.membership as string;
        if (!event.state_key || !membership) {
            return;
        }
        log.info(`Handling group ${event.sender} ${membership}`);
        let acct: IBifrostAccount;
        const isGateway: boolean = context.remote.get("gateway");
        const name: string = context.remote.get("room_name");
        const roomProtocol: string = context.remote.get("protocol_id");
        if (isGateway) {
            await this.gatewayHandler.sendMatrixMembership(
                name, context, event,
            );
            return;
        }

        try {
            acct = (await this.getAccountForMxid(event.sender, roomProtocol)).acct;
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
        const props = Util.desanitizeProperties(Object.assign({}, context.remote.get("properties")));
        log.info(`Sending ${membership} to`, props);
        if (membership === "join") {
            await ProtoHacks.addJoinProps(acct.protocol.id, props, event.sender, this.bridge.getIntent());
            this.joinOrDefer(acct, name, props);
        } else if (membership === "leave") {
            await acct.rejectChat(props);
            this.deduplicator.removeChosenOne(name, acct.remoteId);
            // Only do this if it's NOT an invite.
            this.deduplicator.decrementRoomUsers(name);
        }
    }

    private async handleStateEv(context: RoomBridgeStoreEntry, event: WeakEvent) {
        if (!context.remote) {
            throw Error('No remote context for room');
        }
        const isGateway = context.remote.get<boolean>("gateway");
        const name = context.remote.get<string>("room_name");
        log.info(`Handling group state event for ${name}`);
        if (isGateway) {
            await this.gatewayHandler.sendStateEvent(
                name, event.sender, event, context,
            );
            return;
        }
        // XXX: Support state changes for non-gateways
    }

    private async handleJoin(args: string[], event: WeakEvent) {
        if (!this.bridge) {
            throw Error('Cannot handle handleJoin, bridge not defined');
        }
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
            acct = await this.getAccountForMxid(event.sender, protocol.id);
            paramSet = await this.getJoinParametersForCommand(acct.acct, args, event.room_id, "join");
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

    private async getJoinParametersForCommand(acct: IBifrostAccount, args: string[], roomId: string, command: string)
    : Promise<IChatJoinProperties|null> {
        if (!this.bridge) {
            throw Error('Cannot handle getJoinParametersForCommand, bridge not defined');
        }
        const params = acct.getChatParamsForProtocol();
        if (args.length === 1) {
            const optional: string[] = [];
            const required: string[] = [];
            params.forEach((param) => {
                if (param.label.startsWith("_")) {
                    param.label = param.label.substr(1);
                }
                if (param.label.endsWith(":")) {
                    param.label = param.label.substr(0, param.label.length - 1);
                }
                if (param.required) {
                    required.push(`\`${param.label}\``);
                } else {
                    optional.push(`\`${param.identifier}=value\``);
                }
            });
            const body =
`The following **required** parameters must be specified in order.
Optional parameters must be in the form of name=value *after* the required options.
The parameters ARE case sensitive.

E.g. \`${command} ${acct.protocol.id}\` ${required.join(" ")} ${optional.join(" ")}

**required**:\n\n - ${required.join("\n - ")}

**optional**:\n\n - ${optional.join("\n")}
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

    private joinOrDefer(acct: IBifrostAccount, name: string, properties: IChatJoinProperties): Promise<void> {
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

    private async getAccountForMxid(sender: string, protocol: string,
    ): Promise<{acct: IBifrostAccount, newAcct: boolean}> {
        const remoteUser = (await this.store.getAccountsForMatrixUser(sender, protocol))[0];
        if (!remoteUser) {
            log.info(`Account not found for ${sender}`);
            if (!this.autoReg) {
                throw Error("Autoregistration of accounts not supported");
            }
            return {
                acct: await this.autoReg.registerUser(protocol, sender),
                newAcct: true,
            };
        }
        // XXX: We assume the first remote, this needs to be fixed for multiple accounts
        const acct = this.purple.getAccount(remoteUser.username, protocol, sender);
        if (!acct) {
            log.error("Account wasn't found in backend, we cannot handle this im!");
            throw new Error("Account not found");
        }
        if (!acct.isEnabled) {
            log.error("Account isn't enabled, we cannot handle this im!");
            throw new Error("Account not enabled");
        }
        return {acct, newAcct: false};
    }
}
