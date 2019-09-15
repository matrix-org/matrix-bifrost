import { IConfigAutoReg } from "./Config";
import { Bridge, MatrixUser } from "matrix-appservice-bridge";
import * as request from "request-promise-native";
import { Util } from "./Util";
import { Logging } from "matrix-appservice-bridge";
import { Store } from "./Store";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import { IBifrostAccount } from "./backend-common/IBifrostAccount";
import { PurpleProtocol } from "./purple/PurpleProtocol";
import { MUSER_TYPE_ACCOUNT } from "./StoreTypes";
const log = Logging.get("AutoRegistration");

export interface IAutoRegHttpOpts {
    method: string;
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

export class AutoRegistration {
    constructor(
        private autoRegConfig: IConfigAutoReg,
        private bridge: Bridge,
        private store: Store,
        private purple: IPurpleInstance) {
    }

    public isSupported(protocol: string) {
        return Object.keys(this.autoRegConfig.protocolSteps!).includes(protocol);
    }

    public async registerUser(protocol: string, mxId: string): Promise<IPurpleAccount> {
        if (!this.isSupported(protocol)) {
            throw new Error("Protocol unsupported");
        }
        // We assume the caller has already validated this.
        const proto = this.purple.getProtocol(protocol)!;
        const step = this.autoRegConfig.protocolSteps![protocol];
        let res: {username: string, extraParams: any};
        if (step.type === "http") {
            res = await this.handleHttpRegistration(mxId, step);
        } else if (step.type === "implicit") {
            const params = this.generateParameters(step.parameters, mxId);
            await this.store.storeUser(mxId, proto, params.username, MUSER_TYPE_ACCOUNT);
            return this.purple.getAccount(params.username, protocol, mxId)!;
        } else {
            throw new Error(`This method of registration is unsupported (${step.type})`);
        }
        // XXX: Slight hard-code here.
        this.purple.createPurpleAccount(res.username, proto).createNew(res.extraParams.password);
        log.debug(`Creating purple account for ${protocol} ${res.username}`);
        const acct = this.purple.getAccount(res.username, protocol, mxId)!;
        log.debug(`Enabling account`);
        acct.setEnabled(true);
        log.debug(`Storing account in bridge store`);
        await this.store.storeUser(mxId, proto, res.username, MUSER_TYPE_ACCOUNT);
        return acct;
    }

    public async reverseRegisterUser(username: string, protocol: PurpleProtocol): Promise<IPurpleAccount> {
        // Fundamentally, we want to pull a mxid from the string, and then call registerUser.
        if (!this.isSupported(protocol.id)) {
            throw Error("Protocol unsupported");
        }
        log.info("Attempting to reverse register", username);
        const step = this.autoRegConfig.protocolSteps![protocol.id];
        const usernameFormat = step.parameters.username;
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
            let regexStr = usernameFormat.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
            regexStr = regexStr.replace("<T_LOCALPART>", "(.+)").replace("<T_DOMAIN>", "(.+)");
            const match = new RegExp(regexStr).exec(username);
            if (!match || match.length < 3) {
                throw Error("String didn't match");
            }
            log.debug("Result:", match);
            mxid = `@${match[1]}:${match[2]}`;
        } else if (hasLocalpart) {
            throw Error("We don't support localpart only, yet.");
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

    public generateParametersFor(protocol: string, mxId: string) {
            if (!this.isSupported(protocol)) {
                throw new Error("Protocol unsupported");
            }
            // We assume the caller has already validated this.
            const proto = this.purple.getProtocol(protocol)!;
            const step = this.autoRegConfig.protocolSteps![protocol];
            return this.generateParameters(step.parameters, mxId);
    }

    public generateParameters(parameters: {[key: string]: string}, mxId: string, profile: any = {})
        : {[key: string]: string} {
        const body = {};
        const mxUser = new MatrixUser(mxId);
        for (const key of Object.keys(parameters)) {
            let val = parameters[key];
            val = val.replace("<T_MXID>", mxUser.getId());
            val = val.replace("<T_MXID_SANE>", this.getSaneMxId(mxUser.getId()));
            val = val.replace("<T_LOCALPART>", mxUser.localpart);
            val = val.replace("<T_DOMAIN>", mxUser.host);
            val = val.replace("<T_DISPLAYNAME>", profile.displayname || mxUser.localpart);
            val = val.replace("<T_GENERATEPWD>", Util.passwordGen(32));
            val = val.replace("<T_AVATAR>", profile.avatar_url || "");
            body[key] = val;
        }
        return body;
    }

    private getSaneMxId(mxId: string) {
        let sane = mxId.replace(/:/g, "_");
        sane = sane.startsWith("@") ? sane.substr(1) : sane;
        return sane.replace(/([A-Z])/g, "^$1".toLowerCase());
    }

    private async handleHttpRegistration(mxId: string, step: IAutoRegStep) {
        log.debug("HttpReg: Running register step", step);
        const opts = step.opts as IAutoRegHttpOpts;
        log.debug("HttpReg: Fetching user profile");
        const intent = this.bridge.getIntent();
        let profile: any = {};
        try {
            profile = await intent.getProfileInfo(mxId);
            if (profile.avatar_url) {
                profile.avatar_url = intent.getClient().mxcUrlToHttp(profile.avatar_url, 128, 128, "crop");
            }
        } catch (ex) {
            // Appservice bots don't usually have profiles.
            log.warn("Could not get profile for ", ex);
        }

        log.debug("HttpReg: Got profile", profile);
        const body = this.generateParameters(step.parameters, mxId, profile);
        log.debug("HttpReg: Set parameters:", body);
        try {
            let username;
            const headers = {
                "Content-Type": "application/json",
                ...step.headers,
            };
            log.debug("HttpReg: Attempting request to ", step.path, headers);
            const res = await request[opts.method.toLowerCase()]({
                url: step.path,
                headers,
                json: true && opts.usernameResult, // This will also parse, which we might not want.
                body: JSON.stringify(body),
            });
            if (!opts.usernameResult) { // fetch it from the body.
                username = res;
            } else {
                username = res[opts.usernameResult];
            }
            log.info(`Registered ${mxId} as ${username}`);
            return {username, extraParams: body};
        } catch (ex) {
            log.error("Failed to register user:", ex);
            throw ex;
        }
    }
}
