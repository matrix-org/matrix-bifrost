import { IPurpleInstance } from "../purple/IPurpleInstance";
import { EventEmitter } from "events";
import { Logging, MatrixUser } from "matrix-appservice-bridge";
import { IConfigPurple } from "../Config";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { component } from "@xmpp/component";
import { Element } from "@xmpp/xml";
import { jid, JID } from "@xmpp/jid";
import { IXJSBackendOpts } from "./XJSBackendOpts";
import { XmppJsAccount } from "./XJSAccount";
import { IPurpleAccount } from "../purple/IPurpleAccount";
import { IAccountEvent,
    IChatJoined,
    IReceivedImMsg,
    IConversationEvent,
    IUserStateChanged,
    IChatTyping} from "../purple/PurpleEvents";
import { IBasicProtocolMessage, IMessageAttachment } from "../MessageFormatter";
import { PresenceCache } from "./PresenceCache";
import { Metrics } from "../Metrics";
import { ServiceHandler } from "./ServiceHandler";

const xLog = Logging.get("XMPP-conn");
const log = Logging.get("XmppJsInstance");

class XmppProtocol extends PurpleProtocol {
    constructor() {
        super({
            id: "xmpp-js",
            name: "XMPP.js Protocol Plugin",
            homepage: "N/A",
            summary: "Fake purple protocol plugin for xmpp.js",
        }, false, false);
    }

    public getMxIdForProtocol(
            senderId: string,
            domain: string,
            prefix: string = "",
            isGroupChat: boolean = false) {
        // This is a little bad, but we drop the prpl- because it's a bit ugly.
        const protocolName = this.id.startsWith("prpl-") ? this.id.substr("prpl-".length) : this.id;
        // senderId containing : can mess things up
        senderId = senderId.replace(/\:/g, "=3a");
        const j = jid(senderId);
        const resource = j.resource ? j.resource + "_" : "";
        return new MatrixUser(`@${prefix}${resource}${j.local}_${j.domain}:${domain}`);
    }
}

export const XMPP_PROTOCOL = new XmppProtocol();

export class XmppJsInstance extends EventEmitter implements IPurpleInstance {
    public readonly presenceCache: PresenceCache;
    private serviceHandler: ServiceHandler;
    private xmpp?: any;
    private myAddress!: string;
    private accounts: Map<string, XmppJsAccount>;
    private seenMessages: Set<string>;
    private canWrite: boolean;
    private defaultRes!: string;
    private connectionWasDropped: boolean;
    private bufferedMessages: Array<{xmlMsg: Element, resolve: (res: Promise<void>) => void}>;
    private intent;
    constructor() {
        super();
        this.canWrite = false;
        this.accounts = new Map();
        this.bufferedMessages = [];
        this.seenMessages = new Set();
        this.presenceCache = new PresenceCache();
        this.serviceHandler = new ServiceHandler(this);
        this.connectionWasDropped = false;
    }

    get defaultResource(): string {
        return this.defaultRes;
    }

