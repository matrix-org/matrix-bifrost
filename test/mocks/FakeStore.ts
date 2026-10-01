import {
  MatrixUser,
  RemoteUser,
  MatrixRoom,
  RemoteRoom,
  RoomBridgeStoreEntry,
} from "matrix-appservice-bridge";
import { Util } from "../../src/Util";
import {
  MROOM_TYPES,
  IRemoteRoomData,
  IRemoteGroupData,
  MUSER_TYPE_ACCOUNT,
  MUSER_TYPES,
  MROOM_TYPE_UADMIN,
  MUSER_TYPE_GHOST,
  IRemoteImData,
  MROOM_TYPE_IM,
} from "../../src/store/Types";
import { BifrostProtocol } from "../../src/bifrost/Protocol";
import { IAccountMinimal } from "../../src/bifrost/Events";
import { IStore } from "../../src/store/Store";
import { BifrostRemoteUser } from "../../src/store/BifrostRemoteUser";

interface FakeBot {
  isRemoteUser(userId: string): boolean;
}

function subsetMatch(data: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([k, v]) => data[k] === v);
}

/**
 * A minimal in-memory stand-in for matrix-appservice-bridge's nedb-backed
 * UserBridgeStore, replicating only the query/link semantics FakeStore relies on.
 */
class FakeUserStore {
  private matrixUsers = new Map<string, MatrixUser>();
  private remoteUsers = new Map<string, RemoteUser>();
  private links: Array<{ matrixId: string; remoteId: string }> = [];

  async getMatrixUser(userId: string): Promise<MatrixUser | null> {
    return this.matrixUsers.get(userId) ?? null;
  }

  async setMatrixUser(matrixUser: MatrixUser): Promise<void> {
    this.matrixUsers.set(matrixUser.getId(), matrixUser);
  }

  async getRemoteUser(id: string): Promise<RemoteUser | null> {
    return this.remoteUsers.get(id) ?? null;
  }

  async setRemoteUser(remoteUser: RemoteUser): Promise<void> {
    this.remoteUsers.set(remoteUser.getId(), remoteUser);
  }

  async getMatrixUsersFromRemoteId(remoteId: string): Promise<MatrixUser[]> {
    return this.links
      .filter((l) => l.remoteId === remoteId)
      .map((l) => this.matrixUsers.get(l.matrixId))
      .filter((u): u is MatrixUser => !!u);
  }

  async getRemoteUsersFromMatrixId(matrixId: string): Promise<RemoteUser[]> {
    return this.links
      .filter((l) => l.matrixId === matrixId)
      .map((l) => this.remoteUsers.get(l.remoteId))
      .filter((u): u is RemoteUser => !!u);
  }

  async getMatrixLinks(remoteId: string): Promise<string[]> {
    return this.links.filter((l) => l.remoteId === remoteId).map((l) => l.matrixId);
  }

  async getByRemoteData(dataQuery: Record<string, unknown>): Promise<RemoteUser[]> {
    return [...this.remoteUsers.values()].filter((u) => subsetMatch(u.data, dataQuery));
  }

  async linkUsers(matrixUser: MatrixUser, remoteUser: RemoteUser): Promise<void> {
    // Mirrors linkUsers' "insert if not exists" semantics: never clobber data
    // for a user that's already linked.
    if (!this.remoteUsers.has(remoteUser.getId())) {
      this.remoteUsers.set(remoteUser.getId(), remoteUser);
    }
    if (!this.matrixUsers.has(matrixUser.getId())) {
      this.matrixUsers.set(matrixUser.getId(), matrixUser);
    }
    const exists = this.links.some(
      (l) => l.matrixId === matrixUser.getId() && l.remoteId === remoteUser.getId(),
    );
    if (!exists) {
      this.links.push({ matrixId: matrixUser.getId(), remoteId: remoteUser.getId() });
    }
  }

  async unlinkUserIds(matrixUserId: string, remoteUserId: string): Promise<void> {
    this.links = this.links.filter(
      (l) => !(l.matrixId === matrixUserId && l.remoteId === remoteUserId),
    );
  }
}

