/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Pool } from "pg";
import {
  MatrixRoom,
  RemoteRoom,
  MatrixUser,
  Logger,
  RoomBridgeStoreEntry,
  Bridge,
  AppServiceBot,
} from "matrix-appservice-bridge";
import {
  IRemoteGroupData,
  MROOM_TYPES,
  RoomTypeToRemoteRoomData,
  IRemoteImData,
  IRemoteUserAdminData,
  MROOM_TYPE_IM,
  MROOM_TYPE_GROUP,
  MROOM_TYPE_UADMIN,
} from "../Types";
import { BifrostProtocol } from "../../bifrost/Protocol";
import { IAccountMinimal, IChatJoinProperties } from "../../bifrost/Events";
import { BifrostRemoteUser } from "../BifrostRemoteUser";
import { IConfigDatastore } from "../../Config";
import { IStore } from "../Store";
import { Util } from "../../Util";
import { runSchema as runSchemaV1 } from "./schema/v1";
import { runSchema as runSchemaV2 } from "./schema/v2";

const log = new Logger("PgDatstore");

type SchemaMigration = (connection: any) => Promise<void>;
// Loosely typed to match the pre-existing (dynamic require) call site, which has always
// passed a Pool where these schema files declare a PoolClient parameter.
const SCHEMA_MIGRATIONS: { [version: number]: SchemaMigration } = {
  1: runSchemaV1,
  2: runSchemaV2,
};

export interface PgDataStoreOpts {
  min: number;
  max: number;
}

const ROOM_TABLE_IM = "im_rooms";
const ROOM_TABLE_GROUP = "group_rooms";
const ROOM_TABLE_UADMIN = "admin_rooms";
type ROOM_TABLES = typeof ROOM_TABLE_IM | typeof ROOM_TABLE_GROUP | typeof ROOM_TABLE_UADMIN;

const RoomTypeToTable: Record<MROOM_TYPES, ROOM_TABLES> = {
  [MROOM_TYPE_IM]: ROOM_TABLE_IM,
  [MROOM_TYPE_GROUP]: ROOM_TABLE_GROUP,
  [MROOM_TYPE_UADMIN]: ROOM_TABLE_UADMIN,
};

const TableToRoomType: Record<ROOM_TABLES, MROOM_TYPES> = {
  [ROOM_TABLE_IM]: MROOM_TYPE_IM,
  [ROOM_TABLE_GROUP]: MROOM_TYPE_GROUP,
  [ROOM_TABLE_UADMIN]: MROOM_TYPE_UADMIN,
};

type Json = string | number | boolean | null | Json[] | { [name: string]: Json };

interface RoomRow {
  room_id: string;
}

interface ImRoomRow extends RoomRow {
  user_id: string;
  remote_id: string;
  protocol_id: string;
}

interface GroupRoomRow extends RoomRow {
  protocol_id?: string;
  room_name?: string;
  gateway?: boolean;
  properties?: Json;
}

interface AdminRoomRow extends RoomRow {
  user_id?: string;
}

interface RoomTypeToRow {
  [MROOM_TYPE_IM]: ImRoomRow;
  [MROOM_TYPE_GROUP]: GroupRoomRow;
  [MROOM_TYPE_UADMIN]: AdminRoomRow;
}

function rowToRemoteImData(row: ImRoomRow): IRemoteImData {
  return {
    matrixUser: new MatrixUser(row.user_id).userId,
    recipient: row.remote_id,
    protocol_id: row.protocol_id,
  };
}

function rowToRemoteGroupData(row: GroupRoomRow): IRemoteGroupData {
  return {
    gateway: row.gateway,
    room_name: row.room_name,
    protocol_id: row.protocol_id,
    properties: row.properties as IChatJoinProperties,
  };
}

function rowToRemoteUserAdminData(row: AdminRoomRow): IRemoteUserAdminData {
  return row.user_id
    ? {
        matrixUser: new MatrixUser(row.user_id).userId,
      }
    : {};
}

const RoomTypeToDataFunc: {
  [T in MROOM_TYPES]: (row: RoomTypeToRow[T]) => RoomTypeToRemoteRoomData[T];
} = {
  [MROOM_TYPE_IM]: rowToRemoteImData,
  [MROOM_TYPE_GROUP]: rowToRemoteGroupData,
  [MROOM_TYPE_UADMIN]: rowToRemoteUserAdminData,
};

