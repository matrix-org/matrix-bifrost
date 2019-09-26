import { Cli, Bridge, AppServiceRegistration, Logging } from "matrix-appservice-bridge";
import { EventEmitter } from "events";
import { MatrixEventHandler } from "./MatrixEventHandler";
import { MatrixRoomHandler } from "./MatrixRoomHandler";
import { IBifrostInstance } from "./bifrost/Instance";
import {  IAccountEvent } from "./bifrost/Events";
import { ProfileSync } from "./ProfileSync";
import { IEventRequest } from "./MatrixTypes";
import { RoomSync } from "./RoomSync";
import { IStore, initiateStore } from "./store/Store";
import { Deduplicator } from "./Deduplicator";
import { Config, IBridgeBotAccount } from "./Config";
import { Util } from "./Util";
import { XmppJsInstance } from "./xmppjs/XJSInstance";
import { Metrics } from "./Metrics";
import { AutoRegistration } from "./AutoRegistration";
import { GatewayHandler } from "./GatewayHandler";
import * as request from "request-promise-native";
import { NeDBStore } from "./store/NeDBStore";

const log = Logging.get("Program");
const bridgeLog = Logging.get("bridge");

EventEmitter.defaultMaxListeners = 50;

/**
 * This is the entry point for the bridge. It contains
 */
class Program {
    private cli: Cli;
    private bridge: Bridge;
    private eventHandler: MatrixEventHandler|undefined;
    private roomHandler: MatrixRoomHandler|undefined;
    private gatewayHandler!: GatewayHandler;
    private profileSync: ProfileSync|undefined;
    private roomSync: RoomSync|undefined;
    private purple?: IBifrostInstance;
    private store: IStore|undefined;
    private cfg: Config;
    private deduplicator: Deduplicator;

    constructor() {
        this.cli = new Cli({
          bridgeConfig: {
            affectsRegistration: true,
            schema: "./config/config.schema.yaml",
          },
          registrationPath: "purple-registration.yaml",
          generateRegistration: this.generateRegistration,
          run: this.runBridge.bind(this),
        });
        this.cfg = new Config();
        this.deduplicator = new Deduplicator();
    }

    public get config(): Config {
        return this.cfg;
    }

    public start(): any {
        Logging.configure({console: "debug"});

        try {
            this.cli.run();
        } catch (ex) {
            log.error(ex);
        }
    }

    private generateRegistration(reg, callback) {
      reg.setId(AppServiceRegistration.generateToken());
      reg.setHomeserverToken(AppServiceRegistration.generateToken());
      reg.setAppServiceToken(AppServiceRegistration.generateToken());
      reg.setSenderLocalpart("_purple_bot");
      reg.addRegexPattern("users", "@_purple_.*", true);
      reg.addRegexPattern("aliases", "#_purple_.*", true);
      callback(reg);
    }