/**
 * A minimal in-memory stand-in for matrix-appservice-bridge's nedb-backed
 * RoomBridgeStore, replicating only the query/link semantics FakeStore relies on.
 */
class FakeRoomStore {
  private entries = new Map<string, RoomBridgeStoreEntry>();

  private static entryId(matrixId: string, remoteId: string): string {
    return `${matrixId}    ${remoteId}`;
  }

  async linkRooms(
    matrixRoom: MatrixRoom,
    remoteRoom: RemoteRoom,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const id = FakeRoomStore.entryId(matrixRoom.getId(), remoteRoom.getId());
    this.entries.set(id, {
      id,
      matrix: matrixRoom,
      remote: remoteRoom,
      data,
    } as RoomBridgeStoreEntry);
  }

  async getEntriesByRemoteRoomData(data: Record<string, unknown>): Promise<RoomBridgeStoreEntry[]> {
    return [...this.entries.values()].filter((e) => e.remote && subsetMatch(e.remote.data, data));
  }

  async getEntriesByMatrixRoomData(data: Record<string, unknown>): Promise<RoomBridgeStoreEntry[]> {
    return [...this.entries.values()].filter(
      // Avoid MatrixRoom.extras, which recurses infinitely in matrix-appservice-bridge.
      (e) => e.matrix && subsetMatch(e.matrix.serialize().extras, data),
    );
  }

  async getEntriesByMatrixId(matrixId: string): Promise<RoomBridgeStoreEntry[]> {
    return [...this.entries.values()].filter((e) => e.matrix?.getId() === matrixId);
  }

  async getLinkedRemoteRooms(matrixId: string): Promise<RemoteRoom[]> {
    return (await this.getEntriesByMatrixId(matrixId))
      .filter((e) => e.remote)
      .map((e) => e.remote as RemoteRoom);
  }

  async removeEntriesByRemoteRoomId(remoteId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.remote?.getId() === remoteId) {
        this.entries.delete(key);
      }
    }
  }

  async removeEntriesByMatrixRoomId(matrixId: string): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (entry.matrix?.getId() === matrixId) {
        this.entries.delete(key);
      }
    }
  }
}

/**
 * An in-memory IStore for unit tests, replacing the old NeDBStore-backed mock.
 * Ported from the (now removed) NeDBStore's logic, but backed by plain
 * in-memory maps rather than the nedb package.
 */
export class FakeStore implements IStore {
  private roomStore = new FakeRoomStore();
  private userStore = new FakeUserStore();
  private userLock = new Map<string, Promise<void>>();

  constructor(private readonly asBot: FakeBot) {}

  public getMatrixUser(id: string): Promise<MatrixUser | null> {
    return this.userStore.getMatrixUser(id);
  }

  public async getMatrixUserForAccount(account: IAccountMinimal): Promise<MatrixUser | null> {
    const remoteId = Util.createRemoteId(account.protocol_id, account.username);
    const matrixUsers = await this.userStore.getMatrixUsersFromRemoteId(remoteId);
    if (matrixUsers.length !== 1) {
      return null;
    }
    return matrixUsers[0];
  }

  public async setMatrixUser(matrix: MatrixUser): Promise<void> {
    await this.userStore.setMatrixUser(matrix);
  }

  public async getRemoteUserBySender(
    sender: string,
    protocol: BifrostProtocol,
  ): Promise<BifrostRemoteUser | null> {
    const remoteId = Util.createRemoteId(protocol.id, sender);
    await this.userLock.get(remoteId);
    const remote = await this.userStore.getRemoteUser(remoteId);
    if (!remote) {
      return null;
    }
    const userIds = await this.userStore.getMatrixLinks(remoteId);
    if (!userIds.length) {
      return null;
    }
    const realUserIds = userIds.filter((uId) => this.asBot.isRemoteUser(uId));
    return BifrostRemoteUser.fromRemoteUser(
      remote,
      this.asBot as any,
      realUserIds[0] || userIds[0],
    );
  }

  public async getRemoteUsersFromMxId(userId: string): Promise<BifrostRemoteUser[]> {
    return (await this.userStore.getRemoteUsersFromMatrixId(userId)).map((u) =>
      BifrostRemoteUser.fromRemoteUser(u, this.asBot as any, userId),
    );
  }

