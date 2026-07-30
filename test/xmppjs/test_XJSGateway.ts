import { describe, it, expect, beforeEach } from "vitest";
import { XmppJsGateway } from "../../src/xmppjs/XJSGateway";
import { IConfigBridge, Config } from "../../src/Config";
import { MockXJSInstance } from "../mocks/XJSInstance";
import { IGatewayRoom } from "../../src/bifrost/Gateway";
import { x } from "@xmpp/xml";
import { StzaBase, StzaPresenceItem } from "../../src/xmppjs/Stanzas";
import { XMPPStatusCode } from "../../src/xmppjs/XMPPConstants";
import jid from "@xmpp/jid";

function createGateway(config?: IConfigBridge) {
  const mockXmpp = new MockXJSInstance();
  if (!config) {
    config = new Config().bridge;
  }
  return {
    gw: new XmppJsGateway(
      mockXmpp as any,
      {
        generateParametersFor(protocol: string, mxId: string) {
          // Matches AutoRegistration.generateParametersFor, which returns the parameter
          // map for the protocol's registration step ({username} for XMPP).
          return { username: mxId.replace(/@/, "").replace(/:/g, "_") + "@bar" };
        },
      } as any,
      config,
    ),
    mockXmpp,
  };
}

function createMember(
  stateKey: string,
  displayname?: string,
  membership: string = "join",
  sender?: string,
) {
  return {
    stateKey,
    isRemote: stateKey.startsWith("@_xmpp_"),
    displayname,
    membership,
    sender: sender || stateKey,
  };
}

