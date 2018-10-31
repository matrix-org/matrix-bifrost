import { helper, plugins } from "node-purple";
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

export class PurpleInstance {
    private protocols: PurpleProtocol[];
    constructor() {
        this.protocols = [];
    }

    public async start() {
        log.info("Starting purple instance");
        helper.setupPurple({
            debugEnabled: 1,
        });
        log.info("Started purple instance");
        this.protocols = plugins.get_protocols().map(
            (data) => new PurpleProtocol(data)
        );
    }

    public getProtocols(): PurpleProtocol[] {
        return this.protocols;
    }
}