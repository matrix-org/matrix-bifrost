import { PurpleProtocol } from "../../src/purple/PurpleProtocol";

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

    }
}

export const dummyProtocol = new DummyProtocol();
