import { AccountHandler } from "./AccountHandler";
import { AutoRegistration } from "./AutoRegistration";
import { Cli, Bridge, AppServiceRegistration, Logging, TypingEvent, Request, RoomBridgeStoreEntry } from "matrix-appservice-bridge";
import { Config } from "./Config";
import { Deduplicator } from "./Deduplicator";
import { EventEmitter } from "events";
import { GatewayHandler } from "./GatewayHandler";
import { IAccountEvent } from "./bifrost/Events";
import { IBifrostInstance } from "./bifrost/Instance";
import { install as installSMS } from "source-map-support";
import { IRemoteUserAdminData, MROOM_TYPE_UADMIN } from "./store/Types";
import { IStore, initiateStore } from "./store/Store";
import { MatrixEventHandler } from "./MatrixEventHandler";
import { MatrixRoomHandler } from "./MatrixRoomHandler";
import { Metrics } from "./Metrics";
import { ProfileSync } from "./ProfileSync";
import { RoomSync } from "./RoomSync";
import { Util } from "./Util";
import { XmppJsInstance } from "./xmppjs/XJSInstance";
import * as request from "request-promise-native";

const log = Logging.get("Program");
const bridgeLog = Logging.get("bridge");


installSMS();

EventEmitter.defaultMaxListeners = 50;

/**
 * This is the entry point for the bridge. It contains
 */
class Program {
    private cli: Cli<Record<string, unknown>>;
    private bridge?: Bridge;
    private eventHandler: MatrixEventHandler|undefined;
    private roomHandler: MatrixRoomHandler|undefined;
    private gatewayHandler!: GatewayHandler;
    private profileSync: ProfileSync|undefined;
    private roomSync: RoomSync|undefined;
    private bifrostInstance?: IBifrostInstance;
    private store!: IStore;
    private cfg: Config;
    private deduplicator: Deduplicator;
    private accountHandler?: AccountHandler;

    constructor() {
        this.cli = new Cli({
            bridgeConfig: {
                affectsRegistration: true,
                schema: "./config/config.schema.yaml",
                defaults: {},
            },
            registrationPath: "bifrost-registration.yaml",
            generateRegistration: this.generateRegistration,
            run: async (port: number, config: any) => {
                try {
                    await this.runBridge(port, config);
                } catch (ex) {
                    log.error("Failed to start:", ex);
                    process.exit(1);
                }
            }
        });
        this.cfg = new Config();
        this.deduplicator = new Deduplicator();
        process.on("SIGINT", () =>
            this.killBridge()
        )
    }

    public get config(): Config {
        return this.cfg;
    }

    public start() {
        Logging.configure({console: "debug"});
        try {
            this.cli.run();
        } catch (ex) {
            log.error(ex);
        }
    }

    private generateRegistration(reg: AppServiceRegistration, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("bifrost");
        reg.addRegexPattern("users", "@_bifrost_.*", true);
        reg.addRegexPattern("aliases", "#bifrost_.*", true);
        reg.pushEphemeral = true;
        callback(reg);
    }

