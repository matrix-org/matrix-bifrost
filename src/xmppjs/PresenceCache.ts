import * as xml from "@xmpp/xml";
import * as jid from "@xmpp/jid";
import { Logging } from "matrix-appservice-bridge";

const log = Logging.get("PresenceCache");

export interface IPresenceDelta {
    status?: IPresenceStatus;
    changed: string[];
    isSelf: boolean;
    error: "conflict"|"other"|null;
    errorMsg: string|null;
}

export interface IPresenceStatus {
    resource: string;
    online: boolean;
    kick: {
        reason: string | null;
        kicker: string | null;
    } | undefined;
    status: string;
    affiliation: string;
    role: string;
    ours: boolean;
    photoId: string|undefined;
}

/**
 * This class holds presence for XMPP users across MUCs and
 * determines deltas.
 */
export class PresenceCache {
    private presence: Map<string, IPresenceStatus>;

    constructor() {
        this.presence = new Map();
    }

    public clear() {
        this.presence.clear();
    }

    public getStatus(userJid: string): IPresenceStatus|undefined {
        const exactMatch = this.presence.get(userJid);
        if (exactMatch) {
            return exactMatch;
        }
        for (const k of this.presence.keys()) {
            if (k.startsWith(userJid)) {
                return this.presence.get(k);
            }
        }
    }

    public modifyStatus(userJid: string, status: IPresenceStatus) {
        this.presence.set(userJid, status);
    }

    public add(stanza: xml.Element): IPresenceDelta|undefined {
        return this._add(stanza);
    }

    private _add(stanza: xml.Element): IPresenceDelta|undefined {
        const errorElement = stanza.getChild("error");
        if (errorElement) {
            const conflict = errorElement.getChild("conflict");
            if (conflict) {
                return {
                    changed: [],
                    error: "conflict",
                    isSelf: true,
                    errorMsg: null,
                };
            }
            return {
                changed: [],
                error: "other",
                isSelf: false,
                errorMsg: errorElement.toString(),
            };
        }
        const type = stanza.getAttr("type")!;
        const from = jid(stanza.getAttr("from"));

        if (!from.resource) {
            // Not sure how to handle presence without a resource.
            return;
        }
        const mucUser = stanza.getChild("x", "http://jabber.org/protocol/muc#user");
        const isSelf = !!(mucUser && mucUser.getChildByAttr("code", "110"));
        const isKick = !!(mucUser && mucUser.getChildByAttr("code", "307"));
        const isTechnicalRemoval = !!(mucUser && mucUser.getChildByAttr("code", "333"));
        const newUser = !this.presence.get(from.toString());
        const currentPresence = this.presence.get(from.toString()) || {
            resource: from.resource,
            status: "",
            affiliation: "",
            role: "",
            online: false,
            ours: false,
        } as IPresenceStatus;
        const delta: IPresenceDelta = {changed: [], isSelf, error: null, errorMsg: null};

        if (newUser) {
            delta.changed.push("new");
        }

        if (isSelf) {
            currentPresence.ours = true;
            this.presence.set(from.toString(), currentPresence);
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
        } else if (!currentPresence.online || isSelf) {
            delta.changed.push("online");
            currentPresence.online = true;
            delta.status = currentPresence;
        }

        if (isKick) {
            delta.changed.push("kick");
            const item = mucUser!.getChild("item");
            if (item) {
                const actor = item.getChild("actor");
                currentPresence.kick = {
                    kicker: actor ? actor.getAttr("nick") : null,
                    reason: item.getChildText("reason"),
                };
            }
        }

        const vcard = stanza.getChildByAttr("xmlns", "vcard-temp:x:update");
        if (vcard) {
            const photoId = vcard.getChildText("photo") || undefined;
            if (photoId !== currentPresence.photoId) {
                currentPresence.photoId = photoId;
                delta.status = currentPresence;
                delta.changed.push("photo");
            }
        }

        if (delta.status) {
            this.presence.set(from.toString(), currentPresence);
        }
        return delta;
    }
}
