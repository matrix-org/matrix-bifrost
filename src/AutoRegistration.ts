import { IConfigAutoReg } from "./Config";
import { Bridge } from "matrix-appservice-bridge";
import * as request from "request-promise-native";
import { Util } from "./Util";
import { Logging } from "matrix-appservice-bridge";
import { Store } from "./Store";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import { IPurpleAccount } from "./purple/IPurpleAccount";
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
            await this.store.storeUserAccount(mxId, proto, params.username);
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
        await this.store.storeUserAccount(mxId, proto, res.username);
        return acct;
    }

    private generateParameters(parameters: {[key: string]: string}, mxId: string, profile: any = {})
        : {[key: string]: string} {
        const body = {};
        const mxIdParts = mxId.substr(1).split(":");
        for (const key of Object.keys(parameters)) {
            let val = parameters[key];
            val = val.replace("<T_MXID>", mxId);
            val = val.replace("<T_MXID_SANE>", mxId.replace(/:/g, "_").replace(/@/g, ""));
            val = val.replace("<T_LOCALPART>", mxIdParts[0]);
            val = val.replace("<T_DISPLAYNAME>", profile.displayname || mxIdParts[0]);
            val = val.replace("<T_GENERATEPWD>", Util.passwordGen(32));
            val = val.replace("<T_AVATAR>", profile.avatar_url || "");
            body[key] = val;
        }
        return body;
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
