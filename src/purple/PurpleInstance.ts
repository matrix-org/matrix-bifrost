// @ts-ignore - These are optional.
import { helper, plugins, messaging, Conversation } from "node-purple";
import { EventEmitter } from "events";
import { PurpleAccount } from "./PurpleAccount";
import { IBifrostInstance } from "../bifrost/Instance";
import { Logging } from "matrix-appservice-bridge";
import * as path from "path";
import { IConfigPurple } from "../Config";
import { IUserInfo, IConversationEvent, IEventBody } from "../bifrost/Events";
import { BifrostProtocol } from "../bifrost/Protocol";
const log = Logging.get("PurpleInstance");

export class PurpleInstance extends EventEmitter implements IBifrostInstance {
    private protocols: BifrostProtocol[];
    private accounts: Map<string, PurpleAccount>;
    private interval?: NodeJS.Timeout;
    constructor(private config: IConfigPurple) {
        super();
        this.protocols = [];
        this.accounts = new Map();
    }

    public createBifrostAccount(username, protocol: BifrostProtocol) {
        return new PurpleAccount(username, protocol);
    }

    public get gateway(): null {
        return null; // Not supported.
    }

    public async start() {
        log.info("Starting purple instance");
        const pluginDir = path.resolve(this.config.pluginDir);
        log.info("Plugin search path is set to ", pluginDir);
        helper.setupPurple({
            debugEnabled: this.config.enableDebug ? 1 : 0,
            pluginDir,
            userDir: undefined,
        });
        log.info("Started purple instance");
        this.protocols = plugins.get_protocols().map(
            (data) => new BifrostProtocol(data),
        );
        log.info("Got supported protocols:", this.protocols.map((p) => p.id).join(" "));
        this.interval = setInterval(this.eventHandler.bind(this), 300);
    }

    public getAccount(username: string, protocolId: string, mxid: string, force: boolean = false): PurpleAccount|null {
        const key = `${protocolId}://${username}`;
        let acct = this.accounts.get(key);
        if (!acct || force) {
            const protocol = this.getProtocol(protocolId);
            if (protocol === undefined) {
                throw new Error("Protocol not found");
            }
            acct = new PurpleAccount(username, protocol);
            try {
                acct.findAccount();
            } catch (ex) {
                return null;
            }
            this.accounts.set(key, acct);
        }
        return acct;
    }

    public getProtocol(id: string): BifrostProtocol|undefined {
        return this.protocols.find((proto) => proto.id === id);
    }

    public getProtocols(): BifrostProtocol[] {
        return this.protocols;
    }

    public findProtocol(nameOrId: string): BifrostProtocol|undefined {
        return this.getProtocols().find(
            (protocol) => protocol.name.toLowerCase() === nameOrId || protocol.id.toLowerCase() === nameOrId,
        );
    }

    public getBuddyFromChat(conv: Conversation, buddyName: string) {
        messaging.getBuddyFromConv(conv.handle, buddyName);
    }

    public getNickForChat(conv: Conversation): string {
        return messaging.getNickForChat(conv.handle);
    }

    public needsDedupe() {
        return true;
    }

    public needsAccountLock() {
        return true;
    }

    public getUsernameFromMxid(
            mxid: string,
            prefix: string = ""): {username: string, protocol: BifrostProtocol} {
        throw Error("Not implemented yet");
    }

    public pushEvent() {
        // This is for gateways, and we aren't a gateway yet.
    }

    public eventAck() {
        // This is for handling stuff after an event has been sent.
    }

    private eventHandler() {
        helper.pollEvents().forEach((evt) => {
            if (!["received-chat-msg"].includes(evt.eventName)) {
                log.debug(`Got ${evt.eventName} from purple`);
            }
            if (evt.eventName === "chat-joined") {
                const chatJoined = evt as IConversationEvent;
                const purpleAccount = this.getAccount(chatJoined.account.username, chatJoined.account.protocol_id, "");
                if (purpleAccount) {
                    if (purpleAccount._waitingJoinRoomProps) {
                        // tslint:disable-next-line
                        const join_properties = purpleAccount._waitingJoinRoomProps;
                        this.emit("chat-joined-new", Object.assign(evt, {
                            purpleAccount,
                            join_properties,
                            should_invite: true,
                        }));
                        purpleAccount.eraseWaitingJoinRoomProps();
                    }
                }
            }
            if (["received-chat-msg", "received-im-msg"].includes(evt.eventName)) {
                const rawEvent = evt as any;
                evt = Object.assign(evt, {
                    message: {
                        body: rawEvent.message,
                    },
                });
            }
            this.emit(evt.eventName, evt);
            if (evt.eventName === "user-info-response") {
                const uinfo = evt as IUserInfo;
                const pAccount = this.accounts.get(`${uinfo.account.protocol_id}://${uinfo.account.username}`);
                if (pAccount) {
                    pAccount.passUserInfoResponse(uinfo);
                } else {
                    log.warn("No account found for response");
                }
            }
        });
    }

}
