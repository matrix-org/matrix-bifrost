import { IChatJoinProperties,
    IUserInfo, IConversationEvent, IChatJoined, IAccountMinimal, IStoreRemoteUser } from "../bifrost/Events";
import { XmppJsInstance, XMPP_PROTOCOL } from "./XJSInstance";
import { IBifrostAccount, IChatJoinOptions } from "../bifrost/Account";
import { IBifrostInstance } from "../bifrost/Instance";
import { BifrostProtocol } from "../bifrost/Protocol";
import { Element, x } from "@xmpp/xml";
import { jid, JID } from "@xmpp/jid";
import { IBasicProtocolMessage } from "../MessageFormatter";
import { Metrics } from "../Metrics";
import { Logging } from "matrix-appservice-bridge";
import uuid from "uuid/v4";
import { XHTMLIM } from "./XHTMLIM";
import { StzaMessage, StzaIqPing, StzaPresenceJoin, StzaPresencePart, StzaIqVcardRequest } from "./Stanzas";

const IDPREFIX = "pbridge";
const CONFLICT_SUFFIX = "[m]";
const LASTSTANZA_CHECK_MS = 2 * 60000;
const LASTSTANZA_MAXDURATION = 10 * 60000;
const log = Logging.get("XmppJsAccount");

export class XmppJsAccount implements IBifrostAccount {

    get _waitingJoinRoomProps(): IChatJoinProperties|undefined {
        return undefined;
    }

    get name(): string {
        return this.remoteId;
    }

    get protocol(): BifrostProtocol {
        return XMPP_PROTOCOL;
    }
    public readonly waitingToJoin: Set<string>;
    public readonly isEnabled = true;
    public readonly connected = true;

    public readonly roomHandles: Map<string, string>;
    private readonly pmSessions: Set<string>;
    private lastStanzaTs: Map<string, number>;
    private checkInterval: NodeJS.Timeout;
    constructor(
        public readonly remoteId: string,
        public readonly resource: string,
        private xmpp: XmppJsInstance,
        public readonly mxId: string,
    ) {
        this.roomHandles = new Map();
        this.waitingToJoin = new Set();
        this.pmSessions = new Set();
        this.lastStanzaTs = new Map();
        this.checkInterval = setInterval(() => {
            this.lastStanzaTs.forEach((ts, roomName) => {
                if (Date.now() - ts > LASTSTANZA_MAXDURATION) {
                    this.selfPing(roomName).then((isInRoom) => {
                        if (isInRoom) {
                            this.lastStanzaTs.set(roomName, Date.now());
                            return;
                        }
                        this.joinChat({
                            fullRoomName: roomName,
                            handle: this.roomHandles.get(roomName)!,
                        });
                    });
                }
            });
        }, LASTSTANZA_CHECK_MS);
    }

    public stop() {
        clearInterval(this.checkInterval);
    }

    public findAccount() {
        // TODO: What do we actually need to find.
    }

    public xmppBumpLastStanzaTs(roomName: string) {
        this.lastStanzaTs.set(roomName, Date.now());
    }

    public createNew(password?: string) {
        throw Error("Xmpp.js doesn't support registering accounts");
    }

    public setEnabled(enable: boolean) {
        throw Error("Xmpp.js doesn't allow you to enable or disable accounts");
    }

    public sendIM(recipient: string, msg: IBasicProtocolMessage) {
        msg.id = msg.id || IDPREFIX + Date.now().toString();
        // Check if the recipient is a gateway user, because if so we need to do some fancy masking.
        const res = this.xmpp.gateway ? this.xmpp.gateway.maskPMSenderRecipient(this.mxId, recipient) : null;
        let sender = `${this.remoteId}/${this.resource}`;
        if (res) {
            recipient = res.recipient;
            sender = res.sender;
        }
        log.debug(`IM ${sender} -> ${recipient}`);
        const message = new StzaMessage(
            sender,
            recipient,
            msg,
            "chat",
        );
        if (!this.pmSessions.has(recipient)) {
            this.pmSessions.add(recipient);
        }
        this.xmpp.xmppAddSentMessage(msg.id);
        this.xmpp.xmppSend(message);
        Metrics.remoteCall("xmpp.message.chat");
    }

