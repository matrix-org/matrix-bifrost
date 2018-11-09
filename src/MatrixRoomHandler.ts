import { Bridge, MatrixRoom, RemoteRoom, MatrixUser, Intent} from "matrix-appservice-bridge";
import { PurpleInstance, PurpleProtocol } from "./purple/PurpleInstance";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import { MROOM_TYPE_IM } from "./StoreTypes";
import { IReceivedImMsg } from "./purple/PurpleEvents";
import * as request from "request-promise-native";
import { ProfileSync } from "./ProfileSync";
const log = require("matrix-appservice-bridge").Logging.get("MatrixRoomHandler");

/**
 * Handles creation and handling of rooms.
 */
export class MatrixRoomHandler {
    private bridge: Bridge;
    constructor(private purple: IPurpleInstance, private profileSync: ProfileSync, private config: any) {
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

    private async createOrGetIMRoom(data: IReceivedImMsg, matrixUser: MatrixUser, intent: Intent) {
        // Check to see if we have a room for this IM.
        const roomStore = this.bridge.getRoomStore();
        let remoteData = {
            matrixUser: matrixUser.getId(),
            protocol_id: data.account.protocol_id,
            recipient: data.sender,
        };
        // For some reason the following function wites to remoteData, so recreate it later
        const remoteEntries = await roomStore.getEntriesByRemoteRoomData(remoteData);
        let roomId;
        if (remoteEntries == null || remoteEntries.length == 0) {
            remoteData = {
                matrixUser: matrixUser.getId(),
                protocol_id: data.account.protocol_id,
                recipient: data.sender,
            };
            log.info(`Couldn't find room for IM ${matrixUser.getId()} <-> ${data.sender}. Creating a new one`);
            roomId = await intent.createRoom(true, {
                is_direct: true,
                name: data.sender,
                visibility: "private",
            }).room_id;
            // XXX: Inviting in the createRoom options wasn't working (did it actually get removed in the end?)
            //      I lost patience with it so we do the invite here.
            await intent.invite(roomId, matrixUser.getId());
            log.debug("Created room with id ", roomId);
            const remoteId = Buffer.from(
                `${matrixUser.getId()}:${data.account.protocol_id}:${data.sender}`
            ).toString("base64");
            log.debug("Storing remote room ", remoteId, " with data ", remoteData);
            const mxRoom = new MatrixRoom(roomId);
            mxRoom.set("type", MROOM_TYPE_IM);
            await roomStore.setMatrixRoom(mxRoom);
            await roomStore.linkRooms(mxRoom, new RemoteRoom(
                remoteId,
            remoteData));
            // Room doesn't exist yet, create it.
        } else {
            if (remoteEntries.length > 1) {
                log.error(`Have multiple matrix rooms assigned for IM ${matrixUser.getId()} <-> ${data.sender}. Bailing`);
                return;
            }
            roomId = remoteEntries[0].matrix.getId();
        }
    }

    private async handleIncomingIM(data: IReceivedImMsg) {
        log.debug(`Handling incoming IM from ${data.sender}`);
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
        log.debug(`Message intended for ${matrixUser.getId()}`);
        const senderMatrixUser = this.profileSync.getMxIdForProtocol(protocol, data.sender);
        const intent = this.bridge.getIntent(senderMatrixUser.getId());
        log.debug("Identified ghost user as", senderMatrixUser.getId());
        let roomId;
        try {
            roomId = await this.createOrGetIMRoom(data, matrixUser, intent);
        } catch (e) {
            log.error(`Failed to get/create room for this IM: ${e}`);
            return;
        }
        // Update the user if needed.
        await this.profileSync.updateProfile(protocol, data.sender,
            await this.purple.getAccount(data.account.username, data.account.protocol_id)
        );

        log.debug(`Sending message to ${roomId} as ${senderMatrixUser.getId()}`);
        await intent.sendMessage(roomId, {
            msgtype: "m.text",
            body: data.message,
        });
    }
}
