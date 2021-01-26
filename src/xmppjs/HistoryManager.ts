import { Element } from "@xmpp/xml";
import { JID } from "@xmpp/jid";

export interface IHistoryLimits {
    maxChars?: number | undefined,
    maxStanzas?: number | undefined,
    seconds?: number | undefined,
    since?: Date | undefined,
}

/**
 * Abstraction of a history storage backend.
 */
interface IHistoryStorage {
    // add a message to the history of a given room
    addMessage: (chatName: string, message: Element, jid: JID) => Promise<void>;
    // get the history of a room.  The storage should apply the limits that it
    // wishes too, and remove the limits that it applied from the `limits`
    // parameter.  The returned list of Elements must include the Delayed
    // Delivery information.
    getHistory: (chatName: string, limits: IHistoryLimits) => Promise<Element[]>;
}

// pad a number to be two digits long
function pad2(n: number) {
    return n < 10 ? "0" + n.toString() : n.toString();
}

/**
 * Store room history in memory.
 */
export class MemoryStorage implements IHistoryStorage {
    private history: Map<string, Element[]>;
    constructor(public maxHistory: number) {
        this.history = new Map();
    }

    async addMessage(chatName: string, message: Element, jid: JID): Promise<void> {
        if (!this.history.has(chatName)) {
            this.history.set(chatName, []);
        }
        const currRoomHistory = this.history.get(chatName);

        // shallow-copy the message, and add the timestamp
        const copiedMessage = new Element(message.name, message.attrs);
        copiedMessage.append(message.children as Element[]);
        copiedMessage.attr("from", jid.toString());
        const now = new Date();
        copiedMessage.append(new Element("delay", {
            xmlns: "urn:xmpp:delay",
            from: chatName,
            // based on the polyfill at
            // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString
            stamp: now.getUTCFullYear() +
                "-" + pad2(now.getUTCMonth() + 1) +
                "-" + pad2(now.getUTCDate()) +
                "T" + pad2(now.getUTCHours()) +
                ":" + pad2(now.getUTCMinutes()) +
                ":" + pad2(now.getUTCSeconds()) + "Z",
        }));

        currRoomHistory.push(copiedMessage);

        while (currRoomHistory.length > this.maxHistory) {
            currRoomHistory.shift();
        }
    }

    async getHistory(chatName: string, limits: IHistoryLimits) {
        return this.history.get(chatName) || [];
    }
}

/**
 * Manage room history for a MUC
 */
export class HistoryManager {
    constructor(
        private storage: IHistoryStorage,
    ) {}

    async addMessage(chatName: string, message: Element, jid: JID): Promise<void> {
        console.log("adding message for room", chatName, message, jid);
        return this.storage.addMessage(chatName, message, jid);
    }

    async getHistory(chatName: string, limits: IHistoryLimits): Promise<Element[]> {
        console.log("getting messages for room", chatName);
        if (limits.seconds) {
            const since = new Date(Date.now() - limits.seconds * 1000);
            if (limits.since === undefined || limits.since < since) {
                limits.since = since;
            }
            delete limits.seconds;
        }
        let history: Element[] = await this.storage.getHistory(chatName, limits);

        if ("maxStanzas" in limits && history.length > limits.maxStanzas) {
            history = history.slice(-limits.maxStanzas);
        }
        // FIXME: filter by since, maxchars
        console.log(history);
        return history;
    }
}
