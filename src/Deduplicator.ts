import { Logging } from "matrix-appservice-bridge";
import leven from "leven";
const log = Logging.get("Deduplicator");

const LEVEN_THRESHOLD = 0.1;

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

export class Deduplicator {
    public static hashMessage(roomName: string, sender: string, body: string): string {
        return `${sender}/${roomName}/${body}`;
    }

    private expectedMessages: string[];
    private usersInRoom: {[roomName: string]: number};
    private chosenOnes: Map<string, string>;
    private waitJoinList: Map<string, () => void>;

    constructor() {
        this.expectedMessages = [];
        this.usersInRoom = {};
        this.chosenOnes = new Map();
        this.waitJoinList = new Map();
    }

    public waitForJoinResolve(roomId: string, userId: string) {
        if (this.waitJoinList.has(`${roomId}:${userId}`)) {
            this.waitJoinList.get(`${roomId}:${userId}`)!();
        }
    }

    public waitForJoin(roomId: string, userId: string, timeoutMs: number = 60000) {
        log.debug(`Waiting for ${userId} to join ${roomId}..`);
        let timeout: NodeJS.Timeout;
        return new Promise<void>((resolve, reject) => {
            this.waitJoinList.set(`${roomId}:${userId}`, resolve);
            timeout = setTimeout(() => reject("Wait for join timeout expired"), timeoutMs);
        }).then(() => {
            clearTimeout(timeout);
        });
    }

    public isTheChosenOneForRoom(roomName: string, remoteId: string) {
        const one = this.chosenOnes.get(roomName);
        if (one === undefined) {
            log.debug("Assigning a new chosen one for", roomName);
            this.chosenOnes.set(roomName, remoteId);
            return true;
        }
        return one === remoteId;
    }

    public removeChosenOne(roomName: string, remoteId: string) {
        if (this.chosenOnes.get(roomName) === remoteId) {
            this.chosenOnes.delete(roomName);
        }
    }

    public removeChosenOneFromAllRooms(theone: string) {
        this.chosenOnes.forEach((acct, key) => {
            if (acct === theone) {
                this.chosenOnes.delete(key);
            }
        });
    }

    public incrementRoomUsers(roomName: string) {
        log.debug("adding a user to ", roomName);
        this.usersInRoom[roomName] = (this.usersInRoom[roomName] || 0) + 1;
    }

    public decrementRoomUsers(roomName: string) {
        log.debug("removing a user from ", roomName);
        this.usersInRoom[roomName] = Math.max(0, (this.usersInRoom[roomName] || 0) - 1);
    }

    public insertMessage(roomName: string, sender: string, body: string) {
        const h = Deduplicator.hashMessage(roomName, sender, body);
        const toAdd = this.usersInRoom[roomName];
        log.debug(`Inserted ${toAdd} hash(es) for (${sender}/${roomName}/${body}):`, h);
        for (let i = 0; i < toAdd; i++) {
            this.expectedMessages.push(h);
        }
    }

    public checkAndRemove(roomName: string, sender: string, body: string) {
        const h = Deduplicator.hashMessage(roomName, sender, body);
        const start = `${sender}/${roomName}/`;
        const index = this.expectedMessages.findIndex((hash) => {
            if (!hash.startsWith(start)) {
                return false;
            }
            hash = hash.substr(start.length);
            const l = leven(hash, body) / hash.length;
            return l <= LEVEN_THRESHOLD;
        });
        if (index !== -1) {
            this.expectedMessages.splice(index, 1);
            return true;
        }
        return false;
    }

}
