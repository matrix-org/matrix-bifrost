import { MatrixUser } from "matrix-appservice-bridge";

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
