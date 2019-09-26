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
import { MatrixRoom, RemoteRoom, MatrixUser, Logging } from "matrix-appservice-bridge";
import { IRemoteRoomData, IRemoteGroupData, IRoomEntry, MROOM_TYPES, MUSER_TYPES } from "../Types";
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

export class PgDataStore implements IStore {
    public static LATEST_SCHEMA = 1;

    private static BuildUpsertStatement(table: string, constraint: string, keyNames: string[]): string {
        const keys = keyNames.join(", ");
        const keysValues = `\$${keyNames.map((k, i) => i + 1).join(", $")}`;
        const keysSets = keyNames.map((k, i) => `${k} = \$${i + 1}`).join(", ");
        // tslint:disable-next-line: max-line-length
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

    public async getMatrixUserForAccount(account: IAccountMinimal): Promise<MatrixUser> {
        // This is used for real matrix users
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
            [ sender, protocol.id ],
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

    public getRemoteUsersFromMxId(userId: string): Promise<BifrostRemoteUser[]> {
        throw new Error("Method not implemented.");
    }

    public async getRoomByRemoteData(remoteData: IRemoteGroupData): Promise<IRoomEntry|null> {
        let statement = "SELECT * FROM rooms WHERE";
        let i = 0;
        for (const key of Object.keys(remoteData)) {
            i++;
            statement += ` ${key} = \$${i}`;
        }
        if (i === 0) {
            throw Error("No remoteData to compare with");
        }
        const res = await this.pgPool.query(statement, Object.values(remoteData));
        if (res.rowCount === 0) {
            return null;
        }
        const row = res.rows[0];
        return {
            matrix: new MatrixRoom(row.room_id),
            // Id is not used.
            remote: new RemoteRoom("", {
                gateway: row.gateway,
                properties: row.properties,
                type: "group",
                room_name: row.room_name,
            } as IRemoteGroupData),
        };
    }

    public async getRoomByRoomId(roomId: string): Promise<IRoomEntry|null> {
        const res = await this.pgPool.query("SELECT * FROM rooms WHERE room_id = $1", [ roomId ]);
        if (res.rowCount === 0) {
            return null;
        }
        const row = res.rows[0];
        return {
            matrix: new MatrixRoom(roomId),
            // Id is not used.
            remote: new RemoteRoom("", {
                gateway: row.gateway,
                properties: row.properties,
                type: row.type,
                room_name: row.room_name,
            } as IRemoteGroupData),
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

    public async getRoomsOfType(type: MROOM_TYPES): Promise<IRoomEntry[]> {
        const res = await this.pgPool.query("SELECT * FROM rooms WHERE type = $1", [ type ]);
        return res.rows.map((row) => ({
            matrix: new MatrixRoom(row.room_id),
            // Id is not used.
            remote: new RemoteRoom("", {
                gateway: row.gateway,
                properties: row.properties,
                type: "group",
                room_name: row.room_name,
            } as IRemoteGroupData),
        }));
    }

    public storeUser(userId: string, protocol: BifrostProtocol, username: string, type: MUSER_TYPES, extraData?: any)
    : Promise<{remote: BifrostRemoteUser, matrix: MatrixUser}> {
        throw new Error("Method not implemented.");
    }

    public async removeRoomByRoomId(matrixId: string) {
        await this.pgPool.query(
            "DELETE FROM rooms WHERE room_id = $1",
            [ matrixId ],
        );
    }

    public async getRoomEntryByMatrixId(roomId: string): Promise<IRoomEntry | null> {
        const res = await this.pgPool.query(
            "SELECT * FROM rooms WHERE room_id = $1 LIMIT 1",
            [ matrixId ],
        );
    }

    public storeRoom(matrixId: string, type: MROOM_TYPES, remoteId: string, remoteData: IRemoteRoomData)
    : Promise<{remote: RemoteRoom, matrix: MatrixRoom}> {

        throw new Error("Method not implemented.");
    }

    public async integrityCheck(canWrite: boolean): Promise<void> {
        /* We don't need to do this for postgresql */
    }

    public async ensureSchema() {
        log.info("Starting postgres database engine");
        let currentVersion = await this.getSchemaVersion();
        while (currentVersion < PgDataStore.LATEST_SCHEMA) {
            log.info(`Updating schema to v${currentVersion + 1}`);
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
