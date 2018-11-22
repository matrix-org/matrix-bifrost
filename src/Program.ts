import { Cli, Bridge, AppServiceRegistration, ClientFactory, Logging } from "matrix-appservice-bridge";
import { MatrixEventHandler } from "./MatrixEventHandler";
import { MatrixRoomHandler } from "./MatrixRoomHandler";
import { PurpleInstance, PurpleProtocol } from "./purple/PurpleInstance";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import { PurpleAccount } from "./purple/PurpleAccount";
import { EventEmitter } from "events";
import { IReceivedImMsg, IAccountEvent } from "./purple/PurpleEvents";
import { ProfileSync } from "./ProfileSync";
import { IEventRequest } from "./MatrixTypes";
import { RoomSync } from "./RoomSync";
import { Store } from "./Store";
import { Deduplicator } from "./Deduplicator";
import { Config, IBridgeBotAccount } from "./Config";
import { Util } from "./Util";

const log = Logging.get("Program");

class MockPurpleInstance extends EventEmitter {
    private protocol: PurpleProtocol;
    constructor() {
        super();
        this.protocol = new PurpleProtocol({
            name: "fakeProtocol",
            id: "fake-protocol",
            homepage: undefined,
            summary: undefined,
        });
    }

    public start() {
        return Promise.resolve();
    }

    public getAccount() {
        return new PurpleAccount("SomeName", this.protocol);
    }

    public getProtocol(id: string) {
        return this.protocol;
    }

    public getProtocols() {
        return [];
    }
}

/**
 * This is the entry point for the bridge. It contains
 */
class Program {
    private cli: Cli;
    private bridge: Bridge;
    private eventHandler: MatrixEventHandler|undefined;
    private roomHandler: MatrixRoomHandler|undefined;
    private profileSync: ProfileSync|undefined;
    private roomSync: RoomSync|undefined;
    private purple: IPurpleInstance;
    private store: Store|undefined;
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
        this.purple = new PurpleInstance();
        this.deduplicator = new Deduplicator();
        // For testing w/o libpurple.
        // this.purple = new MockPurpleInstance();
        // setTimeout(() => {
        //     (this.purple as MockPurpleInstance).emit("received-im-msg", {
        //         sender: "testacc@localhost/",
        //         message: "test",
        //         account: null,
        //     } as IReceivedImMsg);
        // }, 5000);
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

    private async runBridge(port: number, config: any) {
        log.info("Starting purple bridge on port ", port);
        this.cfg.ApplyConfig(config);
        this.bridge = new Bridge({
          // clientFactory,
          controller: {
            // onUserQuery: userQuery,
            onAliasQuery: () => { (this.roomHandler as MatrixRoomHandler).onAliasQuery.bind(this.roomHandler); },
            onEvent: (request: IEventRequest, context) => {
                if (this.eventHandler === undefined) {return; }
                this.eventHandler.onEvent(request, context).catch((err) => {
                    log.error("onEvent err", err);
                });
            },
            onAliasQueried: () => { (this.roomHandler as MatrixRoomHandler).onAliasQueried.bind(this.roomHandler); },
            // We don't handle these just yet.
            // thirdPartyLookup: this.thirdpa.ThirdPartyLookup,
          },
          domain: this.cfg.bridge.domain,
          homeserverUrl: this.cfg.bridge.homeserverUrl,
          registration: "purple-registration.yaml",
        });
        await this.bridge.run(port, this.cfg);
        this.store = new Store(this.bridge);
        this.profileSync = new ProfileSync(this.bridge, this.cfg);
        this.eventHandler = new MatrixEventHandler(this.purple, this.store, this.deduplicator, this.config);
        this.roomHandler = new MatrixRoomHandler(
            this.purple, this.profileSync, this.store, this.cfg, this.deduplicator,
        );
        this.roomSync = new RoomSync(this.purple, this.bridge, this.store, this.deduplicator);
        // TODO: Remove these eventually
        this.eventHandler.setBridge(this.bridge);
        this.roomHandler.setBridge(this.bridge);
        log.info("Bridge has started.");
        await this.roomSync.sync();
        await this.purple.start(this.cfg.purple);
        this.purple.on("account-signed-on", (ev: IAccountEvent) => {
            log.info(`${ev.account.protocol_id}://${ev.account.username} signed on`);
        });
        this.purple.on("account-connection-error", (ev: IAccountEvent) => {
            log.warn(`${ev.account.protocol_id}://${ev.account.username} had a connection error`, ev);
        });
        this.purple.on("account-signed-off", (ev: IAccountEvent) => {
            log.info(`${ev.account.protocol_id}://${ev.account.username} signed off.`);
            this.deduplicator.removeChosenOneFromAllRooms(
                Util.createRemoteId(ev.account.protocol_id, ev.account.username),
            );
        });
        //await this.runBotAccounts(this.cfg.bridgeBot.accounts);
    }

    private async runBotAccounts(accounts: IBridgeBotAccount[]) {
        // Fetch accounts from config
        accounts.forEach((account) => {
            const acct = this.purple.getAccount(account.name, account.protocol);
            if (!acct) {
                log.error(
`${account.protocol}:${account.name} is not configured in libpurple. Ensure that accounts.xml is correct.`,
                );
                throw Error("Fatal error while setting up bot accounts");
            }
            if (acct.isEnabled === false) {
                log.error(
`${account.protocol}:${account.name} is not enabled, enabling.`,
                );
                acct.setEnabled(true);
                // Here we should really wait for the account to come online signal.
            }
        });

        // Check they all exist and start.
        // If one is missing from the purple config, fail.
    }

    private async getBotForProtocol(protocol: string) {

    }

    private async startPurpleAccounts() {
        const store = this.bridge.getUserStore();
        log.info("Starting enabled purple accounts..");
        const matrixUsers = await store.getByMatrixData({});
        await Promise.all(matrixUsers.map(async (matrixUser) => {
            log.info(`Getting remote accounts for ${matrixUser.getId()}`);
            const remotes = await store.getRemoteUsersFromMatrixId(matrixUser.getId());
            await Promise.all(remotes.map(async (remoteUser) => {
                log.info(`Starting ${remoteUser.getId()} (${remoteUser.get("protocolId")})`);
                try {
                    const acct = this.purple.getAccount(remoteUser.getId(), remoteUser.get("protocolId"));
                    // TODO: At the moment, accounts start automatically.
                } catch (ex) {
                    log.error("Failed to start account, ", ex);
                }
            }));
        }));
        log.info("Fnished enabling purple accounts..");
    }

}

new Program().start();
