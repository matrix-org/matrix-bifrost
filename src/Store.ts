import { Bridge, MatrixRoom, RemoteRoom, RemoteUser,
    MatrixUser, UserStore, RoomStore, Logging, AsBot } from "matrix-appservice-bridge";
import { Util } from "./Util";
import { MROOM_TYPES, IRoomEntry, IRemoteRoomData, IRemoteGroupData,
    MUSER_TYPE_ACCOUNT, MUSER_TYPE_GHOST, MUSER_TYPES } from "./StoreTypes";
import { PurpleProtocol } from "./purple/PurpleProtocol";
import { IAccountMinimal } from "./purple/PurpleEvents";

const log = Logging.get("Store");

export class BifrostRemoteUser {
    constructor(private remoteUser: RemoteUser, private userIds: string, public readonly isRemote: boolean) {

    }

    public get extraData() {
        return this.remoteUser.data;
    }

    public get id() {
        return this.remoteUser.getId();
    }

    public get username() {
        return this.remoteUser.get("username");
    }

    public get protocolId() {
        return this.remoteUser.get("protocol_id") || this.remoteUser.get("protocolId");
    }

    public get isAccount() {
        return this.remoteUser.get("type") === MUSER_TYPE_ACCOUNT;
    }

    public get isGhost() {
        return this.remoteUser.get("type") === MUSER_TYPE_GHOST;
    }
}

export class Store {
    private roomStore: RoomStore;
    private userStore: UserStore;
    private asBot: AsBot;

    constructor(private bridge: Bridge) {
        this.roomStore = bridge.getRoomStore();
        this.userStore = bridge.getUserStore();
        this.asBot = bridge.getBot();
    }

    public async getMatrixUserForAccount(account: IAccountMinimal): Promise<MatrixUser|null> {
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

    public async getRemoteUserBySender(sender: string, protocol: PurpleProtocol): Promise<BifrostRemoteUser> {
        const remoteId = Util.createRemoteId(protocol.id, sender);
        const remote = this.bridge.getUserStore().getRemoteUser(
            remoteId,
        );
        const userIds = await this.bridge.getUserStore().getMatrixLinks(remoteId);
        const realUserIds = userIds.filter(
            (uId) => this.asBot.isRemoteUser(uId)
        );
        const userId = realUserIds[0] || userIds[0];
        return new BifrostRemoteUser(await remote, userId, this.asBot.isRemoteUser(userId));
    }

    public async getRemoteUsersFromMxId(userId: string): Promise<BifrostRemoteUser[]> {
        return (await this.bridge.getUserStore().getRemoteUsersFromMatrixId(
            userId,
        )).map((u) => new BifrostRemoteUser(u, userId, this.asBot.isRemoteUser(userId)));
    }

    public async getRoomByRemoteData(remoteData: IRemoteRoomData|IRemoteGroupData) {
        const remoteEntries = await this.roomStore.getEntriesByRemoteRoomData(remoteData);
        if (remoteEntries !== null && remoteEntries.length > 0) {
            if (remoteEntries.length > 1) {
                throw Error(`Have multiple matrix rooms assigned for chat. Bailing`);
            }
            return remoteEntries[0];
        }
    }

    public async getUsernameMxidForProtocol(protocol: PurpleProtocol): Promise<{[mxid: string]: string}> {
        const set = {};
        const users = (await this.userStore.getByRemoteData({protocol_id: protocol.id, type: MUSER_TYPE_ACCOUNT})
        ).concat(await this.userStore.getByRemoteData({protocol_id: protocol.id, type: MUSER_TYPE_ACCOUNT})).filter(
            (u) => u.data.isRemoteUser !== true,
        );
        for (const remoteUser of users) {
            const username = remoteUser.get("username");
            const matrixUsers = await this.userStore.getMatrixUsersFromRemoteId(remoteUser.getId());
            if (!matrixUsers) {
                continue;
            }
            set[matrixUsers[0].getId()] = username;
        }
        return set;
    }

    public getRoomsOfType(type: MROOM_TYPES): Promise<IRoomEntry[]> {
        return this.roomStore.getEntriesByMatrixRoomData({type});
    }

    public async storeUser(userId: string, protocol: PurpleProtocol,
                           username: string, type: MUSER_TYPES, extraData: any = {}) {
        const mxUser = new MatrixUser(userId);
        const id = Util.createRemoteId(protocol.id, username);
        const existing = await this.userStore.getRemoteUser(id);
        if (!existing) {
            const remoteUser = new RemoteUser(Util.createRemoteId(protocol.id, username), extraData);
            remoteUser.set("protocol_id", protocol.id);
            remoteUser.set("username", username);
            remoteUser.set("type", type);
            await this.userStore.linkUsers(mxUser, remoteUser);
            log.info(`Linked new ${type} ${userId} -> ${id}`);
        } else {
            log.debug(`Updated existing ${type} ${userId} -> ${id}`);
            Object.keys(extraData).forEach((key) => {
                existing.set(key, extraData[key]);
            });
            await this.userStore.setRemoteUser(existing);
        }
    }

    public async removeRoomByRoomId(matrixId: string) {
        log.info(`Removing room ${matrixId}`);
        (await this.roomStore.getLinkedRemoteRooms(matrixId)).forEach((remote) => {
            this.roomStore.removeEntriesByRemoteRoomId(remote.getId());
        });
        await this.roomStore.removeEntriesByMatrixRoomId(matrixId);
    }

    public async storeRoom(matrixId: string, type: MROOM_TYPES, remoteId: string, remoteData: IRemoteRoomData)
    : Promise<{remote: RemoteRoom, matrix: MatrixRoom}> {
        // XXX: If a room with all these identifiers already exists, replace it.
        log.info(`Storing remote room (${type}) ${matrixId}`);
        log.debug("with data ", remoteData);
        const mxRoom = new MatrixRoom(matrixId);
        mxRoom.set("type", type);
        const remote = new RemoteRoom(
            remoteId,
        remoteData);
        try {
            await this.roomStore.setMatrixRoom(mxRoom);
            await this.roomStore.linkRooms(mxRoom, remote);
        } catch (ex) {
            log.error("Failed to store room:", ex);
            throw ex;
        }
        return {matrix: mxRoom, remote};
    }
}
