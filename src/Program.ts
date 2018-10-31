import { Cli, Bridge, AppServiceRegistration, ClientFactory, Logging } from "matrix-appservice-bridge";
import { MatrixEventHandler } from "./MatrixEventHandler";
import { MatrixRoomHandler } from "./MatrixRoomHandler";
import { PurpleInstance } from "./purple/PurpleInstance";
const log = Logging.get("Program");

/**
 * This is the entry point for the bridge. It contains
 */
class Program {
    private cli: Cli;
    private bridge: Bridge;
    private eventHandler: MatrixEventHandler|undefined;
    private roomHandler: MatrixRoomHandler|undefined;
    private purple: PurpleInstance;
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
        this.eventHandler = new MatrixEventHandler(this.purple);
        this.roomHandler = new MatrixRoomHandler(this.purple, config);
        this.bridge = new Bridge({
          //clientFactory,
          controller: {
            // onUserQuery: userQuery,
            onAliasQuery: this.roomHandler.onAliasQuery.bind(this.roomHandler),
            onEvent: this.eventHandler.onEvent.bind(this.eventHandler),
            onAliasQueried: this.roomHandler.onAliasQueried.bind(this.roomHandler),
            // We don't handle these just yet.
            //thirdPartyLookup: this.thirdpa.ThirdPartyLookup,
          },
          domain: config.bridge.domain,
          homeserverUrl: config.bridge.homeserverUrl,
          registration: "purple-registration.yaml",
        });
        await this.bridge.run(port, config);
        this.eventHandler.setBridge(this.bridge);
        this.roomHandler.setBridge(this.bridge);
        log.info("Bridge has started.");
        await this.purple.start();
        await this.startPurpleAccounts();
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
