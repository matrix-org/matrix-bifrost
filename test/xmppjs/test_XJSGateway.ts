import * as Chai from "chai";
import { XmppJsGateway } from "../../src/xmppjs/XJSGateway";
import { IConfigBridge, Config } from "../../src/Config";
import { MockXJSInstance } from "../mocks/XJSInstance";
import { IGatewayRoom } from "../../src/GatewayHandler";
import { x } from "@xmpp/xml";
import { StzaPresence } from "../../src/xmppjs/Stanzas";

const expect = Chai.expect;

function createGateway(config?: IConfigBridge) {
    const mockXmpp = new MockXJSInstance();
    if (!config) {
        config = new Config().bridge;
    }
    return {gw: new XmppJsGateway(mockXmpp as any, config), mockXmpp};
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
                    {
                        sender: "@foo1:bar",
                        content: {},
                        membership: "join",
                    },
                    {
                        sender: "@foo2:bar",
                        content: {
                            displayname: "Mr Foo2",
                        },
                        membership: "join",
                    },
                    {
                        sender: "@_xmpp_baz:bar",
                        content: {
                            displayname: "Baz",
                        },
                        membership: "join",
                    },
                    {
                        sender: "@leavy:bar",
                        content: {
                            displayname: "LEavy",
                        },
                        membership: "leave",
                    },
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
                const m = msg as StzaPresence;
                m.id = undefined;
                return m;
            });
            expect(messages[0]).to.deep.equal({
                from: "#matrix#bar@conference.localhost/@foo1:bar",
                to: "frogman@froguniverse/frogdevice",
                id: undefined,
                presenceType: "",
                includeXContent: true,
                affiliation: "member",
                role: "participant",
                self: false,
                jid: "",
                itemType: "",
            });
            expect(messages[1]).to.deep.equal({
                from: "#matrix#bar@conference.localhost/Mr Foo2",
                to: "frogman@froguniverse/frogdevice",
                id: undefined,
                presenceType: "",
                includeXContent: true,
                affiliation: "member",
                role: "participant",
                self: false,
                jid: "",
                itemType: "",
            });
            expect(messages[2]).to.deep.equal({
                from: "#matrix#bar@conference.localhost",
                to: "frogman@froguniverse/frogdevice",
                id: undefined,
                presenceType: "",
                includeXContent: true,
                affiliation: "member",
                role: "participant",
                self: true,
                jid: "",
                itemType: "",
            });
            expect(messages[3]).to.deep.equal({
                from: "#matrix#bar@conference.localhost",
                to: "frogman@froguniverse/frogdevice",
                id: undefined,
                subject: "GatewayRoom | GatewayTopic",
            });
        });
    });
});
