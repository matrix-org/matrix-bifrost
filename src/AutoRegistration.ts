import { IConfigAutoReg } from "./Config";
import { Bridge } from "matrix-appservice-bridge";
import * as request from "request-promise-native";
import { Util } from "./Util";
import { Logging } from "matrix-appservice-bridge";
import { Store } from "./Store";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import { PurpleAccount } from "./purple/PurpleAccount";
const log = Logging.get("AutoRegistration");

export interface IAutoRegHttpOpts {
    method: string;
    usernameResult: string|null;
}

export interface IAutoRegStep {
    type: "http"|"executable";
    path: string;
    opts: IAutoRegHttpOpts|undefined;
    parameters: {[key: string]: string}; // key -> parameter value
    paramsToStore: string[];
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

    public async registerUser(protocol: string, mxId: string) {
        if (!this.isSupported(protocol)) {
            throw new Error("Protocol unsupported");
        }
        const step = this.autoRegConfig.protocolSteps![protocol];
        let res: {username: string, extraParams: any};
        if (step.type === "http") {
            res = await this.handleHttpRegistration(mxId, step);
        } else {
            throw new Error(`This method of registration is unsupported (${step.type})`);
        }
        // We assume the caller has already validated this.
        const proto = this.purple.getProtocol(protocol)!;
        // XXX: Slight hard-code here.
        new PurpleAccount(res.username, proto).createNew(res.extraParams.password);
        log.debug(`Creating purple account for ${protocol} ${res.username}`);
        const acct = this.purple.getAccount(res.username, protocol)!;
        log.debug(`Enabling account`);
        acct.setEnabled(true);
        log.debug(`Storing account in bridge store`);
        await this.store.storeUserAccount(mxId, proto, res.username);
    }

    private async handleHttpRegistration(mxId: string, step: IAutoRegStep) {
        log.debug("HttpReg: Running register step", step);
        const opts = step.opts as IAutoRegHttpOpts;
        const body = {};
        const mxIdParts = mxId.substr(1).split(":");
        log.debug("HttpReg: Fetching user profile");
        const intent = this.bridge.getIntent();
        const profile = await intent.getProfileInfo(mxId);
        if (profile.avatar_url) {
            profile.avatar_url = intent.getClient().mxcUrlToHttp(profile.avatar_url, 128, 128, "crop");
        }
        log.debug("HttpReg: Got profile", profile);
        for (const key of Object.keys(step.parameters)) {
            let val = step.parameters[key];
            val = val.replace("<T_MXID>", mxId);
            val = val.replace("<T_LOCALPART>", mxIdParts[0]);
            val = val.replace("<T_DISPLAYNAME>", profile.displayname || "");
            val = val.replace("<T_GENERATEPWD>", Util.passwordGen(32));
            val = val.replace("<T_AVATAR>", profile.avatar_url || "");
            body[key] = val;
        }
        log.debug("HttpReg: Set parameters:", body);
        try {
            let username;
            log.debug("HttpReg: Attempting request to ", step.path);
            const res = await request({
                method: opts.method.toLowerCase(),
                url: step.path,
                headers: [
                  {
                    name: "content-type",
                    value: "application/json",
                },
                ],
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
