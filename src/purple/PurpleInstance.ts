// @ts-ignore - These are optional.
import { helper, plugins, messaging, Conversation } from "node-purple";
import { EventEmitter } from "events";
import { PurpleAccount } from "./PurpleAccount";
import { IBifrostInstance } from "../bifrost/Instance";
import { Logging } from "matrix-appservice-bridge";
import * as path from "path";
import { IConfigPurple } from "../Config";
import { IUserInfo, IConversationEvent } from "../bifrost/Events";
import { BifrostProtocol } from "../bifrost/Protocol";
import { promises as fs } from "fs";
import { PurpleProtocol } from "./PurpleProtocol";

const log = Logging.get("PurpleInstance");

const DEFAULT_PLUGIN_DIR = "/usr/lib/purple-2";
export interface IPurpleBackendOpts {
    debugEnabled: boolean;
    pluginDir: string;
    dataDir?: string;
    soloProtocol?: string;
    protocolOptions?: {[pluginName: string]: {
        // E.g. {0}@foo,FOO/{0}
        usernameFormat: string;
    }}
}

export class PurpleInstance extends EventEmitter implements IBifrostInstance {
    private protocols: BifrostProtocol[];
    private accounts: Map<string, PurpleAccount>;
    private interval?: NodeJS.Timeout;
    private backendOpts?: IPurpleBackendOpts;
    constructor(private config: IConfigPurple) {
        super();
        this.backendOpts = this.config.backendOpts as IPurpleBackendOpts;
        this.protocols = [];
        this.accounts = new Map();
    }

    public createBifrostAccount(username, protocol: BifrostProtocol) {
        // We might want to format this one.
        const protocolOptions = (this.backendOpts?.protocolOptions || {})[protocol.id];
        if (protocolOptions?.usernameFormat) {
            // Replaces %-foo with username-foo
            username = protocolOptions.usernameFormat.replace(/\%/g, username);
        }
        return new PurpleAccount(username, protocol);
    }

    public async checkGroupExists() {
        // We don't check this, so just return true.
        return true;
    }

    public get gateway(): null {
        return null; // Not supported.
    }

    public usingSingleProtocol() {
        return this.backendOpts.soloProtocol;
    }

    public async start() {
        log.info("Starting purple instance");
        const pluginDir = path.resolve(this.backendOpts?.pluginDir || DEFAULT_PLUGIN_DIR);
        try {
            await fs.access(pluginDir);
        } catch (ex) {
            throw Error(
                `Could not verify purple plugin directory "${pluginDir}" exists.` +
                "You may need to install libpurple plugins OR set the correct directory in your config.",
            );
        }
        log.info("Plugin search path is set to", pluginDir);
        const userDir = this.backendOpts?.dataDir ? path.resolve(this.backendOpts.dataDir) : undefined;
        log.info("User directory is set to", userDir);
        helper.setupPurple({
            debugEnabled: this.backendOpts?.debugEnabled ? 1 : 0,
            pluginDir,
            userDir,
        });
        log.info("Started purple instance");
        this.protocols = plugins.get_protocols().map(
            (data) => new PurpleProtocol(data, !!this.backendOpts.soloProtocol),
        );
        log.info("Got supported protocols:", this.protocols.map((p) => p.id).join(" "));
        if (this.backendOpts.soloProtocol) {
            log.info(`Using solo plugin ${this.backendOpts.soloProtocol}`);
            if (!this.getProtocol(this.backendOpts.soloProtocol)) {
                throw Error('Solo plugin defined but not in list of supported plugins')
            }
        }
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
        return this.protocols.find((proto) => {
            return proto.id === id;
        });
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

    public async close() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }

    public getUsernameFromMxid(
            mxid: string,
            prefix: string = ""): {username: string, protocol: BifrostProtocol} {
        const local = mxid.substring(`@${prefix}`.length).split(":")[0];
        const [protocolId, ...usernameParts] = local.split("_");
        if (this.backendOpts.soloProtocol) {
            // This is using a solo protocol, so ignore the leading protocol name.
            usernameParts.splice(0,0, protocolId);
        }
        // As per bifrost/Protocol.ts, we remove prpl-
        const protocol = this.getProtocol(this.backendOpts.soloProtocol || `prpl-${protocolId}`);
        const username = usernameParts.join("_").replace(/=3a/g, ":").replace(/=40/g, "@");
        if (!protocol) {
            throw Error(`Could not find protocol ${protocol}`);
        }
        return {
            protocol,
            username,
        }
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
