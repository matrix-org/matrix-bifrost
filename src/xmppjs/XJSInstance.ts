import { EventEmitter } from "events";
import { Logging, MatrixUser, Bridge } from "matrix-appservice-bridge";
import { Element } from "@xmpp/xml";
import { jid, JID } from "@xmpp/jid";
import { IBifrostInstance } from "../bifrost/Instance";
import { Config } from "../Config";
import { BifrostProtocol } from "../bifrost/Protocol";
import { IXJSBackendOpts } from "./XJSBackendOpts";
import { XmppJsAccount } from "./XJSAccount";
import { IBifrostAccount } from "../bifrost/Account";
import { IAccountEvent,
    IChatJoined,
    IReceivedImMsg,
    IUserStateChanged,
    IChatTyping,
    IStoreRemoteUser,
    IChatReadReceipt,
    IChatStringState,
    IEventBody,
    IChatJoinProperties} from "../bifrost/Events";
import { IBasicProtocolMessage, IMessageAttachment } from "../MessageFormatter";
import { PresenceCache } from "./PresenceCache";
import { Metrics } from "../Metrics";
import { ServiceHandler } from "./ServiceHandler";
import { XJSConnection } from "./XJSConnection";
import { AutoRegistration } from "../AutoRegistration";
import { XmppJsGateway } from "./XJSGateway";
import { IStza, StzaBase, StzaIqDisco, StzaIqDiscoInfo, StzaIqPing, StzaIqPingError, StzaIqVcardRequest } from "./Stanzas";
import { Util } from "../Util";
import uuid from "uuid/v4";

const xLog = Logging.get("XMPP-conn");
const log = Logging.get("XmppJsInstance");

class XmppProtocol extends BifrostProtocol {
    constructor() {
        super({
            id: "xmpp-js",
            name: "XMPP.js Protocol Plugin",
            homepage: "N/A",
            summary: "Fake bifrost protocol plugin for xmpp.js",
        }, false, false);
    }

    public getMxIdForProtocol(
            senderId: string,
            domain: string,
            prefix: string = "") {
        const j = jid(senderId);
        /* is not allowed in a JID localpart so it is used as a seperator.
           =2F is /, =40 is @
           We also show the resource first if given, because it's usually the nick
           of a user which is more important than the localpart. */
        const resource = j.resource ? j.resource + "/" : "";
        return new MatrixUser(`@${prefix}${resource}${j.local}@${j.domain}:${domain}`);
    }
}

export const XMPP_PROTOCOL = new XmppProtocol();
const SEEN_MESSAGES_SIZE = 16384;

export class XmppJsInstance extends EventEmitter implements IBifrostInstance {
    public readonly presenceCache: PresenceCache;
    private serviceHandler: ServiceHandler;
    private xmpp?: any;
    private myAddress!: JID;
    private accounts: Map<string, XmppJsAccount>;
    private seenMessages: Set<string>;
    private canWrite: boolean;
    private defaultRes!: string;
    private connectionWasDropped: boolean;
    private bufferedMessages: {xmlMsg: Element|string, resolve: (res: Promise<void>) => void}[];
    private autoRegister!: AutoRegistration;
    private bridge!: Bridge;
    private xmppGateway: XmppJsGateway|null;
    private activeMUCUsers: Set<string>;
    private lastMessageInMUC: Map<string, {originIsMatrix: boolean, id: string}>;
    constructor(private config: Config) {
        super();
        this.canWrite = false;
        this.accounts = new Map();
        this.bufferedMessages = [];
        this.seenMessages = new Set();
        this.presenceCache = new PresenceCache();
        this.serviceHandler = new ServiceHandler(this, config.bridge);
        this.connectionWasDropped = false;
        this.activeMUCUsers = new Set();
        this.lastMessageInMUC = new Map();
        this.xmppGateway = null;
    }

    get gateway() {
        return this.xmppGateway;
    }

