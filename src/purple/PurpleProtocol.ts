import { MatrixUser } from "matrix-appservice-bridge";
import { BifrostProtocol } from "../bifrost/Protocol";

export class PurpleProtocol extends BifrostProtocol {
    constructor(opts: {id: string, name: string, homepage?: string, summary?: string}, private isSoloProtocol = false) {
        super(opts, true, true);
    }

    public getMxIdForProtocol(
            senderId: string,
            domain: string,
            prefix: string = "") {
        // senderId containing : can mess things up
        senderId = senderId.replace(/\:/g, "=3a").replace(/=40/g, "@");
        if (this.isSoloProtocol) {
            new MatrixUser(`@${prefix}${senderId}:${domain}`);
        }
        // This is a little bad, but we drop the prpl- because it's a bit ugly.
        const protocolName = this.id.startsWith("prpl-") ? this.id.substr("prpl-".length) : this.id;
        return new MatrixUser(`@${prefix}${protocolName}_${senderId}:${domain}`);
    }
}