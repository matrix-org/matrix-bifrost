import { IAutoRegStep } from "./AutoRegistration";
import { IRoomAlias } from "./RoomAliasSet";
import { XJSBackendOpts } from "./xmppjs/XJSBackendOpts";
export class Config {

    public readonly bridge: IConfigBridge = {
        domain: "",
        homeserverUrl: "",
        userPrefix: "_purple_",
    };

    public readonly purple: IConfigPurple = {
        backendOpts: undefined,
        backend: "node-purple",
        enableDebug: false,
        pluginDir: "./node_modules/node-purple/deps/libpurple/",
    };

    public readonly autoRegistration: IConfigAutoReg = {
        enabled: false,
        protocolSteps: undefined,
    };

    public readonly bridgeBot: IConfigBridgeBot = {
        accounts: [],
    };

    public readonly logging: IConfigLogging = {
        console: "info",
        files: undefined,
    };

    public readonly profile: IConfigProfile = {
        updateInterval: 60000 * 15,
    };

    public readonly portals: IConfigPortals = {
        aliases: undefined,
    }
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
    backendOpts: {}|XJSBackendOpts|undefined,
    backend: "node-purple"|"xmpp.js";
    enableDebug: boolean;
    pluginDir: string;
}

export interface IConfigAutoReg {
    enabled: boolean;
    protocolSteps: {[protocol: string]: IAutoRegStep} | undefined;
}

export interface IConfigBridgeBot {
    accounts: IBridgeBotAccount[]; // key -> parameter value
}

export interface IBridgeBotAccount {
    name: string;
    protocol: string;
}

export interface IConfigProfile {
    updateInterval: number;
}

export interface IConfigPortals {
    aliases: {[regex: string]: IRoomAlias} | undefined
}

interface IConfigLogging {
  console: "debug"|"info"|"warn"|"error"|"off"
  files?: {[filename: string]: "debug"|"info"|"warn"|"error"}
}
