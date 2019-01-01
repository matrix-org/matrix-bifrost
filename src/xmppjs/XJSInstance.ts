import { IPurpleInstance } from "../purple/IPurpleInstance";
import { EventEmitter } from "events";
import { Logging } from "matrix-appservice-bridge";
import { IConfigPurple } from "../Config";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { component, xml, jid } from "@xmpp/component";
import { IXJSBackendOpts } from "./XJSBackendOpts";
import { XmppJsAccount } from "./XJSAccount";
import { IPurpleAccount } from "../purple/IPurpleAccount";
import { IAccountEvent, IChatJoined, IReceivedImMsg, IConversationEvent } from "../purple/PurpleEvents";
import { IBasicProtocolMessage, IMessageAttachment } from "../MessageFormatter";

const xLog = Logging.get("XMPP-conn");
const log = Logging.get("XmppJsInstance");
const LOCK_TIME_MS = 1500;

export const XMPP_PROTOCOL = new PurpleProtocol({
    id: "xmpp-js",
    name: "XMPP.js Protocol Plugin",
    homepage: "N/A",
    summary: "Fake purple protocol plugin for xmpp.js",
}, false, false);

export class XmppJsInstance extends EventEmitter implements IPurpleInstance {
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
        xmpp.on("input", (input) => {
            xLog.debug("RX:", input);
        });
        xmpp.on("output", (output) => {
            xLog.debug("TX:", output);
        });
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

    private onStanza(stanza: any) {
        const id = stanza.attrs.id;
        if (this.seenMessages.has(id)) {
            return;
        }
        this.seenMessages.add(id);
        log.debug("Stanza:", stanza);
        const error: any = stanza.getChild("error") || null;

        if (error) {
            log.error("Stanza had error:", error.children);
        }
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;
        const convName = `${from.local}@${from.domain}`;
        log.info(`Got from=${from} to=${to}`);

        // "received-im-msg"
        // "received-chat-msg"
        if (stanza.is("message")) {
            this.handleMessageStanza(stanza);
        } else if (stanza.is("presence")) {
            this.handlePresenceStanza(stanza);
        }
    }

    private handleMessageStanza(stanza) {
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;
        const convName = `${from.local}@${from.domain}`;
        const type = stanza.attrs.type;

        const bodyWrapper = stanza.getChild("body");
        let body = "";
        const attachments: IMessageAttachment[] = [];
        if (bodyWrapper && bodyWrapper.children) {
            body = bodyWrapper.text();
        } else {
            log.debug("Don't know how to handle a message without children");
            return;
        }
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
            id: stanza.attrs.id,
            opts: {
                   attachments,
            },
        } as IBasicProtocolMessage;

        if (type === "groupchat") {
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
                    // XXX: We could probably be more sophisticated than this.
                    username: this.accounts.keys().next().value,
                },
            } as IReceivedImMsg);
        } else if (type === "chat") {
            this.emit("received-im-msg", {
                eventName: "received-im-msg",
                sender: stanza.attrs.from,
                message,
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: to,
                },
            } as IReceivedImMsg);
        }
    }

    private handlePresenceStanza(stanza) {
        const localAcct = this.accounts.get(stanza.attrs.to)!;
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;
        const convName = `${from.local}@${from.domain}`;

        if (!localAcct) {
            log.debug(`Not handling presence for ${stanza.attrs.to}, not a local account`);
            return;
        }

        // emit a chat-joined-new if an account was joining this room.
        if (localAcct.waitingToJoin.has(convName)) {
            localAcct.waitingToJoin.delete(convName);
            this.emit(`chat-joined-new`, {
                eventName: "chat-joined-new",
                purpleAccount: localAcct,
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: localAcct!.protocol.id,
                    username: localAcct!.remoteId,
                },
                join_properties: {
                    room: from.local,
                    server: from.domain,
                    handle: from.resource,
                },
            } as IChatJoined);
        }
        // Always emit this.
        this.emit("chat-joined", {
            eventName: "chat-joined",
            conv: {
                name: convName,
            },
            account: {
                protocol_id: localAcct!.protocol.id,
                username: localAcct!.remoteId,
            },
        } as IConversationEvent);

    }
}
