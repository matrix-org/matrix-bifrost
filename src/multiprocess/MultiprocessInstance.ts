import { IPurpleInstance } from "../purple/IPurpleInstance";
import {fork, ChildProcess} from "child_process";
import { IConfigPurple } from "../Config";
import * as uuid from "uuid/v4";
import { Logging } from "matrix-appservice-bridge";
import { IEventBody } from "src/purple/PurpleEvents";
import { EventEmitter } from "events";

const MODULE_PATH = "./build/src/multiprocess/Client.js";
const log = Logging.get("MPInstance");

export class MultiprocessInstance extends EventEmitter implements IPurpleInstance {
    private proc!: ChildProcess;
    private vNeedsDedupe!: boolean;
    private vNeedsAccountLock!: boolean;
    constructor(private config: IConfigPurple) {
        super();
    }

    public async start(config: IConfigPurple) {
        this.proc = fork(MODULE_PATH, [JSON.stringify(this.config)]);
        this.proc.on("message", (msg) => {
            // emit:event:args
            if (!msg.startsWith("emit")) {
                return;
            }
            const parts = /$(.+):(.+):(.+)/.exec(msg);
            if (!parts || parts.length < 4) {
                log.warn("Response was invalid");
                return;
            }
            this.emit(parts[2], JSON.parse(parts[3]));
        });
        await this.execFunction("start", config);
        this.vNeedsDedupe = await this.getValue("needsDedupe");
        this.vNeedsAccountLock = await this.getValue("needsAccountLock");
    }

    public needsDedupe() {
        return this.vNeedsDedupe;
    }

    public needsAccountLock() {
        return this.vNeedsAccountLock;
    }

    private async execFunction(func: string, args: any): Promise<any> {
        const id = uuid();
        return new Promise((resolve, reject) => {
            const listener = (msg) => {
                if (!msg.startsWith(id)) {
                    return;
                }
                const parts = /$(.+):(.+):(.+)/.exec(msg);
                if (!parts || parts.length < 4) {
                    log.warn("Response was invalid");
                    this.proc.removeListener("message", listener);
                    reject("IPC error, response was invalid");
                    return;
                }
                const res = JSON.parse(parts[3]);
                resolve(res);
            };
            this.proc.addListener("message", listener);
            this.proc.send(`${id}:exec:${func}{${JSON.stringify(args)}}\n`);
        });
    }

    private async getValue(key: string): Promise<any> {
        const id = uuid();
        return new Promise((resolve, reject) => {
            const listener = (msg) => {
                if (!msg.startsWith(id)) {
                    return;
                }
                const parts = /$(.+):(.+):(.+)/.exec(msg);
                if (!parts || parts.length < 4) {
                    log.warn("Response was invalid");
                    this.proc.removeListener("message", listener);
                    reject("IPC error, response was invalid");
                    return;
                }
                const res = JSON.parse(parts[3]);
                resolve(res);
            };
            this.proc.addListener("message", listener);
            this.proc.send(`${id}:get:${key}\n`);
        });
    }
}
