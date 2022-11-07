import { IConfigAutoReg, IConfigAccessControl } from "./Config";
import { Bridge, MatrixUser, Logger, UserProfile } from "matrix-appservice-bridge";
import request from "axios";
import { Util } from "./Util";
import { IStore } from "./store/Store";
import { IBifrostInstance } from "./bifrost/Instance";
import { IBifrostAccount } from "./bifrost/Account";
import { BifrostProtocol } from "./bifrost/Protocol";
import QuickLRU from "quick-lru";

const log = new Logger("AutoRegistration");
export interface IAutoRegHttpOpts {
    method: "get"|"post"|"put";
    usernameResult: string|null;
}

export interface IAutoRegStep {
    type: "http"|"executable"|"implicit";
    path: string;
    opts: IAutoRegHttpOpts|undefined;
    parameters: {[key: string]: string}; // key -> parameter value
    paramsToStore: string[];
    headers: {[key: string]: string}; // key -> value
}

const ESCAPE_TEMPLATE_REGEX = /[-\/\\^$*+?.()|[\]{}]/g;

export class AutoRegistration {
    private nameCache = new QuickLRU<string, {[key: string]: string}>({ maxSize: this.autoRegConfig.registrationNameCacheSize });
    constructor(
        private autoRegConfig: IConfigAutoReg,
        private accessConfig: IConfigAccessControl,
        private bridge: Bridge,
        private store: IStore,
        private protoInstance: IBifrostInstance) {
    }

    public isSupported(protocol: string) {
        return Object.keys(this.autoRegConfig.protocolSteps!).includes(protocol);
    }

    public async registerUser(protocol: string, mxId: string): Promise<IBifrostAccount> {
        if (this.accessConfig.accountCreation) {
            const whitelist = this.accessConfig.accountCreation.whitelist || [];
            if (!whitelist.find((r) => new RegExp(r).exec(mxId) !== null)) {
                throw Error("This user is not present in the whitelist");
            }
        }
        if (!this.isSupported(protocol)) {
            throw new Error("Protocol unsupported");
        }
        // We assume the caller has already validated this.
        const proto = this.protoInstance.getProtocol(protocol)!;
        const step = this.autoRegConfig.protocolSteps![protocol];
        let res: {username: string, extraParams: Record<string, string>};
        if (step.type === "http") {
            res = await this.handleHttpRegistration(mxId, step);
        } else if (step.type === "implicit") {
            const params = AutoRegistration.generateParameters(step.parameters, mxId);
            await this.store.storeAccount(mxId, proto, params.username);
            return this.protoInstance.getAccount(params.username, protocol, mxId)!;
        } else {
            throw new Error(`This method of registration is unsupported (${step.type})`);
        }
        // XXX: Slight hard-code here.
        this.protoInstance.createBifrostAccount(res.username, proto).createNew(res.extraParams.password);
        log.debug(`Creating ${protocol} account for ${res.username}`);
        const acct = this.protoInstance.getAccount(res.username, protocol, mxId)!;
        log.debug(`Enabling account`);
        acct.setEnabled(true);
        log.debug(`Storing account in bridge store`);
        await this.store.storeAccount(mxId, proto, res.username);
        return acct;
    }

    public async reverseRegisterUser(username: string, protocol: BifrostProtocol): Promise<IBifrostAccount> {
        // Fundamentally, we want to pull a mxid from the string, and then call registerUser.
        if (!this.isSupported(protocol.id)) {
            throw Error("Protocol unsupported");
        }
        log.info("Attempting to reverse register", username);
        const step = this.autoRegConfig.protocolSteps![protocol.id];
        const usernameFormat = step.parameters.username;
        const domainParameter = step.parameters.domain;
        const hasLocalpart = usernameFormat.includes("<T_LOCALPART>");
        if (!usernameFormat) {
            throw Error("No parameter 'username' on registration step, cannot get mxid");
        }
        let mxid;
        log.debug("Input name:", username, ". usernameFormat:", usernameFormat);
        if (usernameFormat.includes("<T_MXID>")) {
            const discards = username.split("<T_MXID>");
            mxid = username.replace(discards[0], discards[1]);
        } else if (usernameFormat.includes("<T_MXID_SANE>")) {
            const discards = usernameFormat.split("<T_MXID_SANE>");
            // Replace parts either side of MXID_SANE
            mxid = username.replace(discards[0], "");
            mxid = username.replace(discards[1], "");
            // Replace parts either side of replace the LAST : and add the @
            mxid = "@" + [...[...mxid].reverse().join("").replace("_", ":")].reverse().join("");
            // Replace any ^a strings with A.
            mxid = mxid.replace(/(\^([a-z]))/g, (m, p1, p2) => p2.toUpperCase());
        } else if (hasLocalpart && usernameFormat.includes("<T_DOMAIN>")) {
            let regexStr = usernameFormat.replace(ESCAPE_TEMPLATE_REGEX, "\\$&");
            regexStr = regexStr.replace("<T_LOCALPART>", "(.+)").replace("<T_DOMAIN>", "(.+)");
            const match = new RegExp(regexStr).exec(username);
            if (!match || match.length < 3) {
                throw Error("String didn't match");
            }
            mxid = `@${match[1]}:${match[2]}`;
        } else if (hasLocalpart) {
            if (!domainParameter) {
                throw Error('`domain` must be specified in autoregistration parameters when only using a localpart')
            }
            let regexStr = usernameFormat.replace(ESCAPE_TEMPLATE_REGEX, "\\$&");
            regexStr = regexStr.replace("<T_LOCALPART>", "(.+)");
            const match = new RegExp(regexStr).exec(username);
            if (!match || match.length < 2) {
                throw Error("String didn't match");
            }
            mxid = `@${match[1]}:${domainParameter}`;
        } else  {
            throw Error("No T_MXID or T_MXID_SANE on username parameter, cannot get mxid");
        }
        if (mxid) {
            // Check they exist.
            // XXX: Profiles aren't a surefire way of finding out if someone exists.
            try {
                const profile = await this.bridge.getIntent().getProfileInfo(mxid);
            } catch (ex) {
                throw Error("User doesn't exist");
            }
        }
        return this.registerUser(protocol.id, mxid);
    }