function rowToRoomBridgeStoreEntry<T extends MROOM_TYPES>(
  type: T,
  row: RoomTypeToRow[T],
): RoomBridgeStoreEntry {
  return dataToRoomBridgeStoreEntry(row.room_id, type, RoomTypeToDataFunc[type](row));
}

function rowToGroupRoomBridgeStoreEntry(row: GroupRoomRow): RoomBridgeStoreEntry {
  return dataToRoomBridgeStoreEntry(row.room_id, MROOM_TYPE_GROUP, rowToRemoteGroupData(row));
}

function dataToRoomBridgeStoreEntry<T extends MROOM_TYPES>(
  roomId: string,
  type: T,
  data: RoomTypeToRemoteRoomData[T],
  remoteId = "",
): RoomBridgeStoreEntry {
  return {
    matrix: new MatrixRoom(roomId, { extras: { type } }),
    // Id is not always used.
    remote: new RemoteRoom(remoteId, data as Record<string, unknown>),
    data: {},
  };
}

export class PgDataStore implements IStore {
  public static LATEST_SCHEMA = 2;

  private static BuildUpsertStatement(
    table: string,
    constraint: string,
    keyNames: string[],
  ): string {
    const keys = keyNames.join(", ");
    const keysValues = `\$${keyNames.map((k, i) => i + 1).join(", $")}`;
    const keysSets = keyNames.map((k, i) => `${k} = \$${i + 1}`).join(", ");
    const statement = `INSERT INTO ${table} (${keys}) VALUES (${keysValues}) ON CONFLICT ${constraint} DO UPDATE SET ${keysSets}`;
    return statement;
  }
  private pgPool: Pool;
  private hasEnded: boolean = false;
  private asBot: AppServiceBot;

  constructor(config: IConfigDatastore, bridge: Bridge) {
    this.asBot = bridge.getBot();
    const opts = config.opts || {
      min: 1,
      max: 4,
    };
    this.pgPool = new Pool({
      connectionString: config.connectionString,
      min: opts.min,
      max: opts.max,
    });
    this.pgPool.on("error", (err) => {
      log.error("Postgres Error: %s", err);
    });
    process.on("beforeExit", () => {
      // Ensure we clean up on exit
      this.destroy();
    });
  }

  public close() {
    return this.destroy();
  }

  public async getMatrixUser(id: string) {
    // getMatrixUser and setMatrixUser are used to store caches of the ghost's profile
    const res = await this.pgPool.query(
      "SELECT displayname, avatar_url FROM ghost_cache WHERE user_id = $1 LIMIT 1",
      [id],
    );
    if (!res.rowCount) {
      return null;
    }
    return new MatrixUser(id, res.rows[0]);
  }

  public async setMatrixUser(matrix: MatrixUser) {
    const props = {
      user_id: matrix.getId(),
      displayname: matrix.get("displayname"),
      avatar_url: matrix.get("avatar_url"),
    };
    const statement = PgDataStore.BuildUpsertStatement(
      "ghost_cache",
      "(user_id)",
      Object.keys(props),
    );
    await this.pgPool.query(statement, Object.values(props));
  }

  public async getMatrixUserForAccount(account: IAccountMinimal): Promise<MatrixUser | null> {
    log.info("Getting matrix user for ", account);
    const res = await this.pgPool.query(
      "SELECT user_id FROM accounts WHERE protocol_id = $1 AND username = $2 LIMIT 1",
      [account.protocol_id, account.username],
    );
    if (!res.rowCount) {
      return null;
    }
    return new MatrixUser(res.rows[0].user_id);
  }

  public async getRemoteUserBySender(
    sender: string,
    protocol: BifrostProtocol,
  ): Promise<BifrostRemoteUser | null> {
    // Get a user by sender + profile combo.
    const res = await this.pgPool.query(
      "SELECT * FROM remote_users WHERE protocol_id = $1 AND sender_name = $2 LIMIT 1",
      [protocol.id, sender],
    );
    if (!res.rowCount) {
      return null;
    }
    const row = res.rows[0];
    return new BifrostRemoteUser(
      Util.createRemoteId(protocol.id, sender),
      sender,
      protocol.id,
      this.asBot.isRemoteUser(row.user_id),
      row.displayname,
      row.extra_data,
    );
  }

