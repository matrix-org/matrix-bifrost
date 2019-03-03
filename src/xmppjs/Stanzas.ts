import * as uuid from "uuid/v4";
import * as he from "he";
import { IBasicProtocolMessage } from "../MessageFormatter";

export interface IStza {
    type: string;
    xml: string;
}

export abstract class StzaBase implements IStza {
    public type!: string;
    public xml!: string;
    private _from: string = "";
    private _to: string = "";
    private _id?: string = "";
    constructor(from: string, to: string, id?: string) {
        this.from = from;
        this.to = to;
        this.id = id;
    }

    get from() { return this._from; }

    set from(val: string) {
        this._from = he.encode(val);
    }

    get to() { return this._to; }

    set to(val: string) {
        this._to = he.encode(val);
    }

    get id(): string|undefined { return this._id || undefined; }

    set id(val: string|undefined) {
        if (!val) { return; }
        this._id = he.encode(val);
    }

}

export class StzaPresence extends StzaBase {
    protected includeXContent: boolean = true;
    constructor(
        from: string,
        to: string,
        id?: string,
        public presenceType?: string,
    ) {
        super(from, to, id);
    }

    get xContent(): string { return ""; }

    get xProtocol(): string { return "muc"; }

    get presenceContent(): string { return ""; }

    get type(): string {
        return "presence";
    }

    get xml(): string {
        const type = this.presenceType ? ` type='${this.presenceType}'` : "";
        const id = this.id ? ` id="${this.id}"` : "";
        let content = "";
        if (this.includeXContent) {
            content = this.xContent ? `<x xmlns='http://jabber.org/protocol/${this.xProtocol}'>${this.xContent}</x>` :
                "<x xmlns='http://jabber.org/protocol/muc'/>";
        }
        return `<presence from="${this.from}" to="${this.to}"${id}${type}>${content}${this.presenceContent}</presence>`;
    }
}

export class StzaPresenceItem extends StzaPresence {
    protected statusCodes: Set<string>;
    constructor(
        from: string,
        to: string,
        id?: string,
        public affiliation: string = "member",
        public role: string = "participant",
        self: boolean = false,
        public jid: string = "",
        itemType: string = "",
    ) {
        super(from, to, id, itemType);
        this.statusCodes = new Set();
        this.self = self;
    }

    set self(isSelf: boolean) {
        this.statusCodes[isSelf ? "add" : "delete"]("110");
    }

    get itemContents(): string { return ""; }

    get xProtocol(): string { return "muc#user"; }

    public get xContent() {
        const statusCodes = [...this.statusCodes].map((s) => `<status code='${s}'/>`).join("");
        const jid = this.jid ? ` jid='${this.jid}'` : "";
        if (this.itemContents) {
return `<item affiliation='${this.affiliation}'${jid} role='${this.role}'>${this.itemContents}</item>${statusCodes}`;
        } else {
            return `<item affiliation='${this.affiliation}'${jid} role='${this.role}'/>${statusCodes}`;
        }
    }
}

export class StzaPresenceError extends StzaPresence {
    constructor(
        from: string,
        to: string,
        id: string,
        public by: string,
        public errType: string,
        public innerError: string,

    ) {
        super(from, to, id, "error");
    }

    public get presenceContent() {
        return `<error type='${this.errType}' by='${this.by}'><${this.innerError}`
             + ` xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error>`;
    }
}

export class StzaPresenceJoin extends StzaPresence {
    constructor(
        from: string,
        to: string,
        id?: string,
        public presenceType?: string,
    ) {
        super(from, to, id);
    }

    public get xContent() {
        // No history.
        // TODO: I'm sure we want to be able to configure this.
        return `<history maxchars='0'/>`;
    }
}

export class StzaPresencePart extends StzaPresence {
    constructor(
        from: string,
        to: string,
    ) {
        super(from, to, undefined, "unavailable");
        this.includeXContent = false;
        this.id = undefined;
    }
}

export class StzaPresenceKick extends StzaPresenceItem {
    constructor(
        from: string,
        to: string,
        public reason: string,
        public actorNick?: string,
        self: boolean = false,
    ) {
        super(from, to, undefined, "none", "none", self, undefined, "unavailable");
        this.statusCodes.add("307");
    }