    private async waitForHomeserver() {
        log.info("Checking if homeserver is up");
        // Wait for the homeserver to start before progressing with the bridge.
        const url = `${this.config.bridge.homeserverUrl}/_matrix/client/versions`;
        while (true) {
            try {
                await request.get(url);
                return true;
            } catch (ex) {
                log.warn("Failed to contact", url, "waiting..");
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    private async registerBot() {
        log.info("Ensuring bot is registered");
        if (!this.bridge) {
            throw Error('registerBot called without first instantiating bridge');
        }
        const intent = this.bridge.getIntent();
        await intent.ensureRegistered(true);
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

    private async killBridge() {
        log.info("SIGINT recieved, killing bridge");
        await this.bridge.close();
        await this.bifrostInstance.close();
        process.exit(0);
    }

    private async runBridge(port: number, config: any) {
        const checkOnly = process.env.BIFROST_CHECK_ONLY === "true";
        this.cfg.ApplyConfig(config);
        port = this.cfg.bridge.appservicePort || port;
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
        } else {
            storeParams = {
                disableStores: true,
            };
        }
        this.bridge = new Bridge({
            controller: {
                onAliasQuery: (alias, aliasLocalpart) => this.eventHandler!.onAliasQuery(alias, aliasLocalpart),
                onEvent: (r) => {
                    if (this.eventHandler === undefined) {return; }
                    this.eventHandler.onEvent(r).catch((err) => {
                        log.error("onEvent err", err);
                    }).then(() => {
                        Metrics.requestOutcome(false, r.getDuration(), "success");
                    }).catch(() => {
                        Metrics.requestOutcome(false, r.getDuration(), "fail");
                    });
                },
                onEphemeralEvent: (r) => {
                    if (r.getData().type === "m.typing") {
                        this.eventHandler.onTyping(r as Request<TypingEvent>).catch((err) => {
                            log.error("onTyping err", err);
                        }).then(() => {
                            Metrics.requestOutcome(false, r.getDuration(), "success");
                        }).catch(() => {
                            Metrics.requestOutcome(false, r.getDuration(), "fail");
                        });
                    }
                },
                onLog: (msg: string, error: boolean) => {
                    bridgeLog[error ? "warn" : "debug"](msg);
                },
                onAliasQueried: (alias, roomId) => this.eventHandler!.onAliasQueried(alias, roomId),
                onUserQuery: () => { throw Error('Not defined') }
            },
            domain: this.cfg.bridge.domain,
            homeserverUrl: this.cfg.bridge.homeserverUrl,
            disableContext: true,
            registration: this.cli.getRegistrationFilePath(),
            ...storeParams,
        });
        await this.bridge.initalise();
        if (this.cfg.purple.backend === "node-purple") {
            log.info("Selecting node-purple as a backend");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            this.bifrostInstance = new (require("./purple/PurpleInstance").PurpleInstance)(this.cfg.purple);
        } else if (this.cfg.purple.backend === "xmpp-js") {
            log.info("Selecting xmpp-js as a backend");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            this.bifrostInstance = new (require("./xmppjs/XJSInstance").XmppJsInstance)(this.cfg);
        } else {
            throw new Error(`Backend ${this.cfg.purple.backend} not supported`);
        }
        const bifrostInstance = this.bifrostInstance!;


        if (this.cfg.metrics.enabled) {
            log.info("Enabling metrics");
            Metrics.init(this.bridge);
        }

        this.store = await initiateStore(this.config.datastore, this.bridge);
        const ignoreIntegrity = process.env.BIFROST_INTEGRITY_WRITE;
        await this.store.integrityCheck(
            ignoreIntegrity === undefined || ignoreIntegrity !== "false");
        if (checkOnly) {
            log.warn("BIFROST_CHECK_ONLY is set, exiting");
            process.exit(0);
        }
        await this.waitForHomeserver();
        await this.registerBot();

        this.profileSync = new ProfileSync(this.bridge, this.cfg, this.store);
        this.roomHandler = new MatrixRoomHandler(
            this.bifrostInstance!, this.profileSync, this.store, this.cfg, this.deduplicator,
        );
        this.gatewayHandler = new GatewayHandler(bifrostInstance, this.bridge, this.cfg, this.store, this.profileSync);
        this.roomSync = new RoomSync(
            bifrostInstance, this.store, this.deduplicator, this.gatewayHandler, this.bridge.getIntent(),
        );
        this.eventHandler = new MatrixEventHandler(
            bifrostInstance, this.store, this.deduplicator, this.config, this.gatewayHandler,
        );
        let autoReg: AutoRegistration|undefined;
        if (this.config.autoRegistration.enabled && this.config.autoRegistration.protocolSteps !== undefined) {
            autoReg = new AutoRegistration(
                this.config.autoRegistration,
                this.config.access,
                this.bridge,
                this.store,
                bifrostInstance,
            );
        }

        this.eventHandler.setBridge(this.bridge, autoReg || undefined);
        this.roomHandler.setBridge(this.bridge);
        log.info("Bridge has started.");
        try {
            if (bifrostInstance instanceof XmppJsInstance) {
                if (!autoReg) {
                    throw Error('AutoRegistration not enabled in config, bridge cannot start');
                }
                bifrostInstance.preStart(this.bridge, autoReg);
            }
            await bifrostInstance.start();
            this.accountHandler = new AccountHandler(bifrostInstance, this.store, this.bridge, this.config);
            await this.roomSync.sync(this.bridge.getBot());
            if (bifrostInstance instanceof XmppJsInstance) {
                log.debug("Signing in accounts...");
                bifrostInstance.signInAccounts(
                    await this.store.getUsernameMxidForProtocol(bifrostInstance.getProtocols()[0]),
                );
            }
        } catch (ex) {
            log.error("Encountered an error starting the backend:", ex);
            process.exit(1);
        }
        bifrostInstance.on("account-signed-off", (ev: IAccountEvent) => {
            this.deduplicator.removeChosenOneFromAllRooms(
                Util.createRemoteId(ev.account.protocol_id, ev.account.username),
            );
        });
        log.info("Initiation of bridge complete");
    }
}

new Program().start();