    get defaultResource(): string {
        return this.defaultRes;
    }

    get xmppAddress(): JID {
        return this.myAddress;
    }

    public usingSingleProtocol() {
        return XMPP_PROTOCOL.id;
    }

    public preStart(bridge: Bridge, autoRegister: AutoRegistration) {
        this.autoRegister = autoRegister;
        this.bridge = bridge;
        if (!autoRegister) {
            throw Error('autoRegistration not defined, cannot start bridge');
        }
    }

    public createBifrostAccount(username) {
        return new XmppJsAccount(username, this.defaultRes, this, "");
    }

    public xmppWriteToStream(xmlMsg: any) {
        if (this.canWrite) {
            return this.xmpp.write(xmlMsg);
        }
        const p = new Promise((resolve) => {
            this.bufferedMessages.push({xmlMsg, resolve});
        });
        return p;
    }

    public xmppSendBulk(xmlMsgs: IStza[]): Promise<unknown> {
        let xml = "";
        for (const xmlMsg of xmlMsgs) {
            xml += xmlMsg.xml;
            Metrics.remoteCall(`xmpp.${xmlMsg.type}`);
        }
        return this.xmppSend(xml);
    }

    /**
     * Send an XML stanza to the stream. It's safe to modify
     * the Stanza object after calling this, as the object
     * is immediately converted to an XML string.
     * @param xmlMsg The XML stanza or string to send
     */
    public xmppSend(xmlMsg: IStza|string): Promise<unknown> {
        const xml = typeof(xmlMsg) === "string" ? xmlMsg : xmlMsg.xml;
        let p: Promise<unknown>;
        if (this.canWrite) {
            p = this.xmpp.write(xml);
        } else {
            p = new Promise((resolve) => {
                this.bufferedMessages.push({xmlMsg: xml, resolve});
            });
        }
        if (typeof(xmlMsg) !== "string") {
            Metrics.remoteCall(`xmpp.${xmlMsg.type}`);
        }
        return p;
    }