  public async getAccountsForMatrixUser(
    userId: string,
    protocolId: string,
  ): Promise<BifrostRemoteUser[]> {
    const users = await this.getRemoteUsersFromMxId(userId);
    return users.filter((u) => u.isRemote === false && u.protocolId === protocolId);
  }

  public async getAllAccountsForMatrixUser(userId: string): Promise<BifrostRemoteUser[]> {
    const users = await this.getRemoteUsersFromMxId(userId);
    return users.filter((u) => u.isRemote === false);
  }

  public async getGroupRoomByRemoteData(remoteData: IRemoteRoomData | IRemoteGroupData) {
    const remoteEntries = await this.roomStore.getEntriesByRemoteRoomData(
      remoteData as Record<string, unknown>,
    );
    if (remoteEntries.length > 0) {
      if (remoteEntries.length > 1) {
        throw Error(`Have multiple matrix rooms assigned for chat. Bailing`);
      }
      return remoteEntries[0];
    }
    return null;
  }

  public async getIMRoom(
    matrixUserId: string,
    protocolId: string,
    remoteUserId: string,
  ): Promise<RoomBridgeStoreEntry | null> {
    const remoteEntries = await this.roomStore.getEntriesByRemoteRoomData({
      matrixUser: matrixUserId,
      protocol_id: protocolId,
      recipient: remoteUserId,
    } as IRemoteImData as Record<string, unknown>);
    const suitableEntry = remoteEntries.filter((e) => e.matrix?.get("type") === MROOM_TYPE_IM)[0];
    return suitableEntry || null;
  }

  public async getAllIMRoomsForAccount(
    matrixUserId: string,
    protocolId: string,
  ): Promise<RoomBridgeStoreEntry[]> {
    const remoteEntries = await this.roomStore.getEntriesByRemoteRoomData({
      matrixUser: matrixUserId,
      protocol_id: protocolId,
    } as IRemoteImData as Record<string, unknown>);
    return remoteEntries.filter((e) => e.matrix?.get("type") === MROOM_TYPE_IM);
  }

  public async getAdminRoom(matrixUserId: string): Promise<string | null> {
    const suitableEntries = await this.roomStore.getEntriesByRemoteRoomData({
      matrixUser: matrixUserId,
    } as IRemoteImData as Record<string, unknown>);
    const entry = suitableEntries.find((e) => e.matrix?.get("type") === MROOM_TYPE_UADMIN);
    return entry ? entry.matrix!.getId() : null;
  }

  public async getUsernameMxidForProtocol(
    protocol: BifrostProtocol,
  ): Promise<{ [mxid: string]: string }> {
    const set: { [mxid: string]: string } = {};
    const users = (
      await this.userStore.getByRemoteData({ protocol_id: protocol.id, type: MUSER_TYPE_ACCOUNT })
    )
      .concat(
        await this.userStore.getByRemoteData({ protocolId: protocol.id, type: MUSER_TYPE_ACCOUNT }),
      )
      .filter((u) => u.data.isRemoteUser !== true);
    for (const remoteUser of users) {
      const username = remoteUser.get("username");
      const matrixUsers = await this.userStore.getMatrixUsersFromRemoteId(remoteUser.getId());
      if (!matrixUsers.length) {
        continue;
      }
      set[matrixUsers[0].getId()] = username;
    }
    return set;
  }

  public getRoomsOfType(type: MROOM_TYPES): Promise<RoomBridgeStoreEntry[]> {
    return this.roomStore.getEntriesByMatrixRoomData({ type });
  }

  public async storeAccount(
    userId: string,
    protocol: BifrostProtocol,
    username: string,
    extraData: any = {},
  ) {
    await this.storeUser(userId, protocol, username, MUSER_TYPE_ACCOUNT, extraData);
  }