    public sendChat(chatName: string, msg: IBasicProtocolMessage) {
        const id = msg.id || IDPREFIX + Date.now().toString();
        if (msg.formatted && msg.formatted.length) {

            msg.formatted.forEach(
                (f) => { if (f.type === "html") { f.body = XHTMLIM.HTMLToXHTML(f.body); } },
            );
        }
        const xMsg = new StzaMessage(`${this.remoteId}/${this.resource}`, chatName, msg, "groupchat");
        if (msg.id) {
            // Send RR for message if we have the matrixId.
            this.xmpp.emitReadReciepts(msg.id, chatName, true);
        }
        this.xmpp.xmppAddSentMessage(id);
        this.xmpp.xmppSend(xMsg);
        Metrics.remoteCall("xmpp.message.groupchat");
    }

    public getBuddy(user: string): any|undefined {
        // TODO: Not implemented
        return;
    }

    public getJoinPropertyForRoom(roomName: string, key: string): string|undefined {
        // TODO: Not implemented
        return;
    }

    public setJoinPropertiesForRoom(roomName: string, props: IChatJoinProperties) {
        // TODO: Not implemented
    }

    public isInRoom(roomName: string): boolean {
        const handle = this.roomHandles.get(roomName);
        if (!handle) {
            return false;
        }
        const res = this.xmpp.presenceCache.getStatus(roomName + "/" + handle);
        log.debug("isInRoom: Got presence for user:", res, this.remoteId);
        if (!res) {
            return false;
        }
        return res.online;
    }

    public async selfPing(to: string): Promise<boolean> {
        const id = uuid();
        log.debug(`Self-pinging ${to}`);
        const pingStanza = new StzaIqPing(
            `${this.remoteId}/${this.resource}`,
            to,
            id,
            "get",
        );
        Metrics.remoteCall("xmpp.iq.ping");
        try {
            await this.xmpp.sendIq(pingStanza);
            return true;
        }
        catch (ex) {
            return false;
        }
    }

    public reconnectToRooms() {
        log.info("Recovering rooms for", this.remoteId);
        this.roomHandles.forEach(async (handle, fullRoomName) => {
            try {
                log.debug("Rejoining", fullRoomName);
                await this.joinChat({
                    handle,
                    fullRoomName,
                });
            } catch (ex) {
                log.warn(`Failed to rejoin ${fullRoomName}`, ex);
            }
        });
    }

    public async rejoinChat(fullRoomName: string) {
        log.info(`Rejoining ${fullRoomName} for ${this.remoteId}`);
        try {
            const handle = this.roomHandles.get(fullRoomName);
            if (!handle) {
                throw new Error("User has no assigned handle for this room, we cannot rejoin!");
            }
            await this.joinChat({
                handle,
                fullRoomName,
            });
        } catch (ex) {
            log.warn(`Failed to rejoin ${fullRoomName}`, ex);
        }
    }

