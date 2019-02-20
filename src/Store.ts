import { Bridge, MatrixRoom, RemoteRoom, RemoteUser,
    MatrixUser, UserStore, RoomStore, Logging, AsBot } from "matrix-appservice-bridge";
import { Util } from "./Util";
import { MROOM_TYPES, IRoomEntry, IRemoteRoomData, IRemoteGroupData,
    MUSER_TYPE_ACCOUNT, MUSER_TYPE_GHOST, MUSER_TYPES, MROOM_TYPE_UADMIN } from "./StoreTypes";
import { PurpleProtocol } from "./purple/PurpleProtocol";
import { IAccountMinimal } from "./purple/PurpleEvents";
const log = Logging.get("Store");

export class BifrostRemoteUser {
    constructor(public readonly remoteUser: RemoteUser, private userIds: string, public readonly isRemote: boolean) {

    }

    public get extraData() {
        return this.remoteUser.data;
    }

    public get id() {
        return this.remoteUser.getId();
    }

    public get username(): string {
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

    public get displayname(): string|undefined {
        return this.remoteUser.get("displayname");
    }
}

export class Store {
    private roomStore: RoomStore;
    private userStore: UserStore;
    private asBot: AsBot;
    private userLock: Map<string, Promise<void>>

    constructor(private bridge: Bridge) {
        this.roomStore = bridge.getRoomStore();
        this.userStore = bridge.getUserStore();
        this.asBot = bridge.getBot();
        this.userLock = new Map();
    }

