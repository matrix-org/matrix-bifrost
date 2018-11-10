import { Cli, Bridge, AppServiceRegistration, ClientFactory, Logging } from "matrix-appservice-bridge";
import { MatrixEventHandler } from "./MatrixEventHandler";
import { MatrixRoomHandler } from "./MatrixRoomHandler";
import { PurpleInstance, PurpleProtocol } from "./purple/PurpleInstance";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import { PurpleAccount } from "./purple/PurpleAccount";
import { EventEmitter } from "events";
import { IReceivedImMsg } from "./purple/PurpleEvents";
import * as request from "request-promise-native";
import { ProfileSync } from "./ProfileSync";

const log = Logging.get("Program");


class MockPurpleInstance extends EventEmitter {
    constructor() {
        super();
    }

    public start () {
        return Promise.resolve();
    }

    public getAccount () {
        return new PurpleAccount("SomeName", new PurpleProtocol({}));
    }

    public getProtocol (id: string) {
        return new PurpleProtocol({id});
    }

    public getProtocols () {
        return [];
    }
};

/**
 * This is the entry point for the bridge. It contains
 */
class Program {
    private cli: Cli;
    private bridge: Bridge;
    private eventHandler: MatrixEventHandler|undefined;
    private roomHandler: MatrixRoomHandler|undefined;
    private profileSync: ProfileSync|undefined;
    private purple: IPurpleInstance;
    private _config: any;

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
        this.purple = new PurpleInstance();
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

    public get config(): any {
        return this._config;
    }

    public start(): any {
        Logging.configure({console: "debug"});

        try {
            this.cli.run();
        } catch (ex) {
            console.log(ex);
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
        this._config = config;
        this.bridge = new Bridge({
          //clientFactory,
          controller: {
            // onUserQuery: userQuery,
            onAliasQuery: () => { (this.roomHandler as MatrixRoomHandler).onAliasQuery.bind(this.roomHandler) },
            onEvent: (request, context) => {
                if (this.eventHandler === undefined) {return;}
                this.eventHandler.onEvent(request, context).catch((err) => {
                    log.error("onEvent err", err);
                });
            },
            onAliasQueried: () => { (this.roomHandler as MatrixRoomHandler).onAliasQueried.bind(this.roomHandler) },
            // We don't handle these just yet.
            //thirdPartyLookup: this.thirdpa.ThirdPartyLookup,
          },
          domain: config.bridge.domain,
          homeserverUrl: config.bridge.homeserverUrl,
          registration: "purple-registration.yaml",
        });
        await this.bridge.run(port, config);
        this.profileSync = new ProfileSync(this.bridge, config);
        this.eventHandler = new MatrixEventHandler(this.purple);
        this.roomHandler = new MatrixRoomHandler(this.purple, this.profileSync, config);
        // TODO: Remove these eventually
        this.eventHandler.setBridge(this.bridge);
        this.roomHandler.setBridge(this.bridge);
        log.info("Bridge has started.");
        await this.purple.start(config.purple || {});
        this.purple.on("account-signed-on", (ev) => {
            log.info(`${ev.account.protocol_id}://${ev.account.username} signed on`);
        });
        this.purple.on("account-connection-error", (ev) => {
            log.warn(`${ev.account.protocol_id}://${ev.account.username} had a connection error`, ev);
        });
        if (config.bridgeBots) {
            await this.runBotAccounts(config.bridgeBots.accounts);
        }
        //await this.startPurpleAccounts();
    }

    private async runBotAccounts(accounts: any[]) {
        // Fetch accounts from config
        accounts.forEach((account: {name: string, protocol: string}) => {
            const acct = this.purple.getAccount(account.name, account.protocol);
            if (!acct) {
                log.error(
`${account.protocol}:${account.name} is not configured in libpurple. Ensure that accounts.xml is correct.`
                );
                throw Error("Fatal error while setting up bot accounts");
            }
            if (acct.isEnabled === false) {
                log.error(
`${account.protocol}:${account.name} is not enabled, enabling.`
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
        await Promise.all(matrixUsers.map(async matrixUser => {
            log.info(`Getting remote accounts for ${matrixUser.getId()}`);
            const remotes = await store.getRemoteUsersFromMatrixId(matrixUser.getId());
            await Promise.all(remotes.map(async remoteUser => {
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