    public async joinChat(
        components: IChatJoinProperties,
        instance?: IBifrostInstance,
        timeout: number = 5000,
        setWaiting: boolean = true)
        : Promise<IConversationEvent|void> {
            if (!components.fullRoomName && (!components.room || !components.server)) {
                throw Error("Missing fullRoomName OR room|server");
            }
            if (!components.handle) {
                throw Error("Missing handle");
            }
            const roomName = components.fullRoomName || `${components.room}@${components.server}`;
            const to = `${roomName}/${components.handle}`;
            log.debug(`joinChat:`, this.remoteId, components);
            if (this.isInRoom(roomName)) {
                log.debug("Didn't join, already joined");
                return {
                    eventName: "already-joined",
                    account: {
                        username: this.remoteId,
                        protocol_id: XMPP_PROTOCOL.id,
                    } as IAccountMinimal,
                    conv: {
                        name: roomName,
                    },
                };
            }
            if (await this.selfPing(to)) {
                log.debug("Didn't join, self ping says we are joined");
                this.roomHandles.set(roomName, components.handle);
                return {
                    eventName: "already-joined",
                    account: {
                        username: this.remoteId,
                        protocol_id: XMPP_PROTOCOL.id,
                    } as IAccountMinimal,
                    conv: {
                        name: roomName,
                    },
                };
            }
            const from = `${this.remoteId}/${this.resource}`;
            log.info(`Joining to=${to} from=${from}`);
            const message = new StzaPresenceJoin(
                from,
                to,
            );
            this.roomHandles.set(roomName, components.handle);
            if (setWaiting) {
                this.waitingToJoin.add(roomName);
            }
            let p: Promise<IChatJoined>|undefined;
            if (instance) {
                p = new Promise((resolve, reject) => {
                    const timer = setTimeout(reject, timeout);
                    const cb = (data: IChatJoined) => {
                        if (data.conv.name === roomName) {
                            this.waitingToJoin.delete(roomName);
                            log.info(`Got ack for join ${roomName}`);
                            clearTimeout(timer);
                            this.xmpp.removeListener("chat-joined", cb);
                            resolve(data);
                        }
                    };
                    this.xmpp.on("chat-joined", cb);
                });
            }
            // To catch out races, we will emit this first.
            this.xmpp.emit("store-remote-user", {
                mxId: this.mxId,
                remoteId: to,
                protocol_id: XMPP_PROTOCOL.id,
            } as IStoreRemoteUser);
            await this.xmpp.xmppSend(message);
            Metrics.remoteCall("xmpp.presence.join");
            return p;
    }

    public async xmppRetryJoin(from: JID) {
        log.info("Retrying join for ", from.toString());
        if (from.resource.endsWith(CONFLICT_SUFFIX)) {
            // Kick from the room.
            throw new Error(`A user with the prefix '${CONFLICT_SUFFIX}' already exists, cannot join to room.`);
        }
        return this.joinChat({
            room: from.local,
            server: from.domain,
            handle: `${from.resource}${CONFLICT_SUFFIX}`,
        });
    }

    public async rejectChat(components: IChatJoinProperties) {
        /** This also handles leaving */
        const room = `${components.room}@${components.server}`;
        components.handle = this.roomHandles.get(room)!;
        log.info(`${this.remoteId} (${components.handle}) is leaving ${room}`);

        await this.xmpp.xmppSend(new StzaPresencePart(
            `${this.remoteId}/${this.resource}`,
            `${components.room}@${components.server}/${components.handle}`,
        ));
        this.roomHandles.delete(room);
        Metrics.remoteCall("xmpp.presence.left");
    }

    public getConversation(name: string): any {
        throw Error("getConversation not implemented");
    }

    public getChatParamsForProtocol(): IChatJoinOptions[] {
        return [
            {
                identifier: "server",
                label: "server",
                required: true,
            },
            {
                identifier: "room",
                label: "room",
                required: true,
            },
            {
                identifier: "handle",
                label: "handle",
                required: false,
            },
        ];
    }

    public async getUserInfo(who: string): Promise<IUserInfo> {
        const j = jid(who);
        const status = this.xmpp.presenceCache.getStatus(who);
        const ui: IUserInfo = {
            Nickname: j.resource || j.local,
            eventName: "meh",
            who,
            account: {
                protocol_id: this.protocol.id,
                username: this.remoteId,
            },
        };
        if (status && status.photoId) {
            ui.Avatar = status.photoId;
        }
        return ui;
    }

    public async getAvatarBuffer(iconPath: string, senderId: string): Promise<{type: string, data: Buffer}> {
        log.info(`Fetching avatar for ${senderId} (hash: ${iconPath})`);
        const vCard = await this.xmpp.getVCard(senderId);
        const photo = vCard.getChild("PHOTO");
        if (!photo) {
            throw Error("No PHOTO in vCard given");
        }
        return {
            data: Buffer.from(
                photo.getChildText("BINVAL")!,
                "base64",
            ),
            type: photo!.getChildText("TYPE") || "image/jpeg",
        };

    }

    public setStatus() {
        // No-op
        return;
    }

    public sendIMTyping() {
        // No-op
        return;
    }
}
