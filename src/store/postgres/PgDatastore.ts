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
import { MatrixRoom, RemoteRoom, MatrixUser, Logging, RoomBridgeStoreEntry } from "matrix-appservice-bridge";
import { IRemoteRoomData, IRemoteGroupData, MROOM_TYPES,
    IRemoteImData, IRemoteUserAdminData, MROOM_TYPE_IM, MROOM_TYPE_UADMIN } from "../Types";
import { BifrostProtocol } from "../../bifrost/Protocol";
import { IAccountMinimal } from "../../bifrost/Events";
import { BifrostRemoteUser } from "../BifrostRemoteUser";
import { IConfigDatastore } from "../../Config";
import { IStore } from "../Store";
import { Util } from "../../Util";

const log = Logging.get("PgDatstore");

export interface PgDataStoreOpts {
    min: number;
    max: number;
}

const RoomTypeToTable = {
    "im": "im_rooms",
    "group": "group_rooms",
    "user-admin": "admin_rooms",
};

const TableToRoomType = {
    im_rooms: "im",
    group_rooms: "group",
    admin_rooms: "user-admin",
};

export class PgDataStore implements IStore {
    public static LATEST_SCHEMA = 2;

    private static BuildUpsertStatement(table: string, constraint: string, keyNames: string[]): string {
        const keys = keyNames.join(", ");
        const keysValues = `\$${keyNames.map((k, i) => i + 1).join(", $")}`;
        const keysSets = keyNames.map((k, i) => `${k} = \$${i + 1}`).join(", ");
        const statement = `INSERT INTO ${table} (${keys}) VALUES (${keysValues}) ON CONFLICT ${constraint} DO UPDATE SET ${keysSets}`;
        return statement;
    }
    private pgPool: Pool;
    private hasEnded: boolean = false;

    constructor(config: IConfigDatastore) {
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
        process.on("beforeExit", (e) => {
            if (this.hasEnded) {
                return;
            }
            // Ensure we clean up on exit
            this.pgPool.end();
        });
    }

    public async getMatrixUser(id: string) {
        // getMatrixUser and setMatrixUser are used to store caches of the ghost's profile
        const res = await this.pgPool.query(
            "SELECT displayname, avatar_url FROM ghost_cache WHERE user_id = $1 LIMIT 1", [ id ]);
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
        const statement = PgDataStore.BuildUpsertStatement("ghost_cache", "(user_id)", Object.keys(props));
        await this.pgPool.query(statement, Object.values(props));
    }

    public async getMatrixUserForAccount(account: IAccountMinimal): Promise<MatrixUser|null> {
        log.info("Getting matrix user for ", account);
        const res = await this.pgPool.query(
            "SELECT user_id FROM accounts WHERE protocol_id = $1 AND username = $2 LIMIT 1",
            [ account.protocol_id, account.username ],
        );
        if (!res.rowCount) {
            return null;
        }
        return new MatrixUser(res.rows[0].user_id);
    }

    public async getRemoteUserBySender(sender: string, protocol: BifrostProtocol): Promise<BifrostRemoteUser | null> {
        // Get a user by sender + profile combo.
        const res = await this.pgPool.query(
            "SELECT * FROM remote_users WHERE protocol_id = $1 AND sender_name = $2 LIMIT 1",
            [ protocol.id, sender ],
        );
        if (!res.rowCount) {
            return null;
        }
        const row = res.rows[0];
        return new BifrostRemoteUser(
            Util.createRemoteId(protocol.id, sender),
            sender,
            protocol.id,
            row.is_ghost,
            row.displayname,
            row.extra_data,
        );
    }

    public async getRemoteUsersFromMxId(userId: string): Promise<BifrostRemoteUser[]> {
        const res = await this.pgPool.query(
            "SELECT * FROM remote_users WHERE user_id = $1",
            [ userId ],
        );
        return res.rows.map((row) => new BifrostRemoteUser(
            Util.createRemoteId(row.protocol_id, row.sender_name),
            row.sender_name,
            row.protocol_id,
            true,
            row.displayname,
            row.extra_data,
        ));
    }