  public async getRemoteUsersFromMxId(userId: string): Promise<BifrostRemoteUser[]> {
    const res = await this.pgPool.query("SELECT * FROM remote_users WHERE user_id = $1", [userId]);
    return res.rows.map(
      (row) =>
        new BifrostRemoteUser(
          Util.createRemoteId(row.protocol_id, row.sender_name),
          row.sender_name,
          row.protocol_id,
          true,
          row.displayname,
          row.extra_data,
        ),
    );
  }

  public async getAllAccountsForMatrixUser(userId: string): Promise<BifrostRemoteUser[]> {
    const res = await this.pgPool.query("SELECT * FROM accounts WHERE user_id = $1", [userId]);
    return res.rows.map(
      (row) =>
        new BifrostRemoteUser(
          Util.createRemoteId(row.protocol_id, row.username),
          row.username,
          row.protocol_id,
          false,
          "",
          row.extra_data,
        ),
    );
  }

  public async getAccountsForMatrixUser(
    userId: string,
    protocolId: string,
  ): Promise<BifrostRemoteUser[]> {
    const res = await this.pgPool.query(
      "SELECT * FROM accounts WHERE user_id = $1 AND protocol_id = $2",
      [userId, protocolId],
    );
    return res.rows.map(
      (row) =>
        new BifrostRemoteUser(
          Util.createRemoteId(row.protocol_id, row.username),
          row.username,
          row.protocol_id,
          false,
          "",
          row.extra_data,
        ),
    );
  }

  public async getGroupRoomByRemoteData(
    remoteData: IRemoteGroupData,
  ): Promise<RoomBridgeStoreEntry | null> {
    const parts: string[] = [];
    let i = 0;
    for (const key of Object.keys(remoteData)) {
      i++;
      if (key === "properties") {
        parts.push(`${key} @> \$${i}`);
      } else {
        parts.push(`${key} = \$${i}`);
      }
    }
    if (i === 0) {
      throw Error("No remoteData to compare with");
    }
    const statement = `SELECT * FROM ${ROOM_TABLE_GROUP} WHERE ${parts.join(" AND ")}`;
    const res = await this.pgPool.query<GroupRoomRow>(statement, Object.values(remoteData));
    if (res.rowCount === 0) {
      return null;
    }
    return rowToGroupRoomBridgeStoreEntry(res.rows[0]);
  }

  public async getAdminRoom(matrixUserId: string): Promise<string | null> {
    const res = await this.pgPool.query<RoomRow>(
      `SELECT room_id FROM ${ROOM_TABLE_UADMIN} WHERE user_id = $1`,
      [matrixUserId],
    );
    return res.rows[0]?.room_id || null;
  }

  public async getIMRoom(
    matrixUserId: string,
    protocolId: string,
    remoteUserId: string,
  ): Promise<RoomBridgeStoreEntry | null> {
    const res = await this.pgPool.query<RoomRow>(
      `SELECT room_id FROM ${ROOM_TABLE_IM} WHERE user_id = $1 AND remote_id = $2 AND protocol_id = $3`,
      [matrixUserId, remoteUserId, protocolId],
    );
    if (res.rowCount === 0) {
      return null;
    }
    return dataToRoomBridgeStoreEntry(res.rows[0].room_id, MROOM_TYPE_IM, {
      matrixUser: matrixUserId,
      protocol_id: protocolId,
      recipient: remoteUserId,
    });
  }

  public async getAllIMRoomsForAccount(
    matrixUserId: string,
    protocolId: string,
  ): Promise<RoomBridgeStoreEntry[]> {
    const res = await this.pgPool.query<Pick<ImRoomRow, "room_id" | "remote_id">>(
      `SELECT room_id, remote_id FROM ${ROOM_TABLE_IM} WHERE user_id = $1 AND protocol_id = $2`,
      [matrixUserId, protocolId],
    );
    return res.rows.map((row) =>
      dataToRoomBridgeStoreEntry(row.room_id, MROOM_TYPE_IM, {
        matrixUser: matrixUserId,
        protocol_id: protocolId,
        recipient: row.remote_id,
      }),
    );
  }

