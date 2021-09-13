/* eslint-disable no-underscore-dangle */
import { Bridge, MatrixRoom, RemoteRoom, RemoteUser,
    MatrixUser, UserBridgeStore, RoomBridgeStore, Logging, AppServiceBot, RoomBridgeStoreEntry } from "matrix-appservice-bridge";
import { Util } from "../Util";
import { MROOM_TYPES, IRemoteRoomData, IRemoteGroupData,
    MUSER_TYPE_ACCOUNT, MUSER_TYPES, MROOM_TYPE_UADMIN, MROOM_TYPE_GROUP,
    MUSER_TYPE_GHOST, IRemoteImData, MROOM_TYPE_IM } from "./Types";
import { BifrostProtocol } from "../bifrost/Protocol";
import { IAccountMinimal } from "../bifrost/Events";
import { IStore } from "./Store";
import { BifrostRemoteUser } from "./BifrostRemoteUser";

const log = Logging.get("NeDBStore");

export class NeDBStore implements IStore {
    private roomStore: RoomBridgeStore;
    private userStore: UserBridgeStore;
    private asBot: AppServiceBot;
    private userLock: Map<string, Promise<void>>;

    constructor(bridge: Bridge) {
        const roomStore = bridge.getRoomStore();
        const userStore = bridge.getUserStore();
        if (!roomStore || !userStore) {
            throw Error('Bridge stores are not defined!');
        }
        this.roomStore = roomStore;
        this.userStore = userStore;
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

    public async getRemoteUserBySender(sender: string, protocol: BifrostProtocol): Promise<BifrostRemoteUser|null> {
        const remoteId = Util.createRemoteId(protocol.id, sender);
        await this.userLock.get(remoteId);
        const remote = await this.userStore.getRemoteUser(
            remoteId,
        );
        if (!remote) {
            return null;
        }
        const userIds = await this.userStore.getMatrixLinks(remoteId);
        if (!userIds) {
            return null;
        }
        const realUserIds = userIds.filter(
            (uId) => this.asBot.isRemoteUser(uId),
        );
        return BifrostRemoteUser.fromRemoteUser(
            remote,
            this.asBot,
            realUserIds[0] || userIds[0],
        );
    }

    public async getRemoteUsersFromMxId(userId: string): Promise<BifrostRemoteUser[]> {
        return (await this.userStore.getRemoteUsersFromMatrixId(
            userId,
        )).map((u) =>
            BifrostRemoteUser.fromRemoteUser(
                u,
                this.asBot,
                userId,
            ),
        );
    }

    public async getAccountsForMatrixUser(userId: string, protocolId: string): Promise<BifrostRemoteUser[]> {
        const users = await this.getRemoteUsersFromMxId(userId);
        return users.filter((u) => u.isRemote === false && u.protocolId === protocolId);
    }

    public async getAllAccountsForMatrixUser(userId: string): Promise<BifrostRemoteUser[]> {
        const users = await this.getRemoteUsersFromMxId(userId);
        return users.filter((u) => u.isRemote === false);
    }

    public async getGroupRoomByRemoteData(remoteData: IRemoteRoomData|IRemoteGroupData) {
        const remoteEntries = await this.roomStore.getEntriesByRemoteRoomData(remoteData as Record<string, unknown>);
        if (remoteEntries !== null && remoteEntries.length > 0) {
            if (remoteEntries.length > 1) {
                throw Error(`Have multiple matrix rooms assigned for chat. Bailing`);
            }
            return remoteEntries[0];
        }
        return null;
    }

    public async getIMRoom(matrixUserId: string, protocolId: string, remoteUserId: string): Promise<RoomBridgeStoreEntry|null> {
        const remoteEntries = await this.roomStore.getEntriesByRemoteRoomData({
            matrixUser: matrixUserId,
            protocol_id: protocolId,
            recipient: remoteUserId,
        } as IRemoteImData as Record<string, unknown>);
        const suitableEntries = remoteEntries.filter((e) => e.matrix?.get("type") === MROOM_TYPE_IM)[0];
        if (!suitableEntries) {
            return null;
        }
        return suitableEntries;
    }

    public async getAllIMRoomsForAccount(matrixUserId: string, protocolId: string): Promise<RoomBridgeStoreEntry[]> {
        const remoteEntries = await this.roomStore.getEntriesByRemoteRoomData({
            matrixUser: matrixUserId,
            protocol_id: protocolId,
        } as IRemoteImData as Record<string, unknown>);
        return remoteEntries.filter((e) => e.matrix?.get("type") === MROOM_TYPE_IM);
    }

    public async getAdminRoom(matrixUserId: string): Promise<string|null> {
        const suitableEntries = await this.roomStore.getEntriesByRemoteRoomData({
            matrixUser: matrixUserId,
        } as IRemoteImData as Record<string, unknown>);
        const entry = suitableEntries.find((e) => e.matrix?.get("type") === MROOM_TYPE_UADMIN);
        if (!entry) {
            return null;
        }
        return entry.matrix.getId();
    }

    public async getUsernameMxidForProtocol(protocol: BifrostProtocol): Promise<{[mxid: string]: string}> {
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

    public getRoomsOfType(type: MROOM_TYPES): Promise<RoomBridgeStoreEntry[]> {
        return this.roomStore.getEntriesByMatrixRoomData({type});
    }

    public async storeAccount(userId: string, protocol: BifrostProtocol, username: string, extraData: any = {}) {
        const id = Util.createRemoteId(protocol.id, username);
        await this.storeUser(userId, protocol, username, MUSER_TYPE_ACCOUNT, extraData);
    }

    public async storeGhost(userId: string, protocol: BifrostProtocol, username: string, extraData: any = {})
        : Promise<{remote: BifrostRemoteUser, matrix: MatrixUser}> {
        const id = Util.createRemoteId(protocol.id, username);
        await this.userLock.get(id);
        const p = this.storeUser(userId, protocol, username, MUSER_TYPE_GHOST, extraData);
        log.debug("Locking ", id);
        this.userLock.set(id, p.then(() => { /* for typing*/ }));
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

    public async getRoomEntryByMatrixId(roomId: string): Promise<RoomBridgeStoreEntry|null> {
        // TODO: This assumes one remote
        const entries = await this.roomStore.getEntriesByMatrixId(roomId);
        if (entries.length === 0) {
            return null;
        }
        // XXX: The room store can become full of empty remote_id entries.
        const entryWithRemote = entries.filter((e) => e.remote)[0];
        const entry = entryWithRemote || entries[0];
        if (!entry.matrix || !entry.remote) {
            return null;
        }
        return {matrix: entry.matrix, remote: entry.remote, data: {}};
    }

    public async storeRoom(matrixId: string, type: MROOM_TYPES, remoteId: string, remoteData: IRemoteRoomData)
        : Promise<RoomBridgeStoreEntry> {
        // XXX: If a room with all these identifiers already exists, replace it.
        log.info(`Storing remote room (${type}) ${matrixId}`);
        log.debug("with data ", remoteData);
        const mxRoom = new MatrixRoom(matrixId);
        mxRoom.set("type", type);
        const remote = new RemoteRoom(remoteId, remoteData as Record<string, unknown>);
        try {
            await this.roomStore.linkRooms(mxRoom, remote);
        } catch (ex) {
            log.error("Failed to store room:", ex);
            throw ex;
        }
        return {matrix: mxRoom, remote, data: {}};
    }

    public async getMatrixEventId(roomId: string, remoteEventId: string) {
        return null;
    }

    public async getRemoteEventId(roomId: string, matrixEventId: string) {
        return null;
    }

    public async storeRoomEvent(roomId: string, matrixEventId: string, remoteEventId: string) {
        /* stub */
    }

    /**
     * This will check to see if there are multiple instances of a user or room.
     *
     * @return [description]
     */
    public async integrityCheck(canWrite: boolean): Promise<void> {
        log.warn("Starting integrity check");
        if (canWrite) {
            log.warn("Check WILL modify database");
        } else {
            log.warn("Check WILL NOT modify database");
        }
        const removedRemoteRooms: string[] = [];
        // Check the room store.
        // Rooms are considered invalid if they have no remote part.
        // We use `select` to get the _id.
        const roomEntries = await this.roomStore.select({}) as any;
        const invalidRoomEntries = roomEntries.filter(
            (entry) => entry.matrix.extras === undefined ||
            (entry.remote === undefined && entry.matrix.extras.type !== MROOM_TYPE_UADMIN),
        );
        log.info(`Found ${roomEntries.length} room entries, ${invalidRoomEntries.length} of which are invalid`);
        if (canWrite && invalidRoomEntries.length > 0) {
            log.info("Cleaning up room entries");
            await Promise.all(invalidRoomEntries.map((entry) => {
                log.debug(`Cleaning up room entry ${entry._id}`);
                removedRemoteRooms.push(entry._id);
                return this.roomStore.delete({
                    _id: entry._id,
                });
            }));
        }

        // Special case problem: Gateways used to be allowed for rooms that were plumbed/portals
        // We need to remove any gateways to these rooms.
        for (const entry of roomEntries) {
            log.debug(`Checking ${entry.matrix_id} for dupes`);
            if (removedRemoteRooms.includes(entry._id) ||
            entry.matrix.extras.type !== MROOM_TYPE_GROUP) {
                continue;
            }
            const roomGroup: [any] = roomEntries.filter(
                (e) => !removedRemoteRooms.includes(e._id) &&
                        e.matrix_id === entry.matrix_id,
            );
            if (roomGroup.length === 1) {
                continue;
            }
            log.warn(`${entry.matrix_id} has two or more entries`);
            // Favour Plumbed > Portal > Gateway
            roomGroup.sort((eA, eB) => {
                if (eA.remote.plumbed && !eB.remote.plumbed) {
                    return 1;
                } else if (!eA.remote.plumbed && eB.remote.plumbed) {
                    return -1;
                } else if (eA.remote.plumbed && eB.remote.plumbed) {
                    return 0;
                }
                if (eA.remote.gateway && !eB.remote.gateway) {
                    return -1;
                } else if (!eA.remote.gateway && eB.remote.gateway) {
                    return 1;
                } else {
                    return 0;
                }
            });
            roomGroup.pop(); // Remove the one we want to keep
            log.info(`Removing ${roomGroup.length} duplicate rooms.`);
            await Promise.all(roomGroup.map(async (removedEntry) => {
                log.info(`Cleaning up room entry ${removedEntry._id}`, removedEntry.remote);
                removedRemoteRooms.push(removedEntry._id);
                if (canWrite) {
                    await this.roomStore.delete({
                        _id: removedEntry._id,
                    });
                }
            }));
        }

        // Check the user store.
        // Ghosts that exist twice are invalid.
        const userEntries = await this.userStore.getByRemoteData({});
        // XXX: Hack, only do this for xmpp.js where accounts are re-creatable.
        const noTypeEntries = userEntries.filter((e) => e.get("type") === undefined
        && (e.get("protocolId") === "xmpp-js" || e.get("protocol_id") === "xmpp-js"));
        log.info(`Found ${userEntries.length} user entries, ${noTypeEntries.length} of which have no type`);
        const ghostEntries = userEntries.filter((e) => e.get("type") === "ghost");
        const userEntryIds = ghostEntries.map((entry) => entry.id);
        const invalidUserEntries = ghostEntries.filter((entry) =>
            userEntryIds.filter((e) => e === entry.id).length >= 2,
        ).concat(noTypeEntries);
        log.info(`Also found ${invalidUserEntries.length - noTypeEntries.length} invalid ghosts`);

        // Write to the DB
        if (canWrite && invalidUserEntries.length > 0) {
            log.info("Cleaning up user entries");
            await Promise.all(invalidUserEntries.map((entry) => {
                log.debug(`Cleaning up user entry ${entry.id}`);
                return this.userStore.delete({
                    id: entry.id,
                });
            }));
        }
    }

    private async storeUser(userId: string, protocol: BifrostProtocol,
        username: string, type: MUSER_TYPES, extraData: any = {})
        : Promise<{remote: BifrostRemoteUser, matrix: MatrixUser}> {
        let remote: BifrostRemoteUser;
        const id = Util.createRemoteId(protocol.id, username);
        const mxUser = (await this.userStore.getMatrixUser(userId)) || new MatrixUser(userId);
        const existing = await this.userStore.getRemoteUser(id);
        if (!existing) {
            const remoteUser = new RemoteUser(Util.createRemoteId(protocol.id, username), extraData);
            remoteUser.set("protocol_id", protocol.id);
            remoteUser.set("username", username);
            remoteUser.set("type", type);
            await this.userStore.linkUsers(mxUser, remoteUser);
            log.info(`Linked new ${type} ${userId} -> ${id}`);
            remote = BifrostRemoteUser.fromRemoteUser(
                remoteUser,
                this.asBot,
                userId,
            );
            return {remote, matrix: mxUser};
        } else {
            let linkedMatrixUsers = await this.userStore.getMatrixLinks(id);
            if (!linkedMatrixUsers || !linkedMatrixUsers.includes(mxUser.getId())) {
                log.warn(`${id} was not correctly linked to ${mxUser.getId()}, resolving`);
                await this.userStore.linkUsers(mxUser, existing);
                linkedMatrixUsers = [mxUser.getId()];
            }
            for (const lnkUserId of linkedMatrixUsers) {
                if (lnkUserId === mxUser.getId()) {
                    continue;
                }
                log.warn(`${id} is linked to ${lnkUserId}, removing`);
                await this.userStore.unlinkUserIds(lnkUserId, id);
            }
        }
        // If we have an old mxid for this remote, update it.
        log.debug(`Updated existing ${type} ${userId} -> ${id}`);
        Object.keys(extraData).forEach((key) => {
            existing.set(key, extraData[key]);
        });
        await this.userStore.setRemoteUser(existing);
        remote = BifrostRemoteUser.fromRemoteUser(
            existing,
            this.asBot,
            userId,
        );
        return {remote, matrix: mxUser};
    }
}