    public async getAccountsForMatrixUser(userId: string, protocolId: string): Promise<BifrostRemoteUser[]> {
        const res = await this.pgPool.query(
            "SELECT * FROM accounts WHERE user_id = $1",
            [ userId ],
        );
        return res.rows.map((row) => new BifrostRemoteUser(
            Util.createRemoteId(row.protocol_id, row.username),
            row.username,
            row.protocol_id,
            false,
            "",
            row.extra_data,
        ));
    }

    public async getRoomByRemoteData(remoteData: IRemoteGroupData): Promise<RoomBridgeStoreEntry|null> {
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
        const statement = `SELECT * FROM group_rooms WHERE ${parts.join(" AND ")};`;
        const res = await this.pgPool.query(
            statement,
            Object.values(remoteData),
        );
        if (res.rowCount === 0) {
            return null;
        }
        const row = res.rows[0];
        const remoteGroupData: IRemoteGroupData = {
            gateway: row.gateway,
            properties: row.properties,
            room_name: row.room_name,
        };
        return {
            matrix: new MatrixRoom(row.room_id, { extras: { type: "group" } }),
            // Id is not used.
            remote: new RemoteRoom("", remoteGroupData as Record<string,unknown>),
            data: {}
        };
    }

    public async getAdminRoom(matrixUserId: string): Promise<RoomBridgeStoreEntry | null> {
        const res = await this.pgPool.query(
            "SELECT room_id FROM admin_rooms WHERE user_id = $1",
            [ matrixUserId ],
        );
        if (res.rowCount === 0) {
            return null;
        }
        const row = res.rows[0];
        return {
            matrix: new MatrixRoom(row.room_id, { extras: { type: MROOM_TYPE_UADMIN } }),
            remote: new RemoteRoom("", {
                matrixUser: matrixUserId,
            }),
            data: {}
        };
    }

    public async getIMRoom(matrixUserId: string, protocolId: string, remoteUserId: string): Promise<RoomBridgeStoreEntry|null> {
        const res = await this.pgPool.query(
            "SELECT room_id FROM im_rooms WHERE user_id = $1 AND remote_id = $2 AND protocol_id = $3",
            [ matrixUserId, remoteUserId, protocolId ],
        );
        if (res.rowCount === 0) {
            return null;
        }
        const row = res.rows[0];
        return {
            matrix: new MatrixRoom(row.room_id, { extras: { type: MROOM_TYPE_IM } }),
            remote: new RemoteRoom("", {
                matrixUser: matrixUserId,
                protocol_id: protocolId,
                recipient: remoteUserId,
            }),
            data: {}
        };
    }

    public async getUsernameMxidForProtocol(protocol: BifrostProtocol): Promise<{ [mxid: string]: string; }> {
        const res = await this.pgPool.query(
            "SELECT user_id, username FROM accounts WHERE protocol_id = $1",
            [ protocol.id ],
        );
        const users: { [mxid: string]: string; } = {};
        res.rows.forEach((row) => {
            users[row.user_id] = row.username;
        });
        return users;
    }

    public async getRoomsOfType(type: MROOM_TYPES): Promise<RoomBridgeStoreEntry[]> {
        const tableName = RoomTypeToTable[type];
        if (!tableName) {
            throw Error("Room was of unknown type!");
        }
        const res = await this.pgPool.query(`SELECT * FROM ${tableName};`);
        return res.rows.map((row) => {
            let remoteData: IRemoteRoomData;
            if (type === "group") {
                remoteData = {
                    gateway: row.gateway,
                    room_name: row.room_name,
                    protocol_id: row.protocol_id,
                    properties: row.properties,
                } as IRemoteGroupData;
            } else if (type === "im") {
                remoteData = {
                    matrixUser: new MatrixUser(row.user_id).userId,
                    recipient: row.remote_id,
                    protocol_id: row.protocol_id,
                } as IRemoteImData;
            } else if (type === "user-admin") {
                remoteData = {
                    matrixUser: new MatrixUser(row.user_id).userId,
                } as IRemoteUserAdminData;
            }
            return {
                matrix: new MatrixRoom(row.room_id, { extras: { type } }),
                // Id is not used.
                remote: new RemoteRoom("", remoteData as Record<string, unknown>),
                data: {}
            };
        });
    }

