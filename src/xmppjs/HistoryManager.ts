import { Element } from "@xmpp/xml";
import { JID } from "@xmpp/jid";

export interface IHistoryLimits {
    maxchars?: number,
    maxstanzas?: number,
    seconds?: number,
    since?: Date,
}

/**
 * Abstraction of a history storage backend.
 */
interface IHistoryStorage {
    // add a message to the history of a given room
    addMessage: (chatName: string, message: Element, jid: JID) => unknown;
    // get the history of a room.  The storage should apply the limits that it
    // wishes too, and remove the limits that it applied from the `limits`
    // parameter.  The returned list of Elements must include the Delayed
    // Delivery information.
    getHistory: (chatName: string, limits: IHistoryLimits) => Promise<Element[]>;
}

/**
 * Store room history in memory.
 */
export class MemoryStorage implements IHistoryStorage {
    private history: Map<string, Element[]>;
    constructor(public maxHistory: number) {
        this.history = new Map();
    }

    addMessage(chatName: string, message: Element, jid: JID): void {
        if (!this.history.has(chatName)) {
            this.history.set(chatName, []);
        }
        const currRoomHistory = this.history.get(chatName);

        // shallow-copy the message, and add the timestamp
        const copiedMessage = new Element(message.name, message.attrs);
        copiedMessage.append(message.children as Element[]);
        copiedMessage.attr("from", jid.toString());
        copiedMessage.append(new Element("delay", {
            xmlns: "urn:xmpp:delay",
            from: chatName,
            stamp: (new Date()).toISOString(),
        }));

        currRoomHistory.push(copiedMessage);

        while (currRoomHistory.length > this.maxHistory) {
            currRoomHistory.shift();
        }
    }

    async getHistory(chatName: string, limits: IHistoryLimits): Promise<Element[]> {
        return this.history.get(chatName) || [];
    }
}

// TODO: make a class that stores in PostgreSQL so that we don't lose history
// when we restart

/**
 * Manage room history for a MUC
 */
export class HistoryManager {
    constructor(
        private storage: IHistoryStorage,
    ) {}

    addMessage(chatName: string, message: Element, jid: JID): unknown {
        return this.storage.addMessage(chatName, message, jid);
    }

    async getHistory(chatName: string, limits: IHistoryLimits): Promise<Element[]> {
        if (limits.seconds) {
            const since = new Date(Date.now() - limits.seconds * 1000);
            if (limits.since === undefined || limits.since < since) {
                limits.since = since;
            }
            delete limits.seconds;
        }
        let history: Element[] = await this.storage.getHistory(chatName, limits);

        // index of the first history element that we will keep after applying
        // the limits
        let idx = 0;

        if ("maxstanzas" in limits && history.length > limits.maxstanzas) {
            idx = history.length - limits.maxstanzas;
        }

        if ("since" in limits) {
            // FIXME: binary search would be better than linear search
            for (; idx < history.length; idx++) {
                try {
                    const ts = history[idx].getChild("delay", "urn:xmpp:delay")?.attr("stamp");
                    if (new Date(ts) >= limits.since) {
                        break;
                    }
                } catch {}
            }
        }

        if ("maxchars" in limits) {
            let numChars = 0;
            let i = history.length;
            for (; i > idx && numChars < limits.maxchars; i--) {
                numChars += history[i - 1].toString().length;
            }
            idx = i;
        }

        if (idx > 0) {
            history = history.slice(idx);
        }

        return history;
    }
}
