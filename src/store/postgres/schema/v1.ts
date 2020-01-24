import { PoolClient } from "pg";

export async function runSchema(connection: PoolClient) {
    // Create schema
    await connection.query(`
        CREATE TABLE schema (
            version	INTEGER UNIQUE NOT NULL
        );

        INSERT INTO schema VALUES (0);

        CREATE TABLE rooms (
            room_id TEXT
        );

        CREATE TABLE group_rooms (
            room_id TEXT UNIQUE NOT NULL,
            protocol_id TEXT NULL,
            room_name TEXT,
            gateway BOOLEAN,
            properties JSONB
        ) INHERITS (rooms);

        CREATE TABLE im_rooms (
            room_id TEXT UNIQUE NOT NULL,
            user_id TEXT NOT NULL,
            remote_id TEXT NOT NULL,
            protocol_id TEXT NOT NULL
        ) INHERITS (rooms);


        CREATE TABLE admin_rooms (
            room_id TEXT UNIQUE NOT NULL,
            user_id TEXT
        ) INHERITS (rooms);

        CREATE TABLE accounts (
            user_id TEXT NOT NULL,
            protocol_id TEXT NOT NULL,
            username TEXT NOT NULL,
            extra_data JSONB,
            CONSTRAINT cons_accounts_unique UNIQUE(user_id, protocol_id, username),
            CONSTRAINT cons_accounts_protousername_unique UNIQUE(protocol_id, username)
        );

        CREATE TABLE ghost_cache (
            user_id TEXT UNIQUE NOT NULL,
            displayname TEXT,
            avatar_url TEXT
        );

        CREATE TABLE remote_users (
            user_id TEXT UNIQUE NOT NULL,
            sender_name TEXT,
            protocol_id TEXT,
            extra_data JSONB
        );
    `);
}
