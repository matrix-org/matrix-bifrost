import { PurpleProtocol } from "../../src/purple/PurpleProtocol";
import { MatrixUser } from "matrix-appservice-bridge";

class DummyProtocol extends PurpleProtocol {
    constructor() {
        super({
            id: "dummy",
            name: "Dummy",
            homepage: "N/A",
            summary: "Fake protocol for testing only",
        }, false, false);
    }

    public getMxIdForProtocol(
            senderId: string,
            domain: string,
            prefix: string = "") {
        return new MatrixUser(`@${prefix}${senderId}:${domain}`);
    }
}

export const dummyProtocol = new DummyProtocol();
