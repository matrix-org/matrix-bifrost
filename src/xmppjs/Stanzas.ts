import * as uuid from "uuid/v4";

export interface IStza {
    type: string;
    xml: string;
}

export abstract class StzaPresence implements IStza {
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
        const type = this.presenceType ? `type='${this.presenceType}'` : "";
        return `<presence from='${this.from}' to='${this.to}' id='${this.id}' ${type}>
     <x xmlns='http://jabber.org/protocol/muc'/>
     ${this.presenceContent}
</presence>`;
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
    ) {
        super(from, to, id, undefined);
    }

    public get presenceContent() {
        const statusCode = this.self ? "<status code='110'/>" : "";
        return `<item affiliation='${this.affiliation}' role='${this.role}'/>${statusCode}`;
    }
}
