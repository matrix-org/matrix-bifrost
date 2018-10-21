import { Cli, Bridge, AppServiceRegistration, ClientFactory, Logging } from "matrix-appservice-bridge";
import { MatrixEventHandler } from "./MatrixEventHandler";
import { MatrixRoomHandler } from "./MatrixRoomHandler";
const log = Logging.get("Program");

/**
 * This is the entry point for the bridge. It contains
 */
class Program {
    private cli: Cli;
    private bridge: Bridge;
    private eventHandler: MatrixEventHandler|undefined;
    private roomHandler: MatrixRoomHandler|undefined;
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
        log.info("Starting purple bridge");
        this.eventHandler = new MatrixEventHandler();
        this.roomHandler = new MatrixRoomHandler();
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
        log.info("Bridge has started.");
    }

}

new Program().start();
