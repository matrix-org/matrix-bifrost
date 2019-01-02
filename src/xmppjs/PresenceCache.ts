import * as jid from "@xmpp/jid";
import * as xml from "@xmpp/xml";

export interface IPresenceDelta {
    status?: IPresenceStatus;
    changed: string[];
    isSelf: boolean;
}

export interface IPresenceStatus {
    resource: string;
    online: boolean;
    status: string;
    affiliation: string;
    role: string;
}

/**
 * This class holds presence for XMPP users across MUCs and
 * determines deltas.
 */
export class PresenceCache {
    private roomPresence: {[roomId: string]: Map<string, IPresenceStatus>};

    constructor() {
        this.roomPresence = {};
    }
    public add(stanza: xml.Element): IPresenceDelta|undefined {
        if (stanza.getChild("error")) {
            return;
        }
        const type = stanza.getAttr("type")!;
        const from = jid(stanza.getAttr("from"));
        const roomId = `${from.local}@${from.domain}`;

        let roomPresence: Map<string, IPresenceStatus>;
        if (!this.roomPresence[roomId]) {
            roomPresence = this.roomPresence[roomId] = new Map();
        } else {
            roomPresence = this.roomPresence[roomId];
        }
        if (!from.resource) {
            // Not sure how to handle presence without a resource.
            return;
        }
        const mucUser = stanza.getChild("x", "http://jabber.org/protocol/muc#user");
        const isSelf = !!(mucUser && mucUser.getChildByAttr("code", "110"));
        const newUser = !roomPresence.get(from.resource);
        const currentPresence = roomPresence.get(from.resource) || {
            resource: from.resource,
            status: "",
            affiliation: "",
            role: "",
            online: false,
        } as IPresenceStatus;
        const delta: IPresenceDelta = {changed: [], isSelf};
        if (newUser) {
            delta.changed.push("new");
        }
        if (mucUser && mucUser.getChild("item")) {
            const affiliation = mucUser.getChild("item")!.getAttr("affiliation");
            const role = mucUser.getChild("item")!.getAttr("role");

            if (affiliation !== currentPresence.affiliation) {
                delta.changed.push("affiliation");
            }

            if (role !== currentPresence.role) {
                delta.changed.push("role");
            }

            currentPresence.affiliation = affiliation;
            currentPresence.role = role;
        }
        if (type === "unavailable") {
            if (currentPresence.online) {
                currentPresence.online = false;
                currentPresence.status = stanza.getChildText("status") || "";
                delta.status = currentPresence;
                delta.changed.push("offline");
            }
        } else if (!currentPresence.online) {
            delta.changed.push("online");
            currentPresence.online = true;
            delta.status = currentPresence;
        }

        if (delta.status) {
            roomPresence.set(from.resource, currentPresence);
        }
        return delta;
    }

    public getStatus(userJid: string) {

    }

    public getProfile(userJid: string) {

    }
}
