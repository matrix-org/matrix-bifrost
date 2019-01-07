import { IPurpleInstance } from "../purple/IPurpleInstance";
import { EventEmitter } from "events";
import { Logging } from "matrix-appservice-bridge";
import { IConfigPurple } from "../Config";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { component, xml, jid } from "@xmpp/component";
import { IXJSBackendOpts } from "./XJSBackendOpts";
import { XmppJsAccount } from "./XJSAccount";
import { IPurpleAccount } from "../purple/IPurpleAccount";
import { IAccountEvent,
    IChatJoined,
    IReceivedImMsg,
    IConversationEvent,
    IUserStateChanged } from "../purple/PurpleEvents";
import { IBasicProtocolMessage, IMessageAttachment } from "../MessageFormatter";
import { PresenceCache } from "./PresenceCache";
import { Metrics } from "../Metrics";

const xLog = Logging.get("XMPP-conn");
const log = Logging.get("XmppJsInstance");

export const XMPP_PROTOCOL = new PurpleProtocol({
    id: "xmpp-js",
    name: "XMPP.js Protocol Plugin",
    homepage: "N/A",
    summary: "Fake purple protocol plugin for xmpp.js",
}, false, false);

export class XmppJsInstance extends EventEmitter implements IPurpleInstance {
    public readonly presenceCache: PresenceCache;
    private xmpp?: any;
    private myAddress: any;
    private accounts: Map<string, XmppJsAccount>;
    private seenMessages: Set<string>;
    private canWrite: boolean;
    private defaultRes!: string;
    private bufferedMessages: Array<{xmlMsg: any, resolve: (res: Promise<any>) => void}>;
    constructor() {
        super();
        this.canWrite = false;
        this.accounts = new Map();
        this.bufferedMessages = [];
        this.seenMessages = new Set();
        this.presenceCache = new PresenceCache();
    }

    get defaultResource(): string {
        return this.defaultRes;
    }

    public createPurpleAccount(username) {
        return new XmppJsAccount(username, this.defaultRes, this);
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

    public getBuddyFromChat(conv: any, buddy: string): any {
        return undefined;
    }

    public async start(config: IConfigPurple): Promise<void> {
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

    public signInAccounts(usernames: string[]) {
        usernames.forEach((u) => {this.getAccount(u, XMPP_PROTOCOL.id); });
    }

    public getAccount(username: string, protocolId: string): IPurpleAccount|null {
        const uLower = username.toLowerCase();
        log.debug("Getting account", username);
        if (protocolId !== "xmpp-js") {
            return null;
        }
        if (this.accounts.has(uLower)) {
            return this.accounts.get(uLower)!;
        }
        this.accounts.set(uLower, new XmppJsAccount(username, this.defaultRes, this));
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

    private generateIdforMsg(stanza: xml.Element) {
        const body = stanza.getChildText("body");

        if (body) {
            return Buffer.from(`${stanza.getAttr("from")}${body}`).toString("base64");
        }

        return Buffer.from(stanza.children.map((c) => c.toString()).join("")).toString("base64");
    }

    private onStanza(stanza: xml.Element) {
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

        // "received-im-msg"
        // "received-chat-msg"
        try {
            if (stanza.is("message")) {
                this.handleMessageStanza(stanza);
            } else if (stanza.is("presence")) {
                this.handlePresenceStanza(stanza);
            }
        } catch (ex) {
            log.warn("Failed to handle stanza: ", ex);
            Metrics.requestOutcome(true, Date.now() - startedAt, "fail");
        }
        Metrics.requestOutcome(true, Date.now() - startedAt, "success");
    }

    private handleMessageStanza(stanza: xml.Element) {
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;
        const localAcct = this.accounts.get(`${to!.local}@${to!.domain}`)!;
        if (!from) {
            return;
        }
        const convName = `${from.local}@${from.domain}`;
        const type = stanza.attrs.type;
        const subject = stanza.getChildText("subject");
        if (subject) {
            this.emit("chat-topic", {
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    // XXX: We could probably be more sophisticated than this.
                    username: this.accounts.keys().next().value,
                },
                sender: stanza.attrs.from,
                string: subject,
            });
            // Room names in XMPP are basically just local@domain,
            // and so is sort of implied by the from address. We will emit
            // a room name change at the same time as the subject. The
            // RoomHandler code shoudln't attempt to change the name unless it is wrong.
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
            formatted: [

            ],
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
            log.debug("Emitting chat message", message);
            this.emit("received-im-msg", {
                eventName: "received-im-msg",
                sender: stanza.attrs.from,
                message,
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: localAcct.remoteId,
                },
            } as IReceivedImMsg);
        }
    }

    private handlePresenceStanza(stanza: xml.Element) {
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
                reason: delta.status!.status,
            } as IUserStateChanged);
            return;
        }

        if (delta.changed.includes("online")) {
            if (delta.isSelf) {
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
            return;
        }
    }
}
