import { IAutoRegStep } from "./AutoRegistration";
import { IRoomAlias } from "./RoomAliasSet";
import { IXJSBackendOpts } from "./xmppjs/XJSBackendOpts";
import { Logging } from "matrix-appservice-bridge";
import { PgDataStoreOpts } from "./store/postgres/PgDatastore";
import { IAccountExtraConfig } from "./bifrost/Account";

const log = Logging.get("Config");

export class Config {

    public readonly bridge: IConfigBridge = {
        domain: "",
        homeserverUrl: "",
        mediaserverUrl: undefined,
        userPrefix: "_bifrost_",
        appservicePort: 9555,
    };

    public readonly roomRules: IConfigRoomRule[] = [];

    public readonly datastore: IConfigDatastore = {
        engine: "nedb",
        connectionString: "nedb://.",
        opts: undefined,
    };

    public readonly purple: IConfigPurple = {
        backendOpts: undefined,
        backend: "node-purple",
        defaultAccountSettings: undefined,
    };

    public readonly autoRegistration: IConfigAutoReg = {
        registrationNameCacheSize: 15000,
        enabled: false,
        protocolSteps: undefined,
    };

    public readonly bridgeBot: IConfigBridgeBot = {
        displayname: "Bifrost Bot",
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
        enableGateway: false,
    };

    public readonly metrics: IConfigMetrics = {
        enabled: false,
    };

    public readonly provisioning: IConfigProvisioning = {
        enablePlumbing: true,
        requiredUserPL: 100,
    };

    public readonly tuning: IConfigTuning = {
        waitOnProfileBeforeSend: true,
        conferencePMFallbackCheck: false,
        waitOnJoinBeforePM: [],
    };

    public readonly access: IConfigAccessControl = { };

    public getRoomRule(roomIdOrAlias?: string) {
        const aliasRule = this.roomRules.find((r) => r.room === roomIdOrAlias);
        if (aliasRule && aliasRule.action === "deny") {
            return "deny";
        }
        const roomIdRule = this.roomRules.find((r) => r.room === roomIdOrAlias);
        return roomIdRule?.action || "allow";
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
    mediaserverUrl?: string;
    userPrefix: string;
    appservicePort?: number;
}

export interface IConfigPurple {
    backendOpts: {}|IXJSBackendOpts|undefined;
    backend: "node-purple"|"xmpp-js";
    defaultAccountSettings: {[key: string]: IAccountExtraConfig};
}

export interface IConfigAutoReg {
    enabled: boolean;
    protocolSteps: {[protocol: string]: IAutoRegStep} | undefined;
    registrationNameCacheSize: number;
}

export interface IConfigBridgeBot {
    displayname: string;
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
    aliases: {[regex: string]: IRoomAlias} | undefined;
    enableGateway: boolean;
}

export interface IConfigProvisioning {
    enablePlumbing: boolean;
    requiredUserPL: number;
}

export interface IConfigAccessControl {
    accountCreation?: {
        whitelist?: string[],
    };
}
interface IConfigMetrics {
    enabled: boolean;
}

interface IConfigLogging {
    console: "debug"|"info"|"warn"|"error"|"off";
    files?: {[filename: string]: "debug"|"info"|"warn"|"error"};
}

interface IConfigTuning {
    // Don't send a message or join a room before setting a profile picture
    waitOnProfileBeforeSend: boolean;
    // A nasty hack to check the domain for conf* to see if the PM is coming from a MUC.
    // This is only really needed for legacy clients that don't implement xmlns
    conferencePMFallbackCheck: boolean;
    // Don't send messages from the remote protocol until we have seen them join.
    // A list of prefixes to check.
    waitOnJoinBeforePM: string[];
}

export interface IConfigDatastore {
    engine: "nedb"|"postgres";
    connectionString: string;
    opts: undefined|PgDataStoreOpts;
}

export interface IConfigRoomRule {
    /**
     * Room ID or alias
     */
    room: string;
    /**
     * Should the room be allowed, or denied.
     */
    action: "allow"|"deny";
}