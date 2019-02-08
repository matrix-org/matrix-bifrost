import { IStza, StzaIqPing, StzaPresenceJoin } from "../../src/xmppjs/Stanzas";
import { EventEmitter } from "events";
import { x } from "@xmpp/xml";
import { IChatJoined } from "../../src/purple/PurpleEvents";
import { jid } from "@xmpp/jid";
import { XMPP_PROTOCOL } from "../../src/xmppjs/XJSInstance";

export class MockXJSInstance extends EventEmitter {
    public sentMessageIDs: string[] = [];
    public sentMessages: IStza[] = [];
    public selfPingResponse: "respond-ok"|"respond-error"|"no-response" = "respond-error";
    public accountUsername!: string;

    public xmppAddSentMessage(id: string) {
        this.sentMessageIDs.push(id);
    }

    public xmppSend(msg: IStza) {
        this.sentMessages.push(msg);
        if (msg instanceof StzaIqPing) {
            if (this.selfPingResponse === "respond-ok") {
                this.emit("iq." + msg.id, x("iq"));
            } else if (this.selfPingResponse === "respond-error") {
                this.emit("iq." + msg.id, x("iq", {}, x("error")));
            }
        }
        if (msg instanceof StzaPresenceJoin) {
            const to = jid(msg.to);
            const convName = `${to.local}@${to.domain}`;
            this.emit("chat-joined", {
                eventName: "chat-joined",
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: this.accountUsername,
                },
            } as IChatJoined);
        }
    }
}
