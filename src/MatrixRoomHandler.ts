import { Bridge } from "matrix-appservice-bridge";
const log = require("matrix-appservice-bridge").Logging.get("MatrixRoomHandler");

/**
 * Handles events coming into the appservice.
 */
export class MatrixRoomHandler {
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

    public onAliasQuery(request: any, context: any) {
        log.debug(`onAliasQuery:`, request);
    }

    public onAliasQueried(request: any, context: any) {
        log.debug(`onAliasQueried:`, request);
    }
}
