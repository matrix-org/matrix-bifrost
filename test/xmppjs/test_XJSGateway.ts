import * as Chai from "chai";
import { XmppJsGateway } from "../../src/xmppjs/XJSGateway";
import { IConfigBridge, Config } from "../../src/Config";
import { MockXJSInstance } from "../mocks/XJSInstance";
import { IGatewayRoom } from "../../src/GatewayHandler";
import { x } from "@xmpp/xml";
import { StzaPresence, StzaBase } from "../../src/xmppjs/Stanzas";

const expect = Chai.expect;

function createGateway(config?: IConfigBridge) {
    const mockXmpp = new MockXJSInstance();
    if (!config) {
        config = new Config().bridge;
    }
    return {gw: new XmppJsGateway(mockXmpp as any, config), mockXmpp};
}

function createMember(sender: string, displayname?: string, membership: string = "join") {
    return {
        sender,
        content: {
            displayname,
            membership,
        },
    };
}

describe("XJSGateway", () => {
    describe("onRemoteJoin", () => {
        it("should fail without an existing stanza", async () => {
            const {gw, mockXmpp} = createGateway();
            const room: IGatewayRoom = {
                name: "GatewayRoom",
                topic: "GatewayTopic",
                roomId: "!foo:bar",
                membership: [],
            };
            try {
                await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_foo:bar");
            } catch (ex) {
                expect(ex.message).to.eq("Stanza for join not in cache, cannot handle");
                return;
            }
            throw Error("Should have thrown");
        });
        it("should join a remote user with full membership", async () => {
            const {gw, mockXmpp} = createGateway();
            const room: IGatewayRoom = {
                name: "GatewayRoom",
                topic: "GatewayTopic",
                roomId: "!foo:bar",
                membership: [
                    createMember("@foo1:bar"),
                    createMember("@foo2:bar", "Mr Foo2"),
                    createMember("@_xmpp_baz:bar", "Baz"),
                    createMember("@leavy:bar", "Leavy", "leave"),
                ],
            };
            gw.handleStanza(
                x("presence", {
                    from: "frogman@froguniverse/frogdevice",
                    to: "#matrix#bar@conference.localhost",
                    id: "myjoinid",
                }, x("x", {xmlns: "http://jabber.org/protocol/muc"}) ),
            "#matrix:bar");
            await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_baz:bar");
            // Check ordering of events
            const messages = mockXmpp.sentMessages.map((msg) => {
                const m = msg as StzaBase;
                m.id = undefined;
                return m;
            });
            expect(messages[0]).to.deep.equal({
                _from: "#matrix#bar@conference.localhost/@foo1:bar",
                _to: "frogman@froguniverse/frogdevice",
                _id: "",
                presenceType: "",
                includeXContent: true,
                affiliation: "member",
                role: "participant",
                self: false,
                jid: "",
                itemType: "",
            });
            expect(messages[1]).to.deep.equal({
                _from: "#matrix#bar@conference.localhost/Mr Foo2",
                _to: "frogman@froguniverse/frogdevice",
                _id: "",
                presenceType: "",
                includeXContent: true,
                affiliation: "member",
                role: "participant",
                self: false,
                jid: "",
                itemType: "",
            });
            expect(messages[2]).to.deep.equal({
                _from: "#matrix#bar@conference.localhost",
                _to: "frogman@froguniverse/frogdevice",
                _id: "",
                presenceType: "",
                includeXContent: true,
                affiliation: "member",
                role: "participant",
                self: true,
                jid: "",
                itemType: "",
            });
            expect(messages[3]).to.deep.equal({
                _from: "#matrix#bar@conference.localhost",
                _to: "frogman@froguniverse/frogdevice",
                _id: "",
                subject: "GatewayRoom | GatewayTopic",
            });
        });
        it("should join a remote user to a room with a large member count", async () => {
            const {gw, mockXmpp} = createGateway();
            const membership = [createMember("@_xmpp_baz:bar", "Baz")];
            for (let i = 1; i <= 2500; i++) {
                membership.push(createMember(`@foo${i}:bar`, `Mr Foo${i}`));
            }
            const room: IGatewayRoom = {
                name: "GatewayRoom",
                topic: "GatewayTopic",
                roomId: "!foo:bar",
                membership,
            };
            gw.handleStanza(
                x("presence", {
                    from: "frogman@froguniverse/frogdevice",
                    to: "#matrix#bar@conference.localhost",
                    id: "myjoinid",
                }, x("x", {xmlns: "http://jabber.org/protocol/muc"}) ),
            "#matrix:bar");
            await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_baz:bar");
            // Check ordering of events
            const messages = mockXmpp.sentMessages.map((msg) => {
                const m = msg as StzaBase;
                m.id = undefined;
                return m;
            });
            // 2500 users + 1 self presence
            expect(messages.filter((m) => m.type === "presence")).to.have.lengthOf(2501);
            expect(mockXmpp.drainWaits).to.equal(2500 / 25);
        });
    });
});
