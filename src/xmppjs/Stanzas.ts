import * as uuid from "uuid/v4";
import * as he from "he";

export interface IStza {
    type: string;
    xml: string;
}

export class StzaPresence implements IStza {
    constructor(
        public from: string,
        public to: string,
        public id?: string,
        public presenceType?: string,
    ) {
        this.id = this.id || uuid();
    }

    get presenceContent(): string { return ""; }

    get type(): string {
        return "presence";
    }

    get xml(): string {
        const type = this.presenceType ? ` type='${this.presenceType}'` : "";
        const id = this.id ? ` id='${this.id}'` : "";
        return `<presence from='${this.from}' to='${this.to}'${id}${type}>`
             + `<x xmlns='http://jabber.org/protocol/muc'/>${this.presenceContent}</presence>`;
    }
}

export class StzaPresenceItem extends StzaPresence {
    constructor(
        from: string,
        to: string,
        id?: string,
        public affiliation: string = "member",
        public role: string = "participant",
        public self: boolean = false,
        public jid: string = "",
        public itemType: string = "",
    ) {
        super(from, to, id, undefined);
    }

    public get presenceContent() {
        const statusCode = this.self ? "<status code='110'/>" : "";
        const jid = this.jid ? ` jid='${this.jid}'` : "";
        const type = this.itemType ? ` type='${this.itemType}'` : "";
        return `<item affiliation='${this.affiliation}'${jid}${type} role='${this.role}'/>${statusCode}`;
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

export class StzaMessage implements IStza {
    public html: string = "";
    public body: string = "";
    public attachments: string[] = [];
    constructor(
        public from: string,
        public to: string,
        public id?: string,
        public messageType?: string,
    ) {
        this.id = this.id || uuid();
    }

    get type(): string {
        return "message";
    }

    get xml(): string {
        const type = this.messageType ? `type='${this.messageType}'` : "";
        const html = "";
        const attachments = this.attachments.map((a) =>
            `<x xmlns='jabber:x:oob'><url>${he.encode(a)}</url></x>`,
        );
        return `<message from='${this.from}' to='${this.to}' id='${this.id}' ${type}>`
             + `${this.html}<body>${he.encode(this.body)}</body>${attachments}</message>`;
    }
}

export class StzaMessageSubject implements IStza {
    constructor(
        public from: string,
        public to: string,
        public id?: string,
        public subject: string = "",
    ) {
        this.id = this.id || uuid();
    }

    get content(): string { return ""; }

    get type(): string {
        return "message";
    }

    get xml(): string {
        return `<message from='${this.from}' to='${this.to}' id='${this.id}' type='groupchat'>`
             + `<subject>${this.subject}</subject></message>`;
    }
}