    get itemContents(): string {
        const actor = this.actorNick ? `<actor nick='${he.encode(this.actorNick)}'/>` : "";
        return `${actor}<reason>${he.encode(this.reason)}</reason>`;
    }

}
export class StzaMessage extends StzaBase {
    public html: string = "";
    public body: string = "";
    public attachments: string[] = [];
    constructor(
        from: string,
        to: string,
        idOrMsg?: string|IBasicProtocolMessage,
        public messageType?: string,
    ) {
        super(from, to, undefined);
        if (idOrMsg && idOrMsg.hasOwnProperty("body")) {
            idOrMsg = idOrMsg as IBasicProtocolMessage;
            this.body = idOrMsg.body;
            if (idOrMsg.formatted) {
                const html = idOrMsg.formatted.find((f) => f.type === "html");
                this.html = html ? html.body : "";
            }
            if (idOrMsg.opts) {
                this.attachments = (idOrMsg.opts.attachments || []).map((a) => a.uri);
            }
            this.id = idOrMsg.id;
        } else if (idOrMsg) {
            this.id = idOrMsg as string;
        }
        this.id = this.id || uuid();
    }

    get type(): string {
        return "message";
    }

    get xml(): string {
        const type = this.messageType ? `type='${this.messageType}'` : "";
        const attachments = this.attachments.map((a) =>
            `<x xmlns='jabber:x:oob'><url>${he.encode(a)}</url></x>`,
        );
        if (this.attachments.length === 1) {
            // For reasons unclear to me, XMPP reccomend we make the body == attachment url to make them show up inline.
            this.body = this.attachments[0];
        }
        return `<message from="${this.from}" to="${this.to}" id="${this.id}" ${type}>`
             + `${this.html}<body>${he.encode(this.body)}</body>${attachments}</message>`;
    }
}

export class StzaMessageSubject extends StzaBase {
    constructor(
        from: string,
        to: string,
        id?: string,
        public subject: string = "",
    ) {
        super(from, to, id);
    }

    get content(): string { return ""; }

    get type(): string {
        return "message";
    }

    get xml(): string {
        return `<message from="${this.from}" to="${this.to}" id="${this.id}" type='groupchat'>`
             + `<subject>${this.subject}</subject></message>`;
    }
}

export class StzaIqPing extends StzaBase {
    constructor(
        from: string,
        to: string,
        id: string,
    ) {
        super(from, to, id || uuid());
    }

    get type(): string {
        return "iq";
    }

    get xml(): string {
        return `<iq from='${this.from}' to='${this.to}' id='${this.id}' type='get'>
    <ping xmlns='urn:xmpp:ping'/>
</iq>`;
    }
}

export abstract class StzaIqDisco extends StzaBase {
    constructor(
        from: string,
        to: string,
        id: string,
        protected iqType = "result",
        protected queryType = "",
    ) {
        super(from, to, id);
    }

    get type(): string {
        return "iq";
    }

    get queryContent(): string { return ""; }

    get xml(): string {
        return `<iq from='${this.from}' to='${this.to}' id='${this.id}' type='${this.iqType}'>
        <query xmlns='${this.queryType}'>
        ${this.queryContent}</query></iq>`;
    }
}

export class StzaIqDiscoItems extends StzaIqDisco {
    private items: Array<{jid: string, name: string}>;
    constructor(
        from: string,
        to: string,
        id: string,
        queryType: string,
    ) {
        super(from, to, id, "result", queryType);
        this.items = [];
    }

    get queryContent(): string {
        const items = this.items.map((item) =>
            `<item jid='${he.encode(item.jid)}' name='${he.encode(item.name)}'/>`,
        ).join("");
        return items;
    }

    public addItem(jid: string, name: string) {
        this.items.push({jid, name});
    }
}

export class StzaIqDiscoInfo extends StzaIqDisco {
    public identity: Set<{category: string, type: string, name: string}>;
    public feature: Set<string>;

    constructor(
        public from: string,
        public to: string,
        public id: string) {
        super(from, to, id, "result", "http://jabber.org/protocol/disco#info");
        this.identity = new Set();
        this.feature = new Set();
    }

    get queryContent(): string {
        let identity = "";
        let feature = "";
        this.identity.forEach((ident) => {
            identity += `<identity category='${ident.category}' type='${ident.type}' name='${ident.name}'/>`;
        });
        this.feature.forEach((feat) => {
            feature += `<feature var='${feat}'/>`;
        });
        return identity + feature;
    }

}

export class StzaIqSearchFields extends StzaBase {
    constructor(
        from: string,
        to: string,
        id: string,
        public instructions: string,
        public fields: {[key: string]: string},
    ) {
        super(from, to, id);
    }

    get type(): string {
        return "iq";
    }

    get queryContent(): string { return ""; }

    get xml(): string {
        const fields = Object.keys(this.fields).map((field) => `<${field}>${this.fields[field]}</${field}>`).join("");
        return `<iq from='${this.from}' to='${this.to}' id='${this.id}' type='result' xml:lang='en'>`
        + `<query xmlns='jabber:iq:search'><instructions>${he.encode(this.instructions)}</instructions>`
        + `${fields}</query></iq>`;
    }
}
