import { PoolClient } from "pg";

export async function runSchema(connection: PoolClient) {
    // Create schema
    await connection.query(`
        CREATE TABLE rooms (
            room_id TEXT UNIQUE NOT NULL,
            type TEXT NOT NULL,
            room_name TEXT,
            gateway BOOLEAN,
            properties JSONB,
        );

        CREATE TABLE accounts (
            user_id TEXT NOT NULL,
            protocol_id TEXT NOT NULL,
            username TEXT,
            CONSTRAINT cons_accounts_unique UNIQUE(user_id, protocol_id, username)
            CONSTRAINT cons_accounts_protousername_unique UNIQUE(protocol_id, username)
        );

        CREATE TABLE admin_rooms (
            room_id TEXT UNIQUE,
            user_id TEXT
        );

        CREATE TABLE ghost_cache (
            user_id TEXT UNIQUE,
            displayname TEXT,
            avatar_url TEXT
        );

        CREATE TABLE remote_users (
            user_id TEXT UNIQUE,
            is_ghost BOOLEAN,
            sender_name TEXT,
            protocol_id TEXT,
            displayname TEXT,
            extra_data JSONB,

        );
    `);
}
