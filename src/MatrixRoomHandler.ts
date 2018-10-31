import { Bridge, MatrixRoom, RemoteRoom } from "matrix-appservice-bridge";
import { PurpleInstance, PurpleProtocol } from "./purple/PurpleInstance";
import { MROOM_TYPE_IM } from "./StoreTypes";
import { IReceivedImMsg } from "./purple/PurpleEvents";

const log = require("matrix-appservice-bridge").Logging.get("MatrixRoomHandler");

/**
 * Handles creation and handling of rooms.
 */
export class MatrixRoomHandler {
    private bridge: Bridge;
    constructor(private purple: PurpleInstance, private config: any) {
        purple.on("received-im-msg", this.handleIncomingIM.bind(this));
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

    public getLocalpartForProtocol(protocol: PurpleProtocol, senderId: string): string {
        return `${this.config.userPrefix}${protocol.id}_${senderId}`;
    }

    private async handleIncomingIM(data: IReceivedImMsg) {
        // First, find out who the message was intended for.
        const matrixUsers = await this.bridge.getUserStore().getMatrixUsersFromRemoteId(data.account.username);
        if (matrixUsers == null || matrixUsers.length == 0) {
            log.error("Could not find an account for the incoming IM. Either the account is not assigned to a matrix user, or we have hit a bug.");
            return;
        }
        if (matrixUsers.length > 1){ 
            log.error(`Have multiple matrix users assigned to ${data.account.username}. Bailing`);
        }
        const protocol = this.purple.getProtocol(data.account.protocol_id);
        if (!protocol) {
            log.error(`Unknown protocol ${data.account.protocol_id}. Bailing`);
            return;
        }
        const matrixUser = matrixUsers[0];
        // Check to see if we have a room for this IM.
        const roomStore = this.bridge.getRoomStore();
        const remoteData = {
            type: MROOM_TYPE_IM,
            matrixUser: matrixUser.getId(),
            protocol_id: data.account.protocol_id,
            recipient: data.sender,
        };
        const remoteEntries = await roomStore.getEntriesByRemoteRoomData(remoteData);
        const senderLocalpart = this.getLocalpartForProtocol(protocol, data.sender);
        const intent = this.bridge.getIntentFromLocalpart(senderLocalpart);
        let roomId;
        if (remoteEntries == null || remoteEntries.length == 0) {
            log.info(`Couldn't find room for IM ${matrixUser.getId()} <-> ${data.sender}. Creating a new one`);
            const res = await intent.createRoom(true, {
                invite: [matrixUser.getId()],
                is_direct: true,
                name: data.sender,
                visibility: "private",
            });
            roomId = res.room_id;
            await roomStore.linkRooms(new MatrixRoom(roomId), new RemoteRoom(
                `${matrixUser.getId()}:${data.account.protocol_id}:${data.sender}`,
            remoteData));
            // Room doesn't exist yet, create it.
        } else {
            if (remoteEntries.length > 1) {
                log.error(`Have multiple matrix rooms assigned for IM ${matrixUser.getId()} <-> ${data.sender}. Bailing`);
                return;
            }
            roomId = remoteEntries[0].matrix.getId();
        }
        intent.sendMessage(roomId, {
            body: data.message,
        });
    }
}
