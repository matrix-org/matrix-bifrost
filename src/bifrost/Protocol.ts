import { MatrixUser } from "matrix-appservice-bridge";

/**
 * The Matrix third-party network id (MSC-less spec: /thirdparty/protocols) the bridge
 * advertises and publishes portal rooms under. Must match between the registration's
 * `protocols`, the thirdPartyLookup responses, and the appservice room-directory publishes.
 */
export const THIRDPARTY_PROTOCOL_ID = "xmpp";

export abstract class BifrostProtocol {
    public readonly id: string;
    public readonly name: string;
    public readonly summary?: string;
    public readonly homepage?: string;
    constructor(
        data: { name: string, summary?: string, homepage?: string, id: string},
        public readonly canAddExisting: boolean = true,
        public readonly canCreateNew: boolean = true,
    ) {
        this.name = data.name;
        this.summary = data.summary;
        this.homepage = data.homepage;
        this.id = data.id;
    }

    public abstract getMxIdForProtocol(
        senderId: string,
        domain: string,
        prefix?: string): MatrixUser
}
