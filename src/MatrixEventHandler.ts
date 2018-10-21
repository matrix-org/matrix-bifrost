import { Bridge } from "matrix-appservice-bridge";
const log = require("matrix-appservice-bridge").Logging.get("MatrixEventHandler");

/**
 * Handles events coming into the appservice.
 */
export class MatrixEventHandler {
    private bridge: Bridge;
    constructor() {

    }

    /**
     * Set the bridge for us to use. This must be called after MatrixEventHandler
     * has been created.
     * @return [description]
     */
    public setBridge(bridge: Bridge) {
        this.bridge = bridge;
    }

    public onEvent(request: any, context: any) {
        log.debug(`onEvent:`, request);
    }
}
