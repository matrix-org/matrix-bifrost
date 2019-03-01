import * as Chai from "chai";
import { XmppJsGateway } from "../../src/xmppjs/XJSGateway";
import { IConfigBridge, Config } from "../../src/Config";
import { MockXJSInstance } from "../mocks/XJSInstance";
import { IGatewayRoom } from "../../src/GatewayHandler";
import { x } from "@xmpp/xml";
import { StzaPresence, StzaBase, StzaPresenceItem } from "../../src/xmppjs/Stanzas";

const expect = Chai.expect;

function createGateway(config?: IConfigBridge) {
    const mockXmpp = new MockXJSInstance();
    if (!config) {
        config = new Config().bridge;
    }
    return {gw: new XmppJsGateway(mockXmpp as any, config), mockXmpp};
}

function createMember(stateKey: string, displayname?: string, membership: string = "join") {
    return {
        state_key: stateKey,
        isRemote: stateKey.startsWith("@_xmpp_"),
        content: {
            displayname,
            membership,
        },
    };
}

describe("XJSGateway", () => {
    describe("handleStanza", () => {
        it("should be able to join a room", () => {
            const {gw, mockXmpp} = createGateway();
            let joinCount = 0;
            mockXmpp.on("gateway-joinroom", () => {
                joinCount++;
            });
            gw.handleStanza(
                x("presence", {
                    from: "frogman@frogworld/froddevice",
                    to: "#worldoffrogs#frogworld.net/SlippyNick",
                    id: "myjoinid",
                }, x("x", {xmlns: "http://jabber.org/protocol/muc"}) ),
            "#matrix:bar");
            gw.handleStanza(
                x("presence", {
                    from: "frogman@frogworld/froddevice",
                    to: "#worldoffrogs2#frogworld.net/SlippyNick",
                    id: "myjoinid",
                }, x("x", {xmlns: "http://jabber.org/protocol/muc"}) ),
            "#matrix:bar");
            expect(joinCount).to.equal(2);
        });
    });
    describe("onRemoteJoin", () => {
        it("should fail without an existing stanza", async () => {
            const {gw} = createGateway();
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
                    to: "#matrix#bar@conference.localhost/frognick",
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
            expect(messages[0].from).to.equal("#matrix#bar@conference.localhost/@foo1:bar");
            expect(messages[0].to).to.equal("frogman@froguniverse/frogdevice");
            expect((messages[0] as StzaPresenceItem).affiliation).to.equal("member");
            expect((messages[0] as StzaPresenceItem).role).to.equal("participant");

            expect(messages[1].from).to.equal("#matrix#bar@conference.localhost/Mr Foo2");
            expect(messages[1].to).to.equal("frogman@froguniverse/frogdevice");
            expect((messages[1] as StzaPresenceItem).affiliation).to.equal("member");
            expect((messages[1] as StzaPresenceItem).role).to.equal("participant");

            expect(messages[2].from).to.equal("#matrix#bar@conference.localhost/frognick");
            expect(messages[2].to).to.equal("frogman@froguniverse/frogdevice");
            expect((messages[2] as StzaPresenceItem).affiliation).to.equal("member");
            expect((messages[2] as StzaPresenceItem).role).to.equal("participant");
            expect((messages[2] as any).statusCodes).to.contain("110");

            expect(messages[3]).to.deep.equal({
                _from: "#matrix#bar@conference.localhost",
                _to: "frogman@froguniverse/frogdevice",
                _id: "",
                subject: "GatewayRoom | GatewayTopic",
            });
        });
        it("should handle a second device for a remote user", async () => {
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
                    to: "#matrix#bar@conference.localhost/frognick",
                    id: "myjoinid",
                }, x("x", {xmlns: "http://jabber.org/protocol/muc"}) ),
            "#matrix:bar");
            await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_baz:bar");
            gw.handleStanza(
                x("presence", {
                    from: "frogman@froguniverse/frogdevice2",
                    to: "#matrix#bar@conference.localhost/frognick",
                    id: "myjoinid2",
                }, x("x", {xmlns: "http://jabber.org/protocol/muc"}) ),
            "#matrix:bar");
            await gw.onRemoteJoin(null, "myjoinid2", room, "@_xmpp_baz:bar");
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
                    to: "#matrix#bar@conference.localhost/frognick",
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
            expect(mockXmpp.drainWaits).to.equal(2500 / 100);
        });
    });
});