    private async waitForHomeserver() {
        // Wait for the homeserver to start before progressing with the bridge.
        const url = `${this.config.bridge.homeserverUrl}/_matrix/client/versions`;
        while (true) {
            try {
                // It is a promise, I Promise
                await (request.get(url) as unknown as Promise<unknown>);
                return true;
            } catch (ex) {
                log.warn("Failed to contact", url, "waiting..");
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    private async registerBot() {
        const intent = this.bridge.getIntent();
        intent.opts.registered = false;
        await intent._ensureRegistered();
        const botUserId = this.bridge.getBot().getUserId();
        // Set a profile for the bridge user.
        try {
            const currentName = (await intent.getProfileInfo(botUserId, "displayname")).displayname;
            if (this.config.bridgeBot.displayname !== currentName) {
                await intent.setDisplayName(this.config.bridgeBot.displayname);
                log.debug("Changed bridge bot name to:", this.config.bridgeBot.displayname);
            }
        } catch (ex) {
            // Synapse loooove to send us M_UNKNOWN
            if (ex.errcode === "M_NOT_FOUND" || ex.errcode === "M_UNKNOWN") {
                return intent.setDisplayName(this.config.bridgeBot.displayname).catch((err) => {
                    log.error("Failed to update profile: ", ex);
                    process.exit(1);
                }).then(() => {
                    log.debug("Set bridge bot name to:", this.config.bridgeBot.displayname);
                });
            }
            log.error("Failed to update profile: ", ex);
        }
    }

    private async runBridge(port: number, config: any) {
        const checkOnly = process.env.BIFROST_CHECK_ONLY === "true";
        log.info("Starting purple bridge on port", port);
        this.cfg.ApplyConfig(config);
        if (checkOnly && this.config.logging.console === "off") {
            // Force console if we are doing an integrity check only.
            Logging.configure({
                console: "info",
            });
        } else {
            Logging.configure(this.cfg.logging);
        }
        let storeParams = {};
        if (this.config.datastore.engine === "nedb") {
            const path = this.config.datastore.connectionString.substr("nedb://".length);
            storeParams = {
                userStore: `${path}/user-store.db`,
                roomStore: `${path}/room-store.db`,
            };
        }
        this.bridge = new Bridge({
          controller: {
            // onUserQuery: userQuery,
            onAliasQuery: (alias, aliasLocalpart) => this.eventHandler!.onAliasQuery(alias, aliasLocalpart),
            onEvent: (r: IEventRequest, context) => {
                if (this.eventHandler === undefined) {return; }
                const p = this.eventHandler.onEvent(r, context).catch((err) => {
                    log.error("onEvent err", err);
                }).catch(() => {
                    Metrics.requestOutcome(false, r.getDuration(), "fail");
                }).then(() => {
                    Metrics.requestOutcome(false, r.getDuration(), "success");
                });
            },
            onLog: (msg: string, error: boolean) => {
                bridgeLog[error ? "warn" : "debug"](msg);
            },
            onAliasQueried: (alias, roomId) => this.eventHandler!.onAliasQueried(alias, roomId),
          },
          domain: this.cfg.bridge.domain,
          homeserverUrl: this.cfg.bridge.homeserverUrl,
          registration: this.cli.getRegistrationFilePath(),
          ...storeParams,
        });
        if (this.config.datastore.engine !== "nedb") {
            // If these are undefined in the constructor, default names
            // are used. We want to override those names so these stores
            // will never be created.
            this.bridge.opts.userStore = undefined;
            this.bridge.opts.roomStore = undefined;
            this.bridge.opts.eventStore = undefined;
        }
        await this.bridge.run(port, this.cfg);
        if (this.cfg.purple.backend === "node-purple") {
            log.info("Selecting node-purple as a backend");
            this.purple = new (require("./purple/PurpleInstance").PurpleInstance)(this.cfg.purple);
        } else if (this.cfg.purple.backend === "xmpp-js") {
            log.info("Selecting xmpp-js as a backend");
            this.purple = new (require("./xmppjs/XJSInstance").XmppJsInstance)(this.cfg);
        } else {
            throw new Error(`Backend ${this.cfg.purple.backend} not supported`);
        }
        const purple = this.purple!;

        if (this.cfg.metrics.enable) {
            log.info("Enabling metrics");
            Metrics.init(this.bridge);
        }

        this.store = await initiateStore(this.config.datastore, this.bridge);
        try {
            const ignoreIntegrity = process.env.BIFROST_INTEGRITY_WRITE;
            await this.store.integrityCheck(
                ignoreIntegrity === undefined || ignoreIntegrity !== "false");
            if (checkOnly) {
                log.warn("BIFROST_CHECK_ONLY is set, exiting");
                process.exit(0);
            }
            await this.waitForHomeserver();
            await this.registerBot();
        } catch (ex) {
            log.error("Encountered an error when starting:", ex);
            process.exit(1);
        }
        this.profileSync = new ProfileSync(this.bridge, this.cfg, this.store);
        this.roomHandler = new MatrixRoomHandler(
            this.purple!, this.profileSync, this.store, this.cfg, this.deduplicator,
        );
        this.gatewayHandler = new GatewayHandler(purple, this.bridge, this.cfg, this.store, this.profileSync);
        this.roomSync = new RoomSync(purple, this.store, this.deduplicator, this.gatewayHandler);
        this.eventHandler = new MatrixEventHandler(
            purple, this.store, this.deduplicator, this.config, this.gatewayHandler,
        );
        let autoReg: AutoRegistration|undefined;
        if (this.config.autoRegistration.enabled && this.config.autoRegistration.protocolSteps !== undefined) {
            autoReg = new AutoRegistration(
                this.config.autoRegistration,
                this.bridge,
                this.store,
                purple,
            );
        }

        this.eventHandler.setBridge(this.bridge, autoReg || undefined);
        this.roomHandler.setBridge(this.bridge);
        log.info("Bridge has started.");
        try {
            if (purple instanceof XmppJsInstance) {
                purple.preStart(this.bridge, autoReg);
            }
            await purple.start();
            await this.roomSync.sync(this.bridge.getBot(), this.bridge.getIntent());
            if (purple instanceof XmppJsInstance) {
                log.debug("Signing in accounts...");
                purple.signInAccounts(
                    await this.store.getUsernameMxidForProtocol(purple.getProtocols()[0]),
                );
            }
        } catch (ex) {
            log.error("Encountered an error starting the backend:", ex);
            process.exit(1);
        }
        this.purple!.on("account-signed-on", (ev: IAccountEvent) => {
            log.info(`${ev.account.protocol_id}://${ev.account.username} signed on`);
        });
        this.purple!.on("account-connection-error", (ev: IAccountEvent) => {
            log.warn(`${ev.account.protocol_id}://${ev.account.username} had a connection error`, ev);
        });
        this.purple!.on("account-signed-off", (ev: IAccountEvent) => {
            log.info(`${ev.account.protocol_id}://${ev.account.username} signed off.`);
            this.deduplicator.removeChosenOneFromAllRooms(
                Util.createRemoteId(ev.account.protocol_id, ev.account.username),
            );
        });
        log.info("Initiation of bridge complete");
    }
}

new Program().start();
