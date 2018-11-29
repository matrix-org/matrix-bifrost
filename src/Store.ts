import { Bridge, MatrixRoom,RemoteRoom, RemoteUser,
    MatrixUser, UserStore, RoomStore, Logging } from "matrix-appservice-bridge";
import { Account } from "node-purple";
import { Util } from "./Util";
import { MROOM_TYPES, IRoomEntry } from "./StoreTypes";
import { PurpleProtocol } from "./purple/PurpleInstance";

const log = Logging.get("Store");

export class Store {
    private roomStore: RoomStore;
    private userStore: UserStore;
    constructor(private bridge: Bridge) {
        this.roomStore = bridge.getRoomStore();
        this.userStore = bridge.getUserStore();
    }

    public async getMatrixUserForAccount(account: Account): Promise<MatrixUser|null> {
        const remoteId = Util.createRemoteId(account.protocol_id, account.username);
        const matrixUsers = await this.userStore.getMatrixUsersFromRemoteId(
            remoteId,
        );
        if (matrixUsers === null || matrixUsers.length === 0) {
            log.error(
                `Could not find an account for ${remoteId}. Either the account` +
                `is not assigned to a matrix user, or we have hit a bug.`,
            );
            return null;
        }
        if (matrixUsers.length > 1) {
            log.error(`Have multiple matrix users assigned to ${account.username}. Bailing`);
            return null;
        }
        return matrixUsers[0];
    }

    public getRemoteUsersFromMxId(userId: string): Promise<RemoteUser[]> {
        return this.bridge.getUserStore().getRemoteUsersFromMatrixId(
            userId,
        );
    }

    public getRoomsOfType(type: MROOM_TYPES): Promise<IRoomEntry[]> {
        return this.roomStore.getEntriesByMatrixRoomData({type});
    }

    public async storeUserAccount(userId: string, protocol: PurpleProtocol, username: string) {
        const mxUser = new MatrixUser(userId);
        const remoteUser = new RemoteUser(Util.createRemoteId(protocol.id, username));
        remoteUser.set("protocolId", protocol.id);
        remoteUser.set("username", username);
        await this.userStore.linkUsers(mxUser, remoteUser);
        log.info("Linked new account:", userId, remoteUser);
    }

    public async storeRoom(matrixId: string, type: MROOM_TYPES, remoteId: string, remoteData: {}) {
        log.info(`Storing remote room (${type}) ${matrixId}`);
        log.debug("with data ", remoteData);
        const mxRoom = new MatrixRoom(matrixId);
        mxRoom.set("type", type);
        try {
            await this.roomStore.setMatrixRoom(mxRoom);
            await this.roomStore.linkRooms(mxRoom, new RemoteRoom(
                remoteId,
            remoteData));
        } catch (ex) {
            log.error("Failed to store room:", ex);
            throw ex;
        }

    }
}
