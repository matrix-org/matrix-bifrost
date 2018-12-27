import { IPurpleInstance } from "../purple/IPurpleInstance";
import { EventEmitter } from "events";
import { Conversation, accounts } from "node-purple";
import { Logging } from "matrix-appservice-bridge";
import { IConfigPurple } from "../Config";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { component, xml, jid } from "@xmpp/component";
import { XJSBackendOpts } from "./XJSBackendOpts";
import { XmppJsAccount } from "./XJSAccount";
import { IPurpleAccount } from "../purple/IPurpleAccount";
import { IAccountEvent, IChatJoined, IReceivedImMsg, IConversationEvent } from "../purple/PurpleEvents";

const xLog = Logging.get("XMPP-conn");
const log = Logging.get("XmppJsInstance");

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
    private bufferedMessages: {xml: any, resolve: (any: Promise<any>) => void}[];
    constructor () {
        super();
        this.canWrite = false;
        this.accounts = new Map();
        this.bufferedMessages = [];
        this.seenMessages = new Set();
    }

    xmppWriteToStream(xml: any) {
        if (this.canWrite) {
            return this.xmpp.write(xml);
        }
        const p = new Promise((resolve) => {
            this.bufferedMessages.push({xml, resolve});
        });
        return p;
    }

    xmppAddSentMessage(id: string) { this.seenMessages.add(id); }

    getBuddyFromChat(conv: Conversation, buddy: string): any {
        return undefined;
    }

    async start(config: IConfigPurple): Promise<void> {
        const opts = config.backendOpts as XJSBackendOpts;
        if (!opts || !opts.service || !opts.domain || !opts.password) {
            throw Error("Missing opts for xmpp: service, domain, password");
        }
        log.info("Starting new XMPP component instance with", opts);
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
        xmpp.on("stanza", this.onStanza.bind(this));
        
        xmpp.on('online', async address => {
            xLog.info("gone online as " + address);
            this.myAddress = address;
            this.canWrite = true;
            log.info(`flushing ${this.bufferedMessages.length} buffered messages`);
            while (this.bufferedMessages.length) {
                if (!this.canWrite) {
                    return;
                }
                const msg = this.bufferedMessages.splice(0, 1)[0];
                msg.resolve(this.xmpp.write(msg.xml));
            }
        });
          
        // Debug
        xmpp.on('status', status => {
          if (status === "disconnecting" || status === "disconnected") {
              this.canWrite = false;
          }
          xLog.debug("status:", status);
        });
        xmpp.on('input', input => {
            xLog.debug('RX:', input)
        });
        xmpp.on('output', output => {
            xLog.debug('TX:', output)
        });
        await xmpp.start();
        this.xmpp = xmpp;
    }

    signInAccounts(usernames: string[]) {
        usernames.forEach((u) => {this.getAccount(u, XMPP_PROTOCOL.id)});
    }

    private onStanza(stanza: any) {
        log.info("Stanza:", stanza);
        const error = stanza.children.find((e) => e.name === "error");
        
        if (error) {
            log.error("error:", error.children);
        }
        const from = stanza.attrs.from ? jid(stanza.attrs.from) : null;
        const to = stanza.attrs.to ? jid(stanza.attrs.to) : null;
        const convName = `${from.local}@${from.domain}`;
        log.info(`Got from=${from} to=${to}`);

        //"received-im-msg"
        //"received-chat-msg"
        if (stanza.is("message")) {
            const type = stanza.attrs.type;
            const id = stanza.attrs.id;
            if (this.seenMessages.has(id)) {
                return;
            }
            this.seenMessages.add(id);  
            const message = stanza.children.find((e) => e.name === "body").children[0];
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
                        //XXX: We could probably be more sophisticated than this.
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
                    }
                } as IReceivedImMsg);
            }
        } else if (stanza.is("presence")) {
            const localAcct = this.accounts.get(stanza.attrs.to)!;
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
                    }
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
                }
            } as IConversationEvent);
        }
    }

    public getAccount(username: string, protocolId: string): IPurpleAccount|null {
        log.debug("Getting account", username);
        if (protocolId !== "xmpp-js") {
            return null;
        }
        if (this.accounts.has(username)) {
            return this.accounts.get(username)!
        }
        this.accounts.set(username, new XmppJsAccount(username, this));
        // Components don't "connect", so just emit this once we've created it.
        this.emit("account-signed-on", {
            eventName: "account-signed-on",
            account: {
                protocol_id: XMPP_PROTOCOL.id,
                username,
            }
        } as IAccountEvent);
        return this.accounts.get(username)!;
    }

    public getProtocol(id: string): PurpleProtocol|undefined {
        if (id === "xmpp-js") { return XMPP_PROTOCOL; }
    }

    getProtocols(): PurpleProtocol[] {
        return [XMPP_PROTOCOL];
    }

    findProtocol(nameOrId: string): PurpleProtocol|undefined {
        if (nameOrId.toLowerCase() === "xmpp-js") { return XMPP_PROTOCOL; }
    }

    getNickForChat(conv: Conversation): string {
        throw new Error("Not supported.");
    }
}