    public async sendIq(stza: StzaBase, timeoutMs = 10000): Promise<Element> {
        if (stza.type !== "iq") {
            throw Error("Stanza type must be of type IQ");
        }
        const p: Promise<Element> = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
            this.once("iq." + stza.id, (stanza: Element) => {
                clearTimeout(timeout);
                const error = stanza.getChild("error");
                if (error) {
                    reject({error, stanza});
                }
                resolve(stanza);
            });
        });
        await this.xmppSend(stza);
        Metrics.remoteCall("xmpp.iq");
        return p;
    }

    public xmppAddSentMessage(id: string) {
        this.seenMessages.add(id);
        // Remove old entries
        if (this.seenMessages.size >= SEEN_MESSAGES_SIZE) {
            const arr = [...this.seenMessages].slice(0, 50);
            arr.forEach(this.seenMessages.delete.bind(this.seenMessages));
        }
    }

    public isWaitingToJoin(j: JID): string|undefined {
        for (const acct of this.accounts.values()) {
            if (acct.waitingToJoin.has(`${j.local}@${j.domain}`)) {
                return acct.remoteId + "/" + acct.resource;
            }
        }
        return;
    }

    public getBuddyFromChat(conv: any, buddy: string): any {
        return undefined;
    }

    public async close() {
        await this.xmpp?.stop();
    }

    public async start(): Promise<void> {
        const config = this.config.purple;
        const opts = config.backendOpts as IXJSBackendOpts;
        if (!opts || !opts.service || !opts.domain || !opts.password) {
            throw Error("Missing opts for xmpp: service, domain, password");
        }
        if (this.config.portals.enableGateway === true) {
            if (!this.autoRegister) {
                throw Error("Autoregistration must be enabled for gateways to work!");
            }
            this.xmppGateway = new XmppJsGateway(this, this.autoRegister, this.config.bridge);
        }
        this.defaultRes = opts.defaultResource ? opts.defaultResource : "matrix-bridge";
        log.info(`Starting new XMPP component instance to ${opts.service} using domain ${opts.domain}`);
        const xmpp = XJSConnection.connect({
            service: opts.service,
            domain: opts.domain,
            password: opts.password,
        });
        xmpp.on("error", (err) => {
            xLog.error(err);
        });
        xmpp.on("offline", () => {
            xLog.info("gone offline.");
        });
        xmpp.on("stanza", (stanza) => {
            try {
                this.onStanza(stanza);
            } catch (ex) {
                log.error("Failed to handle stanza:", ex);
            }
        });

        xmpp.on("online", (address) => {
            xLog.info("gone online as " + address);
            this.myAddress = address;
            this.canWrite = true;
            log.info(`flushing ${this.bufferedMessages.length} buffered messages`);
            if (this.connectionWasDropped) {
                log.warn("Connection was dropped, attempting reconnect..");
                this.presenceCache.clear();
                for (const account of this.accounts.values()) {
                    account.reconnectToRooms();
                }
            }
            while (this.bufferedMessages.length) {
                if (!this.canWrite) {
                    return;
                }
                const msg = this.bufferedMessages.splice(0, 1)[0];
                msg.resolve(this.xmpp.write(msg.xmlMsg));
            }
        });

        // Debug
        xmpp.on("status", (status) => {
          if (status === "disconnecting" || status === "disconnected") {
              this.canWrite = false;
          }
          if (status === "disconnect") {
              log.error("Connection to XMPP server was lost..");
              this.connectionWasDropped = true;
          }
          xLog.info("status:", status);
        });

        xmpp.on("reconnecting", () => {
            xLog.info("status: reconnecting");
        });

        xmpp.on("reconnected", () => {
            xLog.info("status: reconnecting");
        });


        if (opts.logRawStream) {
            xmpp.on("input", (input) => {
                xLog.debug("RX:", input);
            });
            xmpp.on("output", (output) => {
                xLog.debug("TX:", output);
            });
        }
        await xmpp.start();
        this.xmpp = xmpp;
    }

    public signInAccounts(mxidUsernames: {[mxid: string]: string}) {
        Object.keys(mxidUsernames).forEach((mxid) => {
            try {
                log.debug(`Signing in ${mxid} (${mxidUsernames[mxid]}) to XMPP`);
                this.getAccount(mxidUsernames[mxid], XMPP_PROTOCOL.id, mxid);
            } catch (ex) {
                log.error(`Failed to signInAccounts for ${mxid}:`, ex);
                throw Error("Cannot continue");
            }
        });
    }

    public getAccountForJid(aJid: JID): {mxId: string}|undefined {
        const gatewayMxid = this.gateway?.getMatrixIDForJID(`${aJid.local}@${aJid.domain}`, aJid);
        if (gatewayMxid) {
            return {mxId: gatewayMxid};
        }
        if (aJid.domain === this.myAddress.domain) {
            log.debug(aJid.local, [...this.accounts.keys()]);
            return this.accounts.get(aJid.toString());
        }
        return;
    }

    public getAccount(username: string, protocolId: string, mxid: string): IBifrostAccount|null {
        const j = jid(username);
        if (j.domain === this.myAddress.domain &&
            j.local.startsWith("#") &&
            this.serviceHandler.parseAliasFromJID(j)) {
            // Account is an gateway alias, not trying.
            return null;
        }
        const uLower = username.toLowerCase();
        log.debug("Getting account", username);
        if (protocolId !== "xmpp-js") {
            return null;
        }
        if (this.accounts.has(uLower)) {
            return this.accounts.get(uLower)!;
        }
        const acct = new XmppJsAccount(username, this.defaultRes, this, mxid);
        this.accounts.set(uLower, acct);
        // Components don't "connect", so just emit this once we've created it.
        this.emit("account-signed-on", {
            eventName: "account-signed-on",
            account: {
                protocol_id: XMPP_PROTOCOL.id,
                username,
            },
        } as IAccountEvent);
        return acct;
    }

    public getProtocol(id: string): BifrostProtocol|undefined {
        if (id === "xmpp-js") { return XMPP_PROTOCOL; }
    }

    public getProtocols(): BifrostProtocol[] {
        return [XMPP_PROTOCOL];
    }

    public findProtocol(nameOrId: string): BifrostProtocol|undefined {
        if (nameOrId.toLowerCase() === "xmpp-js") { return XMPP_PROTOCOL; }
    }

    public getNickForChat(conv: any): string {
        throw new Error("Not supported.");
    }

    public needsDedupe() {
        return false;
    }

    public needsAccountLock() {
        return false;
    }

    public getUsernameFromMxid(
            mxid: string,
            prefix: string = ""): {username: string, protocol: BifrostProtocol} {
        // This is for GHOST accts
        const uName = Util.unescapeUserId(new MatrixUser(mxid, {}, false).localpart);
        const rPrefix = prefix ? `(${prefix})` : "";
        const regex =  new RegExp(`${rPrefix}(.+/)?(.+)@(.+)`);
        const match = regex.exec(uName);
        if (!match) {
            throw Error("Username didn't match");
        }
        const resource = match[2] ? match[2].substr(
            0, match[2].length - "/".length) : "";
        const localpart = match[3];
        const domain = match[4];
        const username = `${localpart}@${domain}${resource ? "/" + resource : ""}`;
        return {username, protocol: XMPP_PROTOCOL};
    }

    public eventAck(eventName: string, data: IEventBody) {
        if (eventName === "received-chat-msg") {
            const evData = data as IReceivedImMsg;
            const messageId = evData.message.id;
            if (!messageId) {
                log.debug("Cannot send RR for message without an ID");
                return;
            }
            log.debug(`Got ack for sending a message -> ${messageId}`);
            this.emitReadReciepts(messageId, evData.conv!.name, false);
        }
    }

    public emitReadReciepts(messageId: string, convName: string, originIsMatrix: boolean) {
        // Filter for users in this MUC.
        this.lastMessageInMUC.set(convName, {id: messageId, originIsMatrix});
        const activeUsers = [...this.activeMUCUsers.keys()].filter(
            (j) => j.startsWith(convName),
        );
        log.debug(`Emitting ${activeUsers.length} read reciepts`);
        activeUsers.forEach((j) => {
            this.emit("read-receipt", {
                eventName: "read-receipt",
                sender: j,
                messageId,
                conv: {
                    // Don't include the handle
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: null, // TODO: Lazy shortcut.
                },
                isGateway: false,
                originIsMatrix,
            } as IChatReadReceipt);
        });
    }

    public async getVCard(who: string, sender?: string): Promise<Element> {
        const id = uuid();
        const whoJid = jid(who);
        who = `${whoJid.local}@${whoJid.domain}`;
        log.info(`Fetching vCard for ${who}`);
        const res = new Promise((resolve: (e: Element) => void, reject) => {
            const timeout = setTimeout(() => reject(Error("Timeout")), 5000);
            this.once(`iq.${id}`, (stanza: Element) => {
                clearTimeout(timeout);
                const vCard = (stanza.getChild("vCard") as unknown as Element); // Bad typigns.
                if (vCard) {
                    resolve(vCard);
                }
                reject(Error("No vCard given"));
            });
        });
        // Remove the resource
        await this.xmppSend(
            new StzaIqVcardRequest(sender || this.xmppAddress.toString(), who, id),
        );
        Metrics.remoteCall("xmpp.iq.vc2");
        return res;
    }

    private generateIdforMsg(stanza: Element) {
        const body = stanza.getChildText("body");

        if (body) {
            return Buffer.from(`${stanza.getAttr("from")}${body}`).toString("base64");
        }

        return Buffer.from(stanza.toString()).toString("base64");
    }

    private async onStanza(stanza: Element) {
        const startedAt = Date.now();
        const id = stanza.attrs.id = stanza.attrs.id || this.generateIdforMsg(stanza);
        if (this.seenMessages.has(id)) {
            return;
        }
        this.xmppAddSentMessage(id);
        log.debug("Stanza:", stanza.toJSON());
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;

        const isOurs = to !== null && to.domain === this.myAddress.domain;
        log.info(`Got ${stanza.name} from=${from} to=${to} isOurs=${isOurs}`);
        const alias = isOurs && to!.local.startsWith("#") && this.serviceHandler.parseAliasFromJID(to!) || null;
        if (alias && !this.gateway) {
            log.warn("Not handling gateway request, gateways are disabled");
        }
        try {
            if (isOurs) {
                if (stanza.is("iq") && ["get", "set"].includes(stanza.getAttr("type"))) {
                    await this.serviceHandler.handleIq(stanza, this.bridge.getIntent());
                    return;
                }
                // If it wasn't an IQ or a room, then it's probably a PM.
            }

            if (alias && stanza.is("presence")) {
                this.gateway!.handleStanza(stanza, alias);
                return;
            }

            if (stanza.is("message")) {
                this.handleMessageStanza(stanza, alias);
            } else if (stanza.is("presence")) {
                this.handlePresenceStanza(stanza, alias);
            } else if (stanza.is("iq") &&
                ["result", "error"].includes(stanza.getAttr("type")) &&
                stanza.attrs.id) {
                this.emit("iq." + id, stanza);
            } else if (stanza.is("iq") && stanza.getAttr("type") === "get" && isOurs) {
                this.serviceHandler.handleIq(stanza, this.bridge.getIntent());
            }
        } catch (ex) {
            log.warn("Failed to handle stanza: ", ex);
            Metrics.requestOutcome(true, Date.now() - startedAt, "fail");
        }
        Metrics.requestOutcome(true, Date.now() - startedAt, "success");
    }

    public async checkGroupExists(properties: IChatJoinProperties) {
        const props = {
            room: properties.room as string,
            server: properties.server as string,
        }
        if (!props.server) {
            throw Error("Missing property server");
        }
        if (!props.room) {
            throw Error("Missing property room");
        }
        const to = `${props.room}@${props.server}`;
        const id = uuid();
        log.info(`Checking if ${to} is is a MUC`);
        try {
            const result = await this.sendIq(new StzaIqDiscoInfo(this.myAddress.toString(), to, id, "get"));
            log.debug(`Found ${to}`);
            const isMuc = result.getChild("query")?.getChildByAttr("var", "http://jabber.org/protocol/muc");
            return !!isMuc;
        } catch (ex) {
            // TODO: Factor this out, error parsing would be useful.
            log.info(`Could not find ${to}`);
            if (ex.error) {
                const error = ex.error as Element;
                const code = error.getAttr("code");
                const type = error.getAttr("type");
                const text = error.getChildText("text");
                log.info(`checkGroupExists: ${code} ${type} ${text}`);
            } else {
                log.info(`checkGroupExists: ${ex}`);
            }
            return false;
        }
    }


    private async handleMessageStanza(stanza: Element, alias: string|null) {
        if (!stanza.attrs.from || !stanza.attrs.to) {
            return;
        }
        const to = jid(stanza.attrs.to)!;
        let localAcct: any = this.accounts.get(`${to!.local}@${to!.domain}`)!;
        let from = jid(stanza.attrs.from);
        let convName = `${from.local}@${from.domain}`;

        if (alias) {
            // If this is an alias, we want to do some gateway related things.
            if (!to.resource) {
                // Group message to a MUC, so reflect it to other XMPP users
                // and set the right to/from addresses.
                convName = `${to.local}@${to.domain}`;
                log.info(`Sending gateway group message to ${convName}`);
                if (!(await this.gateway!.reflectXMPPMessage(convName, stanza))) {
                    log.warn(`Message could not be sent, not forwarding to Matrix`);
                    return;
                }
                // We deliberately do not anonymize the JID here.
                // We do however strip the resource
                from = jid(`${from.local}@${from.domain}`);
            } else {
                // This is a PM, then.
                convName = `${to.local}@${to.domain}`;
                const userId = this.gateway!.getMatrixIDForJID(convName, to);
                if (userId) {
                    // This is a PM *to* matrix
                    log.info(`Sending gateway PM to ${userId} (${to})`);
                    localAcct = undefined;
                    for (const acct of this.accounts.values()) {
                        if (acct.mxId === userId) {
                            localAcct = acct;
                            break;
                        }
                    }
                    if (localAcct === undefined) {
                        log.warn(`No account defined for ${userId}, registering new account.`);
                        localAcct = await this.autoRegister!.registerUser(XMPP_PROTOCOL.id, userId) as XmppJsAccount;
                    }
                    const anonJid = this.gateway!.getAnonIDForJID(`${to.local}@${to.domain}`, from);
                    if (anonJid) {
                        from = jid(anonJid);
                    } else {
                        log.error("Couldn't find anon jid for PM");
                        return;
                    }
                } else {
                    // This is a PM to another XMPP user, easy.
                    log.info(`Sending gateway PM to XMPP user (${to})`);
                    this.gateway!.reflectPM(stanza);
                    return;
                }
            }
        }
        const chatState = stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/chatstates");

        if (stanza.attrs.type === "error") {
            // We got an error back from sending a message, let's handle it.
            const error = stanza.getChild("error")!;
            log.warn(`Message ${stanza.attrs.id} returned an error: `, error.toString());
            if (error.attrs.code === "406" && error.getChild("not-acceptable") && localAcct) {
                log.warn("Got 406/not-acceptable, rejoining room..");
                // https://xmpp.org/extensions/xep-0045.html#message says we
                // should treat this as the user not being joined.
                await localAcct.rejoinChat(convName);
                // TODO: Resend the message?
            }
        }
        const type = stanza.attrs.type;

        if (!localAcct && !alias) {
            // No local account, attempt to autoregister it?
            if (this.autoRegister) {
                try {
                    const acct = await this.autoRegister.reverseRegisterUser(stanza.attrs.to, XMPP_PROTOCOL)!;
                    localAcct = this.getAccount(acct.remoteId, XMPP_PROTOCOL.id, "") as XmppJsAccount;
                } catch (ex) {
                    log.warn("Failed to autoregister user:", ex);
                    return;
                }
            } else {
                log.warn("Could not handle message, auto registration is disabled");
            }
        } else if (!localAcct && alias) {
            // This is a gateway, so setup a fake account.
            localAcct = {
                remoteId: `${to!.local}@${to!.domain}`,
            } as any;
        }

        if (!alias) {
            // This is used to reset a timer that will self ping
            // if no messages get seen. This is pointless on a gateway,
            // so disable it.
            localAcct.xmppBumpLastStanzaTs(convName);
        }

        if (chatState) {
            if (chatState.is("composing") || chatState.is("active") || chatState.is("paused")) {
                const eventName = type === "groupchat" ? "chat-typing" : "im-typing";
                this.emit(eventName, {
                    eventName,
                    conv: {
                        name: convName,
                    },
                    account: {
                        protocol_id: XMPP_PROTOCOL.id,
                        username: localAcct.remoteId,
                    },
                    sender: from.toString(),
                    typing: chatState.is("composing"),
                } as IChatTyping);
            }

            if (chatState.is("active")) {
                // TODO: Should this expire.
                this.activeMUCUsers.add(from.toString());
                const readMsg = this.lastMessageInMUC.get(convName);
                if (readMsg) {
                    log.info(`${from.toString()} became active, updating RR with ${readMsg.id}`);
                    this.emit("read-receipt", {
                        eventName: "read-receipt",
                        sender: from.toString(),
                        messageId: readMsg.id,
                        conv: {
                            // Don't include the handle
                            name: convName,
                        },
                        account: {
                            protocol_id: XMPP_PROTOCOL.id,
                            username: null, // TODO: Lazy shortcut.
                        },
                        isGateway: false,
                        originIsMatrix: readMsg.originIsMatrix,
                    } as IChatReadReceipt);
                }
            } else if (chatState.is("inactive")) {
                log.info(`${from.toString()} became inactive`);
                this.activeMUCUsers.delete(from.toString());
            }
        }

        // XXX: Must be a better way to handle this.
        const subject = stanza.getChildText("subject");
        if (subject && type === "groupchat") {
            // Room names in XMPP are basically just local@domain,
            // and so is sort of implied by the from address. We will emit
            // a room name change at the same time as the subject. The
            // RoomHandler code shoudln't attempt to change the name unless it is wrong.
            this.emit("chat-topic", {
                eventName: "chat-topic",
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: localAcct.remoteId,
                },
                sender: from.toString(),
                string: subject,
                isGateway: false,
            } as IChatStringState);
        }

        const body = stanza.getChild("body");
        if (!body) {
            log.debug("Don't know how to handle a message without children");
            return;
        }
        return this.handleTextMessage(stanza, localAcct, from, convName, alias != null);
    }

    private handleTextMessage(stanza: Element, localAcct: XmppJsAccount, from: JID,
                              convName: string, forceMucPM: boolean) {
        const body = stanza.getChildText("body");
        const replace = stanza.getChildByAttr("xmlns", "urn:xmpp:message-correct:0");
        const type = stanza.attrs.type;
        const attachments: IMessageAttachment[] = [];
        // https://xmpp.org/extensions/xep-0066.html#x-oob
        const attachmentWrapper = stanza.getChild("x");
        if (attachmentWrapper && attachmentWrapper.attrs.xmlns === "jabber:x:oob") {
            const url = attachmentWrapper.getChild("url");
            if (url) {
                attachments.push({
                    uri: url.text(),
                } as IMessageAttachment);
            }
        }

        const message = {
            body,
            formatted: [ ],
            id: stanza.attrs.id,
            original_message: replace ? replace.getAttr("id") : undefined,
            opts: {
                attachments,
            },
        } as IBasicProtocolMessage;

        let html = stanza.getChild("html");
        if (html) {
            html = html.getChild("body") || html;
            message.formatted!.push({
                type: "html",
                body: html.toString(),
            });
        }

        if (type === "groupchat") {
            log.debug("Emitting group message", message);
            this.emit("received-chat-msg", {
                eventName: "received-chat-msg",
                sender: from.toString(),
                message,
                conv: {
                    // Don't include the handle
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: localAcct.remoteId,
                },
                isGateway: false,
            } as IReceivedImMsg);
        } else if (type === "chat" || type === "normal") {
            if (!localAcct) {
                log.debug(`Handling a message to ${convName}, who does not yet exist.`);
            }
            let isMucPm = !!stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/muc#user") || forceMucPM;
            if (!isMucPm) {
                // We can't rely on this due to https://xmpp.org/extensions/xep-0045.html#privatemessage
                // XXX: This makes the broad assumption that we don't cache real JIDs in the presence store.
                // It also assumes that we have seen some presence from this user already.
                isMucPm = !!this.presenceCache.getStatus(from.toString());
            }
            if (!isMucPm && this.config.tuning.conferencePMFallbackCheck) {
                // XXX: Sometimes, we can't even get presence for a user. The ultimate fallback we have is:
                if (from.domain.startsWith("conf")) {
                    isMucPm = true;
                }
            }
            log.debug(`Emitting IM message (isMucPM:${isMucPm})`, message);
            this.emit("received-im-msg", {
                eventName: "received-im-msg",
                sender: isMucPm ? from.toString() : `${from.local}@${from.domain}`,
                message,
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: localAcct.remoteId,
                },
            } as IReceivedImMsg);
        }
    }

    private handlePresenceStanza(stanza: Element, gatewayAlias: string|null) {
        const to = jid(stanza.getAttr("to"));
        // XMPP is case insensitive.
        const localAcct = this.accounts.get(`${to.local}@${to.domain}`);
        const from = jid(stanza.getAttr("from"));
        const convName = `${from.local}@${from.domain}`;
        const delta = this.presenceCache.add(stanza);

        if (!delta) {
            return;
        }

        if (delta.error && localAcct) {
            if (delta.error === "conflict") {
                log.info(`${from.toString()} conflicted with another user, attempting to fix`);
                localAcct.xmppRetryJoin(from).catch((err) => {
                    log.error("Failed to retry join", err);
                });
                return;
            }
            log.error(`Failed to handle presence ${from} ${to} :`, delta.errorMsg);
        }

        const username = localAcct ? localAcct.remoteId : to.toString();

        // emit a chat-joined-new if an account was joining this room.
        if (delta.isSelf
            && localAcct
            && localAcct.waitingToJoin.has(convName)
            && delta.changed.includes("online")) {
            this.emit("store-remote-user", {
                mxId: localAcct.mxId,
                remoteId: `${convName}/${localAcct.roomHandles.get(convName)}`,
                protocol_id: XMPP_PROTOCOL.id,
            } as IStoreRemoteUser);
            this.emit(`chat-joined-new`, {
                eventName: "chat-joined-new",
                purpleAccount: localAcct,
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username,
                },
                join_properties: {
                    room: from.local,
                    server: from.domain,
                    handle: from.resource,
                },
                should_invite: false,
            } as IChatJoined);
        }

        if (delta.changed.includes("offline")) {
            // Because we might not have cleared it yet.
            this.activeMUCUsers.delete(stanza.attrs.from);
            if (delta.isSelf) {
                // XXX: Should we attempt to reconnect/kick the user?
                return;
            }
            const wasKicked = delta.status!.kick;
            let kicker;
            if (wasKicked && wasKicked.kicker) {
                kicker = `${convName}/${wasKicked.kicker}`;
            }

            this.emit("chat-user-left", {
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username,
                },
                sender: stanza.attrs.from,
                state: "left",
                kicker,
                reason: wasKicked ? wasKicked.reason : delta.status!.status,
                gatewayAlias,
            } as IUserStateChanged);
            return;
        }

        if (delta.changed.includes("kick")) {
            log.info("Got kick for user");
            this.emit(delta.status!.ours ? "chat-kick" : "chat-user-kick", {
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username,
                },
                sender: stanza.attrs.from,
                state: "kick",
                gatewayAlias,
            } as IUserStateChanged);
        }

        if (delta.changed.includes("online")) {
            if (delta.status && delta.isSelf && localAcct) {
                // Always emit this.
                this.emit("chat-joined", {
                    eventName: "chat-joined",
                    conv: {
                        name: convName,
                    },
                    account: {
                        protocol_id: XMPP_PROTOCOL.id,
                        username,
                    },
                } as IChatJoined);
                return;
            }
            if (delta.status && !delta.status.ours) {
                if (this.isWaitingToJoin(to) === from.toString()) {
                    // An account is waiting to join this room, so hold off on the
                    return;
                }
                this.emit("chat-user-joined", {
                    conv: {
                        name: convName,
                    },
                    account: {
                        protocol_id: XMPP_PROTOCOL.id,
                        username,
                    },
                    sender: stanza.attrs.from,
                    state: "joined",
                    gatewayAlias,
                } as IUserStateChanged);
            }
        }
    }
}
