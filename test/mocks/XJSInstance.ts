import { IStza, StzaIqPing, StzaPresenceItem, StzaPresenceJoin } from "../../src/xmppjs/Stanzas";
import { EventEmitter } from "events";
import { x } from "@xmpp/xml";
import { IChatJoined } from "../../src/bifrost/Events";
import { jid } from "@xmpp/jid";
import { XMPP_PROTOCOL } from "../../src/xmppjs/XJSInstance";

export class MockXJSInstance extends EventEmitter {
    public sentMessageIDs: string[] = [];
    public sentMessages: IStza[] = [];
    public sentPackets: Element[] = [];
    public selfPingResponse: "respond-ok"|"respond-error"|"no-response" = "respond-error";
    public accountUsername!: string;

    public xmppAddSentMessage(id: string) {
        this.sentMessageIDs.push(id);
    }

    public xmppSend(msg: IStza) {
        if (msg instanceof StzaPresenceItem) {
            // Hack for tests, clone this.
            const item = new StzaPresenceItem(msg.from, msg.to, msg.id, msg.affiliation, msg.role, msg.self, msg.jid, msg.presenceType);
            msg.statusCodes.forEach(i => item.statusCodes.add(i));
            this.sentMessages.push(item);
        } else {
            this.sentMessages.push(msg);
        }
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

    public xmppWriteToStream(msg: Element) {
        this.sentPackets.push(msg);
    }
}