  public async storeGhost(
    userId: string,
    protocol: BifrostProtocol,
    username: string,
    extraData: any = {},
  ): Promise<{ remote: BifrostRemoteUser; matrix: MatrixUser }> {
    const id = Util.createRemoteId(protocol.id, username);
    await this.userLock.get(id);
    const p = this.storeUser(userId, protocol, username, MUSER_TYPE_GHOST, extraData);
    this.userLock.set(
      id,
      p.then(() => {
        /* for typing*/
      }),
    );
    await p;
    this.userLock.delete(id);
    return p;
  }

  public async removeRoomByRoomId(matrixId: string) {
    const remotes = await this.roomStore.getLinkedRemoteRooms(matrixId);
    for (const remote of remotes) {
      await this.roomStore.removeEntriesByRemoteRoomId(remote.getId());
    }
    await this.roomStore.removeEntriesByMatrixRoomId(matrixId);
  }

  public async getRoomEntryByMatrixId(roomId: string): Promise<RoomBridgeStoreEntry | null> {
    // TODO: This assumes one remote
    const entries = await this.roomStore.getEntriesByMatrixId(roomId);
    if (entries.length === 0) {
      return null;
    }
    const entryWithRemote = entries.filter((e) => e.remote)[0];
    const entry = entryWithRemote || entries[0];
    if (!entry.matrix || !entry.remote) {
      return null;
    }
    return { matrix: entry.matrix, remote: entry.remote, data: {} };
  }

  public async storeRoom(
    matrixId: string,
    type: MROOM_TYPES,
    remoteId: string,
    remoteData: IRemoteRoomData,
  ): Promise<RoomBridgeStoreEntry> {
    // XXX: If a room with all these identifiers already exists, replace it.
    const mxRoom = new MatrixRoom(matrixId);
    mxRoom.set("type", type);
    const remote = new RemoteRoom(remoteId, remoteData as Record<string, unknown>);
    await this.roomStore.linkRooms(mxRoom, remote);
    return { matrix: mxRoom, remote, data: {} };
  }

  public async getMatrixEventId(_roomId: string, _remoteEventId: string) {
    return null;
  }

  public async getRemoteEventId(_roomId: string, _matrixEventId: string) {
    return null;
  }

  public async storeRoomEvent(_roomId: string, _matrixEventId: string, _remoteEventId: string) {
    /* stub */
  }

  public async integrityCheck(_canWrite: boolean): Promise<void> {
    // Not exercised by unit tests; this fake store is memory-only per test run,
    // so there is nothing to reconcile.
  }

  private async storeUser(
    userId: string,
    protocol: BifrostProtocol,
    username: string,
    type: MUSER_TYPES,
    extraData: any = {},
  ): Promise<{ remote: BifrostRemoteUser; matrix: MatrixUser }> {
    let remote: BifrostRemoteUser;
    const id = Util.createRemoteId(protocol.id, username);
    const mxUser = (await this.userStore.getMatrixUser(userId)) || new MatrixUser(userId);
    const existing = await this.userStore.getRemoteUser(id);
    if (!existing) {
      const remoteUser = new RemoteUser(id, extraData);
      remoteUser.set("protocol_id", protocol.id);
      remoteUser.set("username", username);
      remoteUser.set("type", type);
      await this.userStore.linkUsers(mxUser, remoteUser);
      remote = BifrostRemoteUser.fromRemoteUser(remoteUser, this.asBot as any, userId);
      return { remote, matrix: mxUser };
    } else {
      let linkedMatrixUsers = await this.userStore.getMatrixLinks(id);
      if (!linkedMatrixUsers.includes(mxUser.getId())) {
        await this.userStore.linkUsers(mxUser, existing);
        linkedMatrixUsers = [mxUser.getId()];
      }
      for (const lnkUserId of linkedMatrixUsers) {
        if (lnkUserId === mxUser.getId()) {
          continue;
        }
        await this.userStore.unlinkUserIds(lnkUserId, id);
      }
    }
    // If we have an old mxid for this remote, update it.
    Object.keys(extraData).forEach((key) => {
      existing.set(key, extraData[key]);
    });
    await this.userStore.setRemoteUser(existing);
    remote = BifrostRemoteUser.fromRemoteUser(existing, this.asBot as any, userId);
    return { remote, matrix: mxUser };
  }
}
