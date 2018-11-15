import { Bridge, MatrixRoom, RemoteUser, MatrixUser, UserStore, RoomStore, Logging } from "matrix-appservice-bridge";
import { Account } from "node-purple";
import { Util } from "./Util";
import { MROOM_TYPES, IRoomEntry } from "./StoreTypes";

const log = Logging.get("Store");

export class Store {
    private roomStore: RoomStore;
    private userStore: UserStore;
    constructor(private bridge: Bridge) {
        this.roomStore = bridge.getRoomStore();
        this.userStore = bridge.getUserStore();
    }

    public async getMatrixUserForAccount(account: Account): Promise<MatrixUser|null> {
        const matrixUsers = await this.userStore.getMatrixUsersFromRemoteId(
            Util.createRemoteId(account.protocol_id, account.username),
        );
        if (matrixUsers === null || matrixUsers.length === 0) {
            log.error(
                `Could not find an account for ${account.username}. Either the account` +
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
}
