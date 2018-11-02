import { EventEmitter } from "events";
import { helper, plugins } from "node-purple";
import { PurpleAccount } from "./PurpleAccount";
const log = require("matrix-appservice-bridge").Logging.get("PurpleInstance");

export class PurpleProtocol {
    public readonly name: string;
    public readonly summary: string;
    public readonly homepage: string;
    public readonly id: string;
    constructor(data: any) {
        this.name = data.name;
        this.summary = data.summary;
        this.homepage = data.homepage;
        this.id = data.id;
    }
}

export class PurpleInstance extends EventEmitter {
    private protocols: PurpleProtocol[];
    private accounts: Map<string, PurpleAccount>;
    constructor() {
        super();
        this.protocols = [];
        this.accounts = new Map();
    }

    public async start(config: any) {
        log.info("Starting purple instance");
        helper.setupPurple({
            debugEnabled: config.enableDebug ? 1 : 0,
        });
        log.info("Started purple instance");
        this.protocols = plugins.get_protocols().map(
            (data) => new PurpleProtocol(data)
        );
    }

    public getAccount(username: string, protocolId: string): PurpleAccount {
        const key = `${protocolId}://${username}`;
        let acct = this.accounts.get(key);
        if (!acct) {
            const protocol = this.getProtocol(protocolId);
            if (protocol === undefined) {
                throw new Error("Protocol not found");
            }
            acct = new PurpleAccount(username, protocol);
            acct.findAccount();
            this.accounts.set(key, acct);
        }
        return acct;
    }

    public getProtocol(id: string){
        return this.protocols.find((proto) => proto.id === id);
    }

    public getProtocols(): PurpleProtocol[] {
        return this.protocols;
    }

    public eventFunc(eventName: string, data: any) {
        log.verbose(`Got ${eventName} from purple`);
        this.emit(eventName, data);
    }
}