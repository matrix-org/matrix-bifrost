import { PoolClient } from "pg";

export async function runSchema(connection: PoolClient) {
    // Create schema
    await connection.query(`CREATE TABLE events (
        room_id TEXT NOT NULL,
        matrix_id TEXT NOT NULL,
        remote_id TEXT NOT NULL,
        CONSTRAINT cons_mxev_unique UNIQUE(matrix_id, room_id),
        CONSTRAINT cons_rmev_unique UNIQUE(remote_id, room_id)
    )`);
}