  public async getUsernameMxidForProtocol(
    protocol: BifrostProtocol,
  ): Promise<{ [mxid: string]: string }> {
    const res = await this.pgPool.query(
      "SELECT user_id, username FROM accounts WHERE protocol_id = $1",
      [protocol.id],
    );
    const users: { [mxid: string]: string } = {};
    res.rows.forEach((row) => {
      users[row.user_id] = row.username;
    });
    return users;
  }

  public async getRoomsOfType(type: MROOM_TYPES): Promise<RoomBridgeStoreEntry[]> {
    const tableName = RoomTypeToTable[type];
    const res = await this.pgPool.query<RoomTypeToRow[typeof type]>(`SELECT * FROM ${tableName}`);
    return res.rows.map((row) => rowToRoomBridgeStoreEntry(type, row));
  }

  public async storeAccount(
    userId: string,
    protocol: BifrostProtocol,
    username: string,
    extraData?: any,
  ) {
    log.debug("Storing account ", userId);
    const acctProps = {
      user_id: userId,
      protocol_id: protocol.id,
      username,
      extra_data: "{}",
    };
    if (extraData) {
      acctProps.extra_data = JSON.stringify(extraData);
    }
    const statement = PgDataStore.BuildUpsertStatement(
      "accounts",
      "ON CONSTRAINT cons_accounts_unique",
      Object.keys(acctProps),
    );
    await this.pgPool.query(statement, Object.values(acctProps));
    log.debug("Stored account ", userId);
  }

  public async storeGhost(
    userId: string,
    protocol: BifrostProtocol,
    username: string,
    extraData?: any,
  ): Promise<{ remote: BifrostRemoteUser; matrix: MatrixUser }> {
    const acctProps = {
      user_id: userId,
      sender_name: username,
      protocol_id: protocol.id,
      extra_data: "{}",
    } as any;
    if (extraData) {
      acctProps.extra_data = JSON.stringify(extraData);
    }
    const statement = PgDataStore.BuildUpsertStatement(
      "remote_users",
      "(user_id)",
      Object.keys(acctProps),
    );
    await this.pgPool.query(statement, Object.values(acctProps));
    return {
      matrix: new MatrixUser(userId),
      remote: new BifrostRemoteUser(userId, username, protocol.id, true),
    };
  }

  public async removeRoomByRoomId(matrixId: string) {
    await this.pgPool.query("DELETE FROM rooms WHERE room_id = $1", [matrixId]);
  }

  public async getRoomEntryByMatrixId(roomId: string): Promise<RoomBridgeStoreEntry | null> {
    log.debug("Getting room", roomId);
    const typeRes = await this.pgPool.query<{ table_name: ROOM_TABLES }>(
      "SELECT tableoid::regclass as table_name FROM rooms WHERE room_id = $1 LIMIT 1",
      [roomId],
    );
    if (!typeRes.rowCount) {
      log.debug("No rooms found");
      return null;
    }
    const tableName = typeRes.rows[0].table_name;
    const type = TableToRoomType[tableName];
    if (!type) {
      throw new Error("Room was of unknown type!");
    }
    const res = await this.pgPool.query<RoomTypeToRow[typeof type]>(
      `SELECT * FROM ${tableName} WHERE room_id = $1 LIMIT 1`,
      [roomId],
    );
    if (!res.rowCount) {
      throw Error("Missing data for room that we did manage to select!");
    }
    const entry = rowToRoomBridgeStoreEntry(type, res.rows[0]);
    log.debug("Found room ", JSON.stringify(entry.remote));
    return entry;
  }

