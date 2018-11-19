/**
 * This is another bodge class to determine whether messages are duplicates in the UI.
 * Simply put, Pidgin is designed as a client-side app so that messages will usuaully
 * arrive on one connection, and messages sent from the app will only be displayed
 * when recieved down-the-line.
 *
 * However we are a bridge and must try out best to filter out messages coming from
 * us. Since we don't have any IDs and can't really make use of the matrix-appservice-irc
 * system of "the chosen one" (as our own messages get echoed back to us), we have to hash
 * the sent message with the room name and check it against a table.
 */

import * as crypto from "crypto";
import { Logging } from "matrix-appservice-bridge";
const log = Logging.get("MatrixEventHandler");

export class Deduplicator {
    public static hashMessage(roomName: string, sender: string, body: string): string {
        const hash = crypto.createHash("MD5");
        hash.update(`${sender}/${roomName}/${body}`);
        return hash.digest("hex");
    }

    private expectedMessages: string[];
    private usersInRoom: {[roomName: string]: number};

    constructor() {
        this.expectedMessages = [];
        this.usersInRoom = {};
    }

    public incrementRoomUsers(roomName: string) {
        this.usersInRoom[roomName] = (this.usersInRoom[roomName] || 0) + 1;
    }

    public decrementRoomUsers(roomName: string) {
        this.usersInRoom[roomName] = Math.max(0, (this.usersInRoom[roomName] || 0) - 1);
    }

    public insertMessage(roomName: string, sender: string, body: string) {
        const h = Deduplicator.hashMessage(roomName, sender, body);
        log.debug(`Inserted new hash for (${sender}/${roomName}/${body}):`, h);
        for (let i = 0; i < this.usersInRoom[roomName]; i++) {
            this.expectedMessages.push(h);
        }
    }

    public checkAndRemove(roomName: string, sender: string, body: string) {
        const h = Deduplicator.hashMessage(roomName, sender, body);
        log.debug(`Checking for hash (${sender}/${roomName}/${body}):`, h);
        const index = this.expectedMessages.indexOf(h);
        if (index !== -1) {
            this.expectedMessages.splice(index, 1);
            return true;
        }
        return false;
    }

}