    public createPurpleAccount(username) {
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

    public xmppAddSentMessage(id: string) { this.seenMessages.add(id); }

    public isOurJid(j: JID): boolean {
        for (const acct of this.accounts.values()) {
            if (acct.roomHandles.get(`${j.local}@${j.domain}`) === j.resource) {
                return true;
            }
        }
        return false;
    }

    public getBuddyFromChat(conv: any, buddy: string): any {
        return undefined;
    }

    public async start(config: IConfigPurple, intent?: any): Promise<void> {
        this.intent = intent;
        const opts = config.backendOpts as IXJSBackendOpts;
        if (!opts || !opts.service || !opts.domain || !opts.password) {
            throw Error("Missing opts for xmpp: service, domain, password");
        }
        this.defaultRes = opts.defaultResource ? opts.defaultResource : "matrix-bridge";
        log.info(`Starting new XMPP component instance to ${opts.service} using domain ${opts.domain}`);
        const xmpp = component({
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

        xmpp.on("online", async (address) => {
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
          if (status === "close") {
              this.connectionWasDropped = true;
          }
          xLog.debug("status:", status);
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
            this.getAccount(mxidUsernames[mxid], XMPP_PROTOCOL.id, mxid);
        });
    }

    public getAccountForJid(aJid: JID): XmppJsAccount|undefined {
        if (aJid.domain === this.myAddress) {
            return this.accounts.get(aJid.local);
        }
        // TODO: Handle MUC based JIDs?
        return;
    }

    public getAccount(username: string, protocolId: string, mxid: string): IPurpleAccount|null {
        const uLower = username.toLowerCase();
        log.debug("Getting account", username);
        if (protocolId !== "xmpp-js") {
            return null;
        }
        if (this.accounts.has(uLower)) {
            return this.accounts.get(uLower)!;
        }
        this.accounts.set(uLower, new XmppJsAccount(username, this.defaultRes, this, mxid));
        // Components don't "connect", so just emit this once we've created it.
        this.emit("account-signed-on", {
            eventName: "account-signed-on",
            account: {
                protocol_id: XMPP_PROTOCOL.id,
                username,
            },
        } as IAccountEvent);
        return this.accounts.get(username)!;
    }

    public getProtocol(id: string): PurpleProtocol|undefined {
        if (id === "xmpp-js") { return XMPP_PROTOCOL; }
    }

    public getProtocols(): PurpleProtocol[] {
        return [XMPP_PROTOCOL];
    }

    public findProtocol(nameOrId: string): PurpleProtocol|undefined {
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
            prefix: string = ""): {username: string, protocol: PurpleProtocol} {
        let uName = new MatrixUser(mxid, false).localpart;
        uName = uName.replace(prefix, "");
        // XXX: Gah, underscore spittling is hard with a resource.
        uName = uName.replace(/\=3a/g, ":");
        const splitParts = uName.split("_");
        const username =
            `${splitParts.slice(0, splitParts.length - 1 ).join("_")}@${splitParts[splitParts.length - 1]}`;
        return {username, protocol: XMPP_PROTOCOL};
    }

    private generateIdforMsg(stanza: Element) {
        const body = stanza.getChildText("body");

        if (body) {
            return Buffer.from(`${stanza.getAttr("from")}${body}`).toString("base64");
        }

        return Buffer.from(stanza.children.map((c) => c.toString()).join("")).toString("base64");
    }

    private onStanza(stanza: Element) {
        const startedAt = Date.now();
        const id = stanza.attrs.id || this.generateIdforMsg(stanza);
        if (this.seenMessages.has(id)) {
            return;
        }
        this.seenMessages.add(id);
        log.debug("Stanza:", stanza.toJSON());
        const error: any = stanza.getChild("error") || null;

        if (error) {
            log.error("Stanza had error:", error.children);
        }
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;
        log.info(`Got from=${from} to=${to}`);

        try {
            if (stanza.is("message")) {
                this.handleMessageStanza(stanza);
            } else if (stanza.is("presence")) {
                this.handlePresenceStanza(stanza);
            } else if (stanza.is("iq") && stanza.getAttr("get")) {
                this.serviceHandler.handleIq(stanza, this.intent);
            } else if (stanza.is("iq") &&
                ["result", "error"].includes(stanza.getAttr("type")) &&
                stanza.attrs.id) {
                this.emit("iq." + id, stanza);
            }
        } catch (ex) {
            log.warn("Failed to handle stanza: ", ex);
            Metrics.requestOutcome(true, Date.now() - startedAt, "fail");
        }
        Metrics.requestOutcome(true, Date.now() - startedAt, "success");
    }

    private handleMessageStanza(stanza: Element) {
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;
        const localAcct = this.accounts.get(`${to!.local}@${to!.domain}`)!;
        if (!from) {
            return;
        }
        const convName = `${from.local}@${from.domain}`;
        const type = stanza.attrs.type;
            // a room name change at the same time as the subject. The
            // RoomHandler code shoudln't attempt to change the name unless it is wrong.
        }
        const chatState = stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/chatstates");
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
                    sender: stanza.attrs.from,
                    typing: chatState.is("composing"),
                } as IChatTyping);
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
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: localAcct.remoteId,
                },
                sender: stanza.attrs.from,
                string: subject,
            });
        }

        const body = stanza.getChildText("body");
        if (!body) {
            log.debug("Don't know how to handle a message without children");
            return;
        }
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
                sender: stanza.attrs.from,
                message,
                conv: {
                    // Don't include the handle
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: localAcct.remoteId,
                },
            } as IReceivedImMsg);
        } else if (type === "chat") {
            if (!localAcct) {
                log.debug(`Handling a message to ${to}, who does not yet exist.`);
            }
            log.debug("Emitting chat message", message);
            const isMucPm = stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/muc#user");
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

    private handlePresenceStanza(stanza: Element) {
        const to = jid(stanza.getAttr("to"));
        // XMPP is case insensitive.
        const localAcct = this.accounts.get(`${to.local}@${to.domain}`)!;
        const from = jid(stanza.getAttr("from"));
        const convName = `${from.local}@${from.domain}`;

        const delta = this.presenceCache.add(stanza);
        if (!delta) {
            return;
        }
        log.debug("Presence delta:", delta);

        if (delta.error) {
            if (delta.error === "conflict") {
                log.info(`${from.toString()} conflicted with another user, attempting to fix`);
                localAcct.xmppRetryJoin(from).catch((err) => {
                    log.error("Failed to retry join", err);
                });
                return;
            }
            log.error(`Failed to join ${from} ${to} :`, delta.errorMsg);
        }

        // emit a chat-joined-new if an account was joining this room.
        if (delta.isSelf && localAcct.waitingToJoin.has(convName)) {
            localAcct.waitingToJoin.delete(convName);
            this.emit(`chat-joined-new`, {
                eventName: "chat-joined-new",
                purpleAccount: localAcct,
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: localAcct.protocol.id,
                    username: localAcct.remoteId,
                },
                join_properties: {
                    room: from.local,
                    server: from.domain,
                    handle: from.resource,
                },
            } as IChatJoined);
        }

        if (delta.changed.includes("offline")) {
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
                    protocol_id: localAcct!.protocol.id,
                    username: localAcct!.remoteId,
                },
                sender: stanza.attrs.from,
                state: "left",
                kicker,
                reason: wasKicked ? wasKicked.reason : delta.status!.status,
            } as IUserStateChanged);
            return;
        }

        if (delta.changed.includes("online")) {
            if (delta.status && delta.isSelf) {
                // Always emit this.
                this.emit("chat-joined", {
                    eventName: "chat-joined",
                    conv: {
                        name: convName,
                    },
                    account: {
                        protocol_id: localAcct.protocol.id,
                        username: localAcct.remoteId,
                    },
                } as IConversationEvent);
                return;
            }
            if (delta.status && !delta.status.ours) {
                this.emit("chat-user-joined", {
                    conv: {
                        name: convName,
                    },
                    account: {
                        protocol_id: localAcct.protocol.id,
                        username: localAcct.remoteId,
                    },
                    sender: stanza.attrs.from,
                    state: "joined",
                } as IUserStateChanged);
            }
        }
    }
}
