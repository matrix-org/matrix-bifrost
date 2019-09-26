import { MatrixUser } from "matrix-appservice-bridge";

export class BifrostProtocol {
    public readonly name: string;
    public readonly summary: string;
    public readonly homepage: string;
    public readonly id: string;
    constructor(
        data: any,
        public readonly canAddExisting: boolean = true,
        public readonly canCreateNew: boolean = true,
        ) {
        this.name = data.name;
        this.summary = data.summary!;
        this.homepage = data.homepage!;
        this.id = data.id;
    }

    public getMxIdForProtocol(
        senderId: string,
        domain: string,
        prefix: string = "",
        isGroupChat: boolean = false): MatrixUser {
        // This is a little bad, but we drop the prpl- because it's a bit ugly.
        const protocolName = this.id.startsWith("prpl-") ? this.id.substr("prpl-".length) : this.id;
        // senderId containing : can mess things up
        senderId = senderId.replace(/\:/g, "=3a");
        return new MatrixUser(`@${prefix}${protocolName}_${senderId}:${domain}`);
    }
}
