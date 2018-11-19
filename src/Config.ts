export class Config {

    public readonly bridge: IConfigBridge = {
        domain: "",
        homeserverUrl: "",
        userPrefix: "_purple_",
    };

    public readonly purple: IConfigPurple = {
        enableDebug: false,
        pluginDir: "./node_modules/node-purple/deps/libpurple/",
    };

    public readonly autoRegistration: IConfigAutoReg = {
        enabled: false,
        protocolSteps: {},
    };

    public readonly bridgeBot: IConfigBridgeBot = {
        accounts: [],
    };
  /**
   * Apply a set of keys and values over the default config.
   * @param newConfig Config keys
   * @param configLayer Private parameter
   */
    public ApplyConfig(newConfig: {[key: string]: any}, configLayer: any = this) {
        Object.keys(newConfig).forEach((key) => {
            if (typeof(configLayer[key]) === "object" &&
                !Array.isArray(configLayer[key])) {
                    this.ApplyConfig(newConfig[key], this[key]);
                    return;
            }
            configLayer[key] = newConfig[key];
        });
    }
}

export interface IConfigBridge {
    domain: string;
    homeserverUrl: string;
    userPrefix: string;
}

export interface IConfigPurple {
    enableDebug: boolean;
    pluginDir: string;
}

export interface IConfigAutoReg {
    enabled: boolean;
    protocolSteps: {[protocol: string]: IAutoRegStep};
}

export interface IAutoRegStep {
    type: "http"|"executable";
    path: string;
    method: string|undefined;
    parameters: {[key: string]: string}; // key -> parameter value
}

export interface IConfigBridgeBot {
    accounts: IBridgeBotAccount[]; // key -> parameter value
}

export interface IBridgeBotAccount {
    name: string;
    protocol: string;
}