    public getMatrixUser(id: string): Promise<MatrixUser|null> {
        return this.userStore.getMatrixUser(id);
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

    public async setMatrixUser(matrix: MatrixUser) {
        this.userStore.setMatrixUser(matrix);
    }

    public async getRemoteUserBySender(sender: string, protocol: PurpleProtocol): Promise<BifrostRemoteUser|null> {
        const remoteId = Util.createRemoteId(protocol.id, sender);
        await this.userLock.get(remoteId);
        const remote = await this.bridge.getUserStore().getRemoteUser(
            remoteId,
        );
        if (!remote) {
            return null;
        }
        const userIds = await this.bridge.getUserStore().getMatrixLinks(remoteId);
        const realUserIds = userIds.filter(
            (uId) => this.asBot.isRemoteUser(uId),
        );
        const userId = realUserIds[0] || userIds[0];
        return new BifrostRemoteUser(remote, userId, this.asBot.isRemoteUser(userId));
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
        const users = (await this.userStore.getByRemoteData({protocol_id: protocol.id, type: MUSER_TYPE_ACCOUNT}))
        .concat(await this.userStore.getByRemoteData({protocolId: protocol.id, type: MUSER_TYPE_ACCOUNT}),
        ).filter(
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
                           username: string, type: MUSER_TYPES, extraData: any = {})
                            : Promise<{remote: BifrostRemoteUser, matrix: MatrixUser}> {
        const id = Util.createRemoteId(protocol.id, username);
        await this.userLock.get(id);
        const p = this._storeUser(userId, protocol, username, type, extraData);
        log.debug("Locking ", id);
        this.userLock.set(id, p.then(() => { /*for typing*/ }));
        const res = await p;
        log.debug("Unlocking ", id);
        this.userLock.delete(id);
        return p;
    }

    public async removeRoomByRoomId(matrixId: string) {
        log.info(`Removing room ${matrixId}`);
        (await this.roomStore.getLinkedRemoteRooms(matrixId)).forEach((remote) => {
            this.roomStore.removeEntriesByRemoteRoomId(remote.getId());
        });
        await this.roomStore.removeEntriesByMatrixRoomId(matrixId);
    }

    public async getEntryByMatrixId(roomId: string): Promise<{matrix: MatrixRoom, remote: RemoteRoom}|null> {
        // TODO: This assumes one remote
        const entries = await this.roomStore.getEntriesByMatrixId(roomId);
        if (entries.length === 0) {
            return null;
        }
        // XXX: The room store can become full of empty remote_id entries.
        const entryWithRemote = entries.filter((e) => e.remote)[0];
        const entry = entryWithRemote || entries[0];
        return {matrix: entry.matrix, remote: entry.remote};
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
            await this.roomStore.linkRooms(mxRoom, remote);
        } catch (ex) {
            log.error("Failed to store room:", ex);
            throw ex;
        }
        return {matrix: mxRoom, remote};
    }

    /**
     * This will check to see if there are multiple instances of a user or room.
     * @return [description]
     */
    public async integrityCheck(canWrite: boolean): Promise<void> {
        log.warn("Starting integrity check");
        if (canWrite) {
            log.warn("Check WILL modify database");
        } else {
            log.warn("Check WILL NOT modify database");
        }
        // Check the room store.
        // Rooms are considered invalid if they have no remote part.
        // We use `select` to get the _id.
        const roomEntries = await this.roomStore.select({}) as any;
        const invalidRoomEntries = roomEntries.filter(
            (entry) => entry.matrix.data === undefined ||
            (entry.remote === undefined && entry.matrix.data.type !== MROOM_TYPE_UADMIN),
        );
        log.info(`Found ${roomEntries.length} room entries, ${invalidRoomEntries.length} of which are invalid`);
        if (canWrite && invalidRoomEntries.length > 0) {
            log.info("Cleaning up room entries");
            await Promise.all(invalidRoomEntries.map((entry) => {
                log.debug(`Cleaning up room entry ${entry._id}`);
                return this.roomStore.delete({
                    _id: entry._id,
                }) as Promise<void>;
            })).then(() => { /* for typescript */});
        }

        // Check the user store.
        // Ghosts that exist twice are invalid.
        const userEntries = await this.userStore.getByRemoteData({type: "ghost"});
        const userEntryIds = userEntries.map((entry) => entry.id);
        const invalidUserEntries = userEntries.filter((entry) =>
            userEntryIds.filter((e) => e.id === entry.id).length >= 2,
        );
        log.info(`Found ${userEntries.length} ghost user entries, ${invalidUserEntries.length} of which are invalid`);
        if (canWrite && invalidUserEntries.length > 0) {
            log.info("Cleaning up user entries");
            await Promise.all(invalidUserEntries.map((entry) => {
                log.debug(`Cleaning up user entry ${entry._id}`);
                return this.userStore.delete({
                    id: entry,
                }) as Promise<void>;
            })).then(() => { /* for typescript */});
        }
    }

    private async _storeUser(userId: string, protocol: PurpleProtocol,
                             username: string, type: MUSER_TYPES, extraData: any = {})
                            : Promise<{remote: BifrostRemoteUser, matrix: MatrixUser}> {
        const id = Util.createRemoteId(protocol.id, username);
        const mxUser = new MatrixUser(userId);
        const existing = await this.userStore.getRemoteUser(id);
        if (!existing) {
            const remoteUser = new RemoteUser(Util.createRemoteId(protocol.id, username), extraData);
            remoteUser.set("protocol_id", protocol.id);
            remoteUser.set("username", username);
            remoteUser.set("type", type);
            await this.userStore.linkUsers(mxUser, remoteUser);
            log.info(`Linked new ${type} ${userId} -> ${id}`);
            return {remote: new BifrostRemoteUser(
                remoteUser, userId, this.asBot.isRemoteUser(userId),
            ), matrix: mxUser};
        }
        log.debug(`Updated existing ${type} ${userId} -> ${id}`);
        Object.keys(extraData).forEach((key) => {
            existing.set(key, extraData[key]);
        });
        await this.userStore.setRemoteUser(existing);
        return {remote: new BifrostRemoteUser(
            existing, userId, this.asBot.isRemoteUser(userId),
        ), matrix: mxUser};
    }
}