describe("XJSGateway", () => {
  let gw: XmppJsGateway;
  let mockXmpp: MockXJSInstance;
  let joinCount: number;
  beforeEach(() => {
    joinCount = 0;
    const createResult = createGateway();
    gw = createResult.gw;
    mockXmpp = createResult.mockXmpp;
    mockXmpp.on("gateway-joinroom", () => {
      joinCount++;
    });
  });

  describe("handleStanza", () => {
    it("should be able to join a room", () => {
      gw.handleStanza(
        x(
          "presence",
          {
            from: "frogman@frogworld/froddevice",
            to: "#worldoffrogs#frogworld.net/SlippyNick",
            id: "myjoinid",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      gw.handleStanza(
        x(
          "presence",
          {
            from: "frogman@frogworld/froddevice",
            to: "#worldoffrogs2#frogworld.net/SlippyNick",
            id: "myjoinid",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      expect(joinCount).toBe(2);
    });
  });
  describe("onRemoteJoin", () => {
    it("should fail without an existing stanza", async () => {
      const room: IGatewayRoom = {
        name: "GatewayRoom",
        topic: "GatewayTopic",
        roomId: "!foo:bar",
        membership: [],
        allowHistory: true,
      };
      try {
        await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_foo:bar");
      } catch (ex) {
        expect(ex.message).toBe("Stanza for join not in cache, cannot handle");
        return;
      }
      throw Error("Should have thrown");
    });
    it("should join a remote user with full membership", async () => {
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
        allowHistory: true,
      };
      gw.handleStanza(
        x(
          "presence",
          {
            from: "frogman@froguniverse/frogdevice",
            to: "#matrix#bar@conference.localhost/frognick",
            id: "myjoinid",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_baz:bar");
      // Check ordering of events
      const messages = mockXmpp.sentMessages.map((msg) => {
        const m = msg as StzaBase;
        m.id = undefined;
        return m;
      });
      expect(messages[0]).toMatchObject({
        hFrom: "#matrix#bar@conference.localhost/@foo1:bar",
        hTo: "frogman@froguniverse/frogdevice",
        affiliation: "member",
        role: "participant",
        // XEP-0045 §7.2.3: the real JID advertised for an occupant must be a FULL
        // JID — Smack-based clients cast it to EntityFullJid.
        jid: "foo1_bar@bar/matrix-bridge",
      });

      expect(messages[1]).toMatchObject({
        hFrom: "#matrix#bar@conference.localhost/Mr Foo2",
        hTo: "frogman@froguniverse/frogdevice",
        affiliation: "member",
        role: "participant",
        jid: "foo2_bar@bar/matrix-bridge",
      });

      expect(messages[2]).toMatchObject({
        hFrom: "#matrix#bar@conference.localhost/frognick",
        hTo: "frogman@froguniverse/frogdevice",
        affiliation: "member",
        role: "participant",
      });
      expect((messages[2] as StzaPresenceItem).statusCodes).toContain(XMPPStatusCode.SelfPresence);
      expect((messages[2] as StzaPresenceItem).statusCodes).toContain(
        XMPPStatusCode.RoomNonAnonymous,
      );
      expect((messages[2] as StzaPresenceItem).statusCodes).toContain(
        XMPPStatusCode.RoomLoggingEnabled,
      );

      expect(messages[3]).toEqual({
        hFrom: "#matrix#bar@conference.localhost",
        hTo: "frogman@froguniverse/frogdevice",
        hId: "",
        subject: "GatewayRoom | GatewayTopic",
      });
    });
    it("should handle a second device for a remote user", async () => {
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
        allowHistory: true,
      };
      gw.handleStanza(
        x(
          "presence",
          {
            from: "frogman@froguniverse/frogdevice",
            to: "#matrix#bar@conference.localhost/frognick",
            id: "myjoinid",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_baz:bar");
      gw.handleStanza(
        x(
          "presence",
          {
            from: "frogman@froguniverse/frogdevice2",
            to: "#matrix#bar@conference.localhost/frognick",
            id: "myjoinid2",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      await gw.onRemoteJoin(null, "myjoinid2", room, "@_xmpp_baz:bar");
    });
    it("should join a remote user to a room with a large member count", async () => {
      const membership = [createMember("@_xmpp_baz:bar", "Baz")];
      for (let i = 1; i <= 2500; i++) {
        membership.push(createMember(`@foo${i}:bar`, `Mr Foo${i}`));
      }
      const room: IGatewayRoom = {
        name: "GatewayRoom",
        topic: "GatewayTopic",
        roomId: "!foo:bar",
        membership,
        allowHistory: true,
      };
      gw.handleStanza(
        x(
          "presence",
          {
            from: "frogman@froguniverse/frogdevice",
            to: "#matrix#bar@conference.localhost/frognick",
            id: "myjoinid",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      await gw.onRemoteJoin(null, "myjoinid", room, "@_xmpp_baz:bar");
      // Check ordering of events
      const messages = mockXmpp.sentMessages.map((msg) => {
        const m = msg as StzaBase;
        m.id = undefined;
        return m;
      });
      // 2500 users + 1 self presence
      expect(messages.filter((m) => m.type === "presence")).toHaveLength(2501);
    });
    it("should reflect a join to all other XMPP users in the room", async () => {
      const room: IGatewayRoom = {
        name: "GatewayRoom",
        topic: "GatewayTopic",
        roomId: "!foo:bar",
        membership: [],
        allowHistory: true,
      };
      gw.handleStanza(
        x(
          "presence",
          {
            from: "frogman@froguniverse/frogdevice",
            to: "#matrix#bar@conference.localhost/frognick",
            id: "myjoinid1",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      gw.handleStanza(
        x(
          "presence",
          {
            from: "dogboy@froguniverse/phone",
            to: "#matrix#bar@conference.localhost/dognick",
            id: "myjoinid2",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );
      gw.handleStanza(
        x(
          "presence",
          {
            from: "alice@froguniverse/phone",
            to: "#matrix#bar@conference.localhost/alice",
            id: "myjoinid3",
          },
          x("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ),
        "#matrix:bar",
      );

      await gw.onRemoteJoin(null, "myjoinid1", room, "@_xmpp_frognick:bar");
      expect(
        gw.isJIDInMuc("#matrix#bar@conference.localhost", jid("frogman@froguniverse/frogdevice")),
      ).toBe(true);

      await gw.onRemoteJoin(null, "myjoinid2", room, "@_xmpp_dognick:bar");
      expect(
        gw.isJIDInMuc("#matrix#bar@conference.localhost", jid("dogboy@froguniverse/phone")),
      ).toBe(true);

      await gw.onRemoteJoin(null, "myjoinid3", room, "@_xmpp_alice:bar");
      expect(
        gw.isJIDInMuc("#matrix#bar@conference.localhost", jid("alice@froguniverse/phone")),
      ).toBe(true);

      // frogman should have got dogboy's presence
      expect(
        mockXmpp.sentMessages.find((msg) => {
          const presence = msg as StzaPresenceItem;
          return (
            presence.from === "#matrix#bar@conference.localhost/dognick" &&
            presence.to === "frogman@froguniverse/frogdevice" &&
            presence.affiliation === "member" &&
            presence.role === "participant" &&
            presence.statusCodes.size === 0
          );
        }),
      ).toBeDefined();
      // frogman & dogboy should have got alice's presence
      expect(
        mockXmpp.sentMessages.find((msg) => {
          const presence = msg as StzaPresenceItem;
          return (
            presence.from === "#matrix#bar@conference.localhost/alice" &&
            presence.to === "frogman@froguniverse/frogdevice" &&
            presence.affiliation === "member" &&
            presence.role === "participant" &&
            presence.statusCodes.size === 0
          );
        }),
      ).toBeDefined();
      expect(
        mockXmpp.sentMessages.find((msg) => {
          const presence = msg as StzaPresenceItem;
          return (
            presence.from === "#matrix#bar@conference.localhost/alice" &&
            presence.to === "dogboy@froguniverse/phone" &&
            presence.affiliation === "member" &&
            presence.role === "participant" &&
            presence.statusCodes.size === 0
          );
        }),
      ).toBeDefined();
    });
  });
});
