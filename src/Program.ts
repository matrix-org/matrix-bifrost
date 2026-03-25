import { Cli, Bridge, AppServiceRegistration, Logger, TypingEvent, Request, PresenceEvent, MediaProxy } from "matrix-appservice-bridge";
import { EventEmitter } from "events";
import { MatrixEventHandler } from "./MatrixEventHandler";
import { MatrixRoomHandler } from "./MatrixRoomHandler";
import { IBifrostInstance } from "./bifrost/Instance";
import { IAccountEvent } from "./bifrost/Events";
import { ProfileSync } from "./ProfileSync";
import { RoomSync } from "./RoomSync";
import { IStore, initiateStore } from "./store/Store";
import { Deduplicator } from "./Deduplicator";
import { Config, ConfigValue } from "./Config";
import { Util } from "./Util";
import { XmppJsInstance } from "./xmppjs/XJSInstance";
import { Metrics } from "./Metrics";
import { AutoRegistration } from "./AutoRegistration";
import { GatewayHandler } from "./GatewayHandler";
import { IRemoteUserAdminData, MROOM_TYPE_IM, MROOM_TYPE_UADMIN } from "./store/Types";

import * as fs from "fs";
import { webcrypto } from "node:crypto";

Logger.configure({console: "debug"});
const log = new Logger("Program");
const bridgeLog = new Logger("bridge");


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
    private purple?: IBifrostInstance;
    private store!: IStore;
    private cfg: Config;
    private deduplicator: Deduplicator;

    constructor() {
        this.cli = new Cli({
            bridgeConfig: {
                affectsRegistration: true,
                schema: "./config/config.schema.yaml",
                defaults: {},
            },
            registrationPath: "bifrost-registration.yaml",
            generateRegistration: this.generateRegistration,
            run: async (port: number, config) => {
                try {
                    await this.runBridge(port, config as ConfigValue);
                } catch (ex) {
                    log.error("Failed to start:", ex);
                    process.exit(1);
                }
            }
        });
        this.cfg = new Config();
        this.deduplicator = new Deduplicator();
        process.on("SIGTERM", () =>
            this.killBridge()
        )
    }

    public get config(): Config {
        return this.cfg;
    }

    public start() {

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

    private async initialiseMediaProxy(): Promise<MediaProxy> {
        const config = this.config.mediaProxy;
        const jwk = JSON.parse(fs.readFileSync(config.signingKeyPath, "utf8").toString());
        const signingKey = await webcrypto.subtle.importKey('jwk', jwk, {
            name: 'HMAC',
            hash: 'SHA-512',
        }, true, ['sign', 'verify']);
        const publicUrl = new URL(config.publicUrl);

        const mediaProxy = new MediaProxy({ publicUrl, signingKey, ttl: config.ttlSeconds * 1000 }, this.bridge.getIntent().matrixClient);
        mediaProxy.start(config.bindPort);

        return mediaProxy;
    }

    private async waitForHomeserver() {
        log.info("Checking if homeserver is up");
        // Wait for the homeserver to start before progressing with the bridge.
        const url = `${this.config.bridge.homeserverUrl}/_matrix/client/versions`;
        while (true) {
            try {
                const req = await fetch(url);
                if (!req.ok) {
                    throw Error(`Could not contact homeserver, status ${req.status} ${await req.text()}`);
                }
                return true;
            } catch (ex) {
                // Can sometimes be an Aggregate error if multiple hosts are tried (ipv4, ipv6)
                const trueErr = ex.cause?.errors.map(e => e.message).join(', ') ?? ex.message;
                log.warn(`Failed to contact ${url} (${trueErr}), waiting..`);
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
        log.info("SIGTERM recieved, killing bridge");
        await this.bridge.close();
        await this.purple.close();
    }

    private async pingBridge() {
        let internalRoom: string|null;
        try {
            internalRoom = await this.store.getAdminRoom("-internal-");
            if (!internalRoom) {
                const result = await this.bridge.getIntent().createRoom({ options: {}});
                internalRoom = (await this.store.storeRoom(
                    result.room_id, MROOM_TYPE_UADMIN, "-internal-", {
                        type: MROOM_TYPE_UADMIN,
                        matrixUser: "-internal-"
                    } as IRemoteUserAdminData)
                ).matrix.getId();
            }
            const time = await this.bridge.pingAppserviceRoute(internalRoom);
            log.info(`Successfully pinged the bridge. Round trip took ${time}ms`);
        }
        catch (ex) {
            log.error("Homeserver cannot reach the bridge. You probably need to adjust your configuration.", ex);
        }
    }

    private async dropStaleIMRooms(): Promise<void> {
        const rooms = await this.store.getRoomsOfType(MROOM_TYPE_IM);
        log.info(`Got ${rooms.length} IM rooms`);
        // Errors here aren't fatal, so use Promise.allSettled instead of Promise.all
        await Promise.allSettled(rooms.map(async (room) => {
            if (!room.matrix) {
                log.warn(`Not checking IM room because it has no matrix component`);
                return;
            }
            const roomId = room.matrix.getId();
            if (!room.remote) {
                log.warn(`Not checking IM room ${roomId} because it has no remote links`);
                return;
            }
            const recipient = room.remote.get<string>("recipient");
            if (!recipient) {
                log.warn(`Dropping IM room ${roomId} because it has no recipient`);
                await this.store.removeRoomByRoomId(roomId);
                return;
            }
            const protocol = this.purple.getProtocol(room.remote.get<string>("protocol_id"));
            if (!protocol) {
                log.warn(`Dropping IM room ${roomId} because it has no valid protocol`);
                await this.store.removeRoomByRoomId(roomId);
                return;
            }
            const remoteIntent = this.bridge.getIntent(
                protocol.getMxIdForProtocol(
                    recipient,
                    this.config.bridge.domain,
                    this.config.bridge.userPrefix,
                ).getId()
            );
            const matrixUser = room.remote.get<string>("matrixUser");
            if (!matrixUser) {
                log.warn(`Dropping and leaving IM room ${roomId} because it has no matrix user`);
                await this.store.removeRoomByRoomId(roomId);
                await remoteIntent.leave(roomId);
                return;
            }
            let content: Record<string, unknown>;
            try {
                content = await remoteIntent.matrixClient.getRoomStateEventContent(roomId, "m.room.member", matrixUser);
            } catch (ex) {
                log.warn(`Dropping and leaving IM room ${roomId} because we could not look up room state: ${ex}`);
                await this.store.removeRoomByRoomId(roomId);
                await remoteIntent.leave(roomId);
                return;
            }
            if (content.membership === "leave") {
                log.info(`Dropping and leaving IM room ${roomId} because its matrix user left`);
                await this.store.removeRoomByRoomId(roomId);
                await remoteIntent.leave(roomId);
                return;
            }
        }));
    }

    private async runBridge(port: number, config: ConfigValue) {
        const checkOnly = process.env.BIFROST_CHECK_ONLY === "true";
        this.cfg.ApplyConfig(config);
        port = this.cfg.bridge.appservicePort || port;
        if (checkOnly && this.config.logging.console === "off") {
            // Force console if we are doing an integrity check only.
            Logger.configure({
                console: "info",
            });
        } else {
            Logger.configure(this.cfg.logging);
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
            // onUserQuery: userQuery,
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
                    const data = r.getData();
                    if (data.type === "m.typing") {
                        this.eventHandler.onTyping(r as Request<TypingEvent>).catch((err) => {
                            log.error("onTyping encountered an error", err);
                        }).then(() => {
                            Metrics.requestOutcome(false, r.getDuration(), "success");
                        }).catch(() => {
                            Metrics.requestOutcome(false, r.getDuration(), "fail");
                        });
                    } else if (data.type === "m.presence") {
                        this.eventHandler.onPresence(r as Request<PresenceEvent>).catch((err) => {
                            log.error("onPresence encountered an error", err);
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
        await this.bridge.initialise();

        this.store = await initiateStore(this.config.datastore, this.bridge);
        const ignoreIntegrity = process.env.BIFROST_INTEGRITY_WRITE;
        await this.store.integrityCheck(
            ignoreIntegrity === undefined || ignoreIntegrity !== "false");
        if (checkOnly) {
            log.warn("BIFROST_CHECK_ONLY is set, exiting");
            process.exit(0);
        }


        if (this.cfg.purple.backend === "node-purple") {
            log.info("Selecting node-purple as a backend");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            this.purple = new (require("./purple/PurpleInstance").PurpleInstance)(this.cfg.purple);
        } else if (this.cfg.purple.backend === "xmpp-js") {
            log.info("Selecting xmpp-js as a backend");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            this.purple = new (require("./xmppjs/XJSInstance").XmppJsInstance)(this.cfg, this.bridge);
        } else {
            throw new Error(`Backend ${this.cfg.purple.backend} not supported`);
        }

        const purple = this.purple!;

        let autoReg: AutoRegistration|undefined;
        if (this.config.autoRegistration.enabled && this.config.autoRegistration.protocolSteps !== undefined) {
            autoReg = await AutoRegistration.create(
                this.config.autoRegistration,
                this.config.access,
                this.bridge,
                this.store,
                purple,
            );
        }

        purple.preStart?.(autoReg);

        purple.on("account-signed-on", async (ev: IAccountEvent) => {
            log.info(`${ev.account.protocol_id}://${ev.account.username} signed on`);
            const acct = this.purple.getAccount(ev.account.username, ev.account.protocol_id);
            acct.setStatus('available', true);
            // Check presence
            // TODO: Move this to it's own handler?
            if (ev.mxid && acct?.setPresence) {
                try {
                    const presence = await this.bridge.getIntent().matrixClient.getPresenceStatusFor(ev.mxid);
                    const allInterestedUsers = (
                        await this.store.getAllIMRoomsForAccount(ev.mxid, acct.protocol.id)
                    ).map((r) => r.remote.get<string>('recipient'));
                    await acct.setPresence({
                        currently_active: presence.currentlyActive,
                        status_msg: presence.statusMessage,
                        presence: presence.state,
                        last_active_ago: presence.lastActiveAgo,
                    }, allInterestedUsers);
                } catch (ex) {
                    log.warn(`Failed to set startup presence for ${ev.mxid}`, ex);
                }
            }
        });
        purple.on("account-connection-error", (ev: IAccountEvent) => {
            log.warn(`${ev.account.protocol_id}://${ev.account.username} had a connection error`, ev);
        });
        purple.on("account-signed-off", (ev: IAccountEvent) => {
            log.info(`${ev.account.protocol_id}://${ev.account.username} signed off.`);
            this.deduplicator.removeChosenOneFromAllRooms(
                Util.createRemoteId(ev.account.protocol_id, ev.account.username),
            );
        });

        this.profileSync = new ProfileSync(this.bridge, this.cfg, this.store);
        this.roomHandler = new MatrixRoomHandler(
            purple, this.profileSync, this.store, this.cfg, this.deduplicator, this.bridge,
        );
        this.gatewayHandler = new GatewayHandler(purple, this.bridge, this.cfg, this.store, this.profileSync);
        this.roomSync = new RoomSync(
            purple, this.store, this.deduplicator, this.gatewayHandler, this.bridge.getIntent(),
        );
        const mediaProxy = await this.initialiseMediaProxy();

        this.eventHandler = new MatrixEventHandler(
            purple, this.store, this.deduplicator, this.config, this.gatewayHandler, this.bridge, mediaProxy, autoReg
        );

        await this.bridge.listen(port);

        if (this.cfg.metrics.enabled) {
            log.info("Enabling metrics");
            Metrics.init(this.bridge);
        }

        await this.waitForHomeserver();
        log.info("Started appservice listener on port", port);
        await this.pingBridge();
        await this.registerBot();
        await this.dropStaleIMRooms();
        log.info("Bridge has started.");
        try {
            await purple.start();
            await this.roomSync.sync(this.bridge.getBot());
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
        log.info("Initiation of bridge complete");
    }
}

new Program().start();

process.on('unhandledRejection', (reason, promise) => {
    log.warn(`Unhandled rejection`, reason, promise);
});