    /**
     * Generate a set of parameters for a given profile and mxid.
     * This function is backed by a cache.
     *
     * @param protocol The protocol in use.
     * @param mxId The user's mxid
     */
    public generateParametersFor(protocol: string, mxId: string) {
        if (this.nameCache.has(protocol+mxId)) {
            return this.nameCache.get(protocol+mxId);
        }
        if (!this.isSupported(protocol)) {
            throw new Error("Protocol unsupported");
        }
        // We assume the caller has already validated this.
        const step = this.autoRegConfig.protocolSteps![protocol];
        const result = AutoRegistration.generateParameters(step.parameters, mxId);
        this.nameCache.set(protocol+mxId, result);
        return result;
    }

    public static generateParameters(parameters: {[key: string]: string}, mxId: string, profile?: UserProfile)
        : {[key: string]: string} {
        const body = {};
        const mxUser = new MatrixUser(mxId);
        for (const [key, value] of Object.entries(parameters)) {
            body[key] = this.generateParameter(value, mxUser, profile);
        }
        return body;
    }

    private static generateParameter(val: string, mxUser: MatrixUser, profile?: UserProfile) {
        val = val.replace("<T_MXID>", mxUser.getId());
        val = val.replace("<T_MXID_SANE>", this.getSaneMxId(mxUser.getId()));
        val = val.replace("<T_LOCALPART>", mxUser.localpart);
        val = val.replace("<T_DOMAIN>", mxUser.host);
        val = val.replace("<T_DISPLAYNAME>", profile?.displayname || mxUser.localpart);
        val = val.replace("<T_GENERATEPWD>", Util.passwordGen(32));
        val = val.replace("<T_AVATAR>", profile?.avatar_url || "");
        return val;
    }

    private static getSaneMxId(mxId: string) {
        let sane = mxId.replace(/:/g, "_");
        sane = sane.startsWith("@") ? sane.substr(1) : sane;
        return sane.replace(/([A-Z])/g, "^$1".toLowerCase());
    }

    private async handleHttpRegistration(mxId: string, step: IAutoRegStep) {
        log.debug("HttpReg: Running register step", step);
        const opts = step.opts as IAutoRegHttpOpts;
        log.debug("HttpReg: Fetching user profile");
        const intent = this.bridge.getIntent();
        let profile: UserProfile = {};
        try {
            profile = await intent.getProfileInfo(mxId);
            if (profile.avatar_url) {
                profile.avatar_url = intent.matrixClient.mxcToHttpThumbnail(profile.avatar_url, 128, 128, "crop");
            }
        } catch (ex) {
            // Appservice bots don't usually have profiles.
            log.warn("Could not get profile for ", ex);
        }

        log.debug("HttpReg: Got profile", profile);
        const body = AutoRegistration.generateParameters(step.parameters, mxId, profile);
        log.debug("HttpReg: Set parameters:", body);
        try {
            let username;
            const headers = {
                "Content-Type": "application/json",
                ...step.headers,
            };
            log.debug("HttpReg: Attempting request to ", step.path, headers);
            const res = await request.request({
                method: opts.method,
                url: step.path,
                headers,
                data: body,
            });
            if (!opts.usernameResult) { // fetch it from the body.
                username = res.data;
            } else {
                username = res.data[opts.usernameResult];
            }
            log.info(`Registered ${mxId} as ${username}`);
            return {username, extraParams: body};
        } catch (ex) {
            log.error("Failed to register user:", ex);
            throw ex;
        }
    }
}