  public async storeRoom<T extends MROOM_TYPES>(
    matrixId: string,
    type: T,
    remoteId: string,
    remoteData: RoomTypeToRemoteRoomData[T],
  ): Promise<RoomBridgeStoreEntry> {
    log.debug("Storing room", matrixId);
    let statement: string;
    const res = dataToRoomBridgeStoreEntry(matrixId, type, remoteData, remoteId);

    if (type === MROOM_TYPE_UADMIN) {
      const adminProps: AdminRoomRow = {
        room_id: matrixId,
        user_id: (remoteData as IRemoteUserAdminData).matrixUser,
      };
      // We don't upsert here.
      await this.pgPool.query(
        `INSERT INTO ${ROOM_TABLE_UADMIN} (room_id, user_id) VALUES ($1, $2)`,
        Object.values(adminProps),
      );
      return res;
    }

    if (type === MROOM_TYPE_IM) {
      const imData = remoteData as IRemoteImData;
      const imProps: ImRoomRow = {
        room_id: matrixId,
        user_id: imData.matrixUser,
        remote_id: imData.recipient,
        protocol_id: imData.protocol_id,
      };
      statement = PgDataStore.BuildUpsertStatement(
        ROOM_TABLE_IM,
        "(room_id)",
        Object.keys(imProps),
      );
      await this.pgPool.query(statement, Object.values(imProps));
      return res;
    }

    const groupData = remoteData as IRemoteGroupData;
    const props: GroupRoomRow = {
      room_id: matrixId,
      protocol_id: remoteData.protocol_id ?? "",
      room_name: groupData.room_name ?? "",
      gateway: groupData.gateway ?? false,
      properties: JSON.stringify(groupData.properties),
    };
    statement = PgDataStore.BuildUpsertStatement(ROOM_TABLE_GROUP, "(room_id)", Object.keys(props));
    await this.pgPool.query(statement, Object.values(props));
    log.debug("Stored room", matrixId);
    return res;
  }

  public async getMatrixEventId(roomId: string, remoteEventId: string) {
    const ev = await this.pgPool.query(
      "SELECT matrix_id FROM events WHERE room_id = $1 AND remote_id = $2",
      [roomId, remoteEventId],
    );
    if (ev.rowCount) {
      return ev.rows[0].matrix_id;
    }
    return null;
  }

  public async getRemoteEventId(roomId: string, matrixEventId: string) {
    const ev = await this.pgPool.query(
      "SELECT matrix_id FROM events WHERE room_id = $1 AND matrix_id = $2",
      [roomId, matrixEventId],
    );
    if (ev.rowCount) {
      return ev.rows[0].remote_id;
    }
    return null;
  }

  public async storeRoomEvent(roomId: string, matrixEventId: string, remoteEventId: string) {
    await this.pgPool.query("INSERT INTO events VALUES ($1, $2, $3)", [
      roomId,
      matrixEventId,
      remoteEventId,
    ]);
  }

  public async integrityCheck(_canWrite: boolean): Promise<void> {
    /* We don't need to do this for postgresql */
  }

  public async ensureSchema() {
    log.info("Starting postgres database engine");
    let currentVersion = await this.getSchemaVersion();
    while (currentVersion < PgDataStore.LATEST_SCHEMA) {
      log.info(`Updating schema to v${currentVersion + 1}`);
      const runSchema = SCHEMA_MIGRATIONS[currentVersion + 1];
      try {
        await runSchema(this.pgPool);
        currentVersion++;
        await this.updateSchemaVersion(currentVersion);
      } catch (ex) {
        log.warn(`Failed to run schema v${currentVersion + 1}:`, ex);
        throw Error("Failed to update database schema");
      }
    }
    log.info(`Database schema is at version v${currentVersion}`);
  }

  public async destroy() {
    log.info("Destroy called");
    if (this.hasEnded) {
      // No-op if end has already been called.
      return;
    }
    this.hasEnded = true;
    await this.pgPool.end();
    log.info("PostgresSQL connection ended");
  }

  private async updateSchemaVersion(version: number) {
    log.debug(`updateSchemaVersion: ${version}`);
    await this.pgPool.query("UPDATE schema SET version = $1", [version]);
  }

  private async getSchemaVersion(): Promise<number> {
    log.debug("Fetching schema version");
    try {
      const { rows } = await this.pgPool.query("SELECT version FROM SCHEMA");
      return rows[0].version;
    } catch (ex) {
      if (ex.code === "42P01") {
        // undefined_table
        log.warn("Schema table could not be found");
        return 0;
      }
      log.error("Failed to get schema version: %s", ex);
    }
    throw Error("Couldn't fetch schema version");
  }
}
