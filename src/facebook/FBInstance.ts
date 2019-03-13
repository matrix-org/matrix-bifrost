import { EventEmitter } from "events";
import { IPurpleInstance } from "../purple/IPurpleInstance";
import { IGateway } from "../purple/IGateway";
import { IPurpleAccount } from "../purple/IPurpleAccount";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { Logging, MatrixUser } from "matrix-appservice-bridge";

export class FBProtocol extends PurpleProtocol {
    constructor() {
        super({
            id: "facebook-chat",
            name: "Facebook Chat Protocol Plugin",
            homepage: "N/A",
            summary: "facebook-chat-api plugin",
        }, false, false);
    }

    public getMxIdForProtocol(
            senderId: string,
            domain: string,
            prefix: string = "") {
        return new MatrixUser(`@${prefix}${senderId}:${domain}`);
    }
}

const log = Logging.get("FBInstance");

export const FB_PROTOCOL = new FBProtocol();

export class FBInstance extends EventEmitter implements IPurpleInstance {
    public readonly gateway: IGateway|null = null;

    public createPurpleAccount(username, protocol: PurpleProtocol): IPurpleAccount {

    }

    public getBuddyFromChat(conv: any, buddy: string): any {

    }

    public async start(): Promise<void> {

    }

    public getAccount(username: string, protocolId: string, mxid?: string): IPurpleAccount|null {

    }

    public getProtocol(id: string): PurpleProtocol|undefined {

    }

    public getProtocols(): PurpleProtocol[] {
        return [FB_PROTOCOL];
    }

    public findProtocol(nameOrId: string): PurpleProtocol|undefined {

    }

    public getNickForChat(conv: any): string {

    }

    public getUsernameFromMxid(mxid: string, prefix: string): {username: string, protocol: PurpleProtocol} {

    }

    public eventAck(eventName: string, data: IEventBody) {

    }

    public needsDedupe() {
        return false;
    }

    public needsAccountLock() {
        return false;
    }

}