    public async storeAccount(userId: string, protocol: BifrostProtocol, username: string, extraData?: any) {
        log.debug("Storing account ", userId);
        const acctProps = {
            user_id: userId,
            protocol_id: protocol.id,
            username,
            extra_data: "{}",
        };
        if (extraData) {
            acctProps.extra_data = JSON.stringify(extraData) ;
        }
        const statement = PgDataStore.BuildUpsertStatement(
            "accounts", "ON CONSTRAINT cons_accounts_unique", Object.keys(acctProps),
        );
        await this.pgPool.query(statement, Object.values(acctProps));
        log.debug("Stored account ", userId);
    }

    public async storeGhost(
        userId: string, protocol: BifrostProtocol, username: string, extraData?: any,
    ): Promise<{remote: BifrostRemoteUser, matrix: MatrixUser}> {
        const acctProps = {
            user_id: userId,
            sender_name: username,
            protocol_id: protocol.id,
            extra_data: "{}",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
        if (extraData) {
            acctProps.extra_data = JSON.stringify(extraData) ;
        }
        const statement = PgDataStore.BuildUpsertStatement("remote_users", "(user_id)", Object.keys(acctProps));
        await this.pgPool.query(statement, Object.values(acctProps));
        return {
            matrix: new MatrixUser(userId),
            remote: new BifrostRemoteUser(userId, username, protocol.id, true),
        };
    }

    public async removeRoomByRoomId(matrixId: string) {
        await this.pgPool.query(
            "DELETE FROM rooms WHERE room_id = $1",
            [ matrixId ],
        );
    }

    public async getRoomEntryByMatrixId(roomId: string): Promise<RoomBridgeStoreEntry | null> {
        log.debug("Getting room", roomId);
        const typeRes = await this.pgPool.query(
            "SELECT tableoid::regclass as table_name FROM rooms WHERE room_id = $1 LIMIT 1",
            [ roomId ],
        );
        if (!typeRes.rowCount) {
            log.debug("No rooms found");
            return null;
        }
        const tableName = typeRes.rows[0].table_name;
        const type = TableToRoomType[tableName];
        const res = await this.pgPool.query(
            `SELECT * FROM ${tableName} WHERE room_id = $1 LIMIT 1`,
            [ roomId ],
        );
        if (!res.rowCount) {
            throw Error("Missing data for room that we did manage to select!");
        }
        const row = res.rows[0];
        let remoteData: IRemoteRoomData;
        if (type === "group") {
            remoteData = {
                gateway: row.gateway,
                room_name: row.room_name,
                protocol_id: row.protocol_id,
                properties: row.properties,
            } as IRemoteGroupData;
        } else if (type === "im") {
            remoteData = {
                matrixUser: new MatrixUser(row.user_id).userId,
                recipient: row.remote_id,
                protocol_id: row.protocol_id,
            } as IRemoteImData;
        } else if (type === "user-admin") {
            remoteData = {
                matrixUser: new MatrixUser(row.user_id).userId,
            } as IRemoteUserAdminData;
        } else {
            throw Error("Room was of unknown type!");
        }
        log.debug("Found room ", JSON.stringify(remoteData));
        return {
            remote: new RemoteRoom("", remoteData as Record<string, unknown>),
            matrix: new MatrixRoom(roomId, { extras: { type }}),
            data: {}
        };
    }

    public async storeRoom(matrixId: string, type: MROOM_TYPES, remoteId: string, remoteData: IRemoteRoomData)
        : Promise<RoomBridgeStoreEntry> {
        log.debug("Storing room", matrixId);
        let statement: string;
        const res = {
            remote: new RemoteRoom(remoteId, remoteData as Record<string, unknown>),
            matrix: new MatrixRoom(matrixId, { extras: { type } }),
            data: {}
        };

        if (type === "user-admin") {
            const adminProps = {
                room_id: matrixId,
                user_id: (remoteData as IRemoteUserAdminData).matrixUser,
            };
            statement = PgDataStore.BuildUpsertStatement("admin_rooms", "(user_id)", Object.keys(adminProps));
            await this.pgPool.query(statement, Object.values(adminProps));
            return res;
        }

        if (type === "im") {
            const imData = (remoteData as IRemoteImData);
            const imProps = {
                room_id: matrixId,
                user_id: imData.matrixUser,
                remote_id: imData.recipient,
                protocol_id: imData.protocol_id,
            };
            statement = PgDataStore.BuildUpsertStatement("im_rooms", "(room_id)", Object.keys(imProps));
            await this.pgPool.query(statement, Object.values(imProps));
            return res;
        }

        const props = {
            room_id: matrixId,
            protocol_id: remoteData.protocol_id || "",
            room_name: "",
            gateway: false,
            properties: "{}",
        };
        const groupData = remoteData as IRemoteGroupData;
        props.gateway = groupData.gateway || false;
        props.room_name = groupData.room_name || "";
        props.properties = JSON.stringify(groupData.properties);
        statement = PgDataStore.BuildUpsertStatement(
            "group_rooms", "(room_id)", Object.keys(props),
        );
        await this.pgPool.query(statement, Object.values(props));
        log.debug("Stored room", matrixId);
        return res;
    }

    public async getMatrixEventId(roomId: string, remoteEventId: string) {
        const ev = await this.pgPool.query(
            "SELECT matrix_id FROM events WHERE room_id = $1 AND remote_id = $2", [roomId, remoteEventId],
        );
        if (ev.rowCount) {
            return ev.rows[0].matrix_id;
        }
        return null;
    }

    public async getRemoteEventId(roomId: string, matrixEventId: string) {
        const ev = await this.pgPool.query(
            "SELECT matrix_id FROM events WHERE room_id = $1 AND matrix_id = $2", [roomId, matrixEventId],
        );
        if (ev.rowCount) {
            return ev.rows[0].remote_id;
        }
        return null;
    }

    public async storeRoomEvent(roomId: string, matrixEventId: string, remoteEventId: string) {
        await this.pgPool.query("INSERT INTO events VALUES ($1, $2, $3)", [roomId, matrixEventId, remoteEventId]);
    }

    public async integrityCheck(canWrite: boolean): Promise<void> {
        /* We don't need to do this for postgresql */
    }

    public async ensureSchema() {
        log.info("Starting postgres database engine");
        let currentVersion = await this.getSchemaVersion();
        while (currentVersion < PgDataStore.LATEST_SCHEMA) {
            log.info(`Updating schema to v${currentVersion + 1}`);
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const runSchema = require(`./schema/v${currentVersion + 1}`).runSchema;
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
        await this.pgPool.query("UPDATE schema SET version = $1;", [version]);
    }

    private async getSchemaVersion(): Promise<number> {
        log.debug("Fetching schema version");
        try {
            const { rows } = await this.pgPool.query("SELECT version FROM SCHEMA");
            return rows[0].version;
        } catch (ex) {
            if (ex.code === "42P01") { // undefined_table
                log.warn("Schema table could not be found");
                return 0;
            }
            log.error("Failed to get schema version: %s", ex);
        }
        throw Error("Couldn't fetch schema version");
    }
}
