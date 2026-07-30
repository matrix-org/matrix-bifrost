import { describe, it, expect, beforeAll } from "vitest";
import { Config } from "../../src/Config";
import { XmppJsInstance, XMPP_PROTOCOL } from "../../src/xmppjs/XJSInstance";
import { x } from "@xmpp/xml";

describe("XJSInstance", () => {
  let config: Config;
  beforeAll(() => {
    config = new Config();
    config.ApplyConfig({
      purple: {
        backendOpts: {},
      },
    });
  });
  it("should match an xmpp username", () => {
    const instance = new XmppJsInstance(config, {} as any);
    const res = instance.getUsernameFromMxid(
      "@_xmpp_frogman=40frogplanet.com:example.com",
      "_xmpp_",
    );
    expect(res.protocol).toBe(XMPP_PROTOCOL);
    expect(res.username).toBe("frogman@frogplanet.com");
  });

  it("should match an xmpp username with a resource", () => {
    const instance = new XmppJsInstance(config, {} as any);
    const res = instance.getUsernameFromMxid(
      "@_xmpp_frogdevice=2ffrogman=40frogplanet.com:example.com",
      "_xmpp_",
    );
    expect(res.protocol).toBe(XMPP_PROTOCOL);
    expect(res.username).toBe("frogman@frogplanet.com/frogdevice");
  });

  describe("isDuplicateStanza", () => {
    const mucJoin = () =>
      x(
        "presence",
        {
          from: "user@example.com/res1",
          to: "#room#server@gateway.example.com/nick",
        },
        x("x", { xmlns: "http://jabber.org/protocol/muc" }),
      );

    it("should dedupe stanzas with an explicit id", () => {
      const instance = new XmppJsInstance(config, {} as any);
      const stanza = () =>
        x(
          "message",
          {
            from: "user@example.com/res1",
            to: "room@muc.example.com",
            id: "abc123",
          },
          x("body", {}, "hello"),
        );
      expect(instance.isDuplicateStanza(stanza())).toBe(false);
      expect(instance.isDuplicateStanza(stanza())).toBe(true);
    });

    it("should dedupe id-less messages by content (MUC fan-out copies)", () => {
      const instance = new XmppJsInstance(config, {} as any);
      const stanza = () =>
        x(
          "message",
          {
            from: "room@muc.example.com/nick",
            to: "ghost1@gateway.example.com",
            type: "groupchat",
          },
          x("body", {}, "fan-out"),
        );
      expect(instance.isDuplicateStanza(stanza())).toBe(false);
      expect(instance.isDuplicateStanza(stanza())).toBe(true);
    });

    it("should drop stanzas whose id was registered as sent (self-echo)", () => {
      const instance = new XmppJsInstance(config, {} as any);
      instance.xmppAddSentMessage("sent-id-1");
      const echo = x(
        "message",
        {
          from: "room@muc.example.com/mynick",
          to: "me@example.com",
          id: "sent-id-1",
        },
        x("body", {}, "my own message"),
      );
      expect(instance.isDuplicateStanza(echo)).toBe(true);
    });

    it("should NOT dedupe an id-less MUC rejoin presence", () => {
      // join -> part -> rejoin: the rejoin presence is byte-identical to the join.
      // Content-dedup used to eat it, permanently locking the user out of the room.
      const instance = new XmppJsInstance(config, {} as any);
      expect(instance.isDuplicateStanza(mucJoin())).toBe(false);
      expect(
        instance.isDuplicateStanza(
          x("presence", {
            from: "user@example.com/res1",
            to: "#room#server@gateway.example.com/nick",
            type: "unavailable",
          }),
        ),
      ).toBe(false);
      expect(instance.isDuplicateStanza(mucJoin())).toBe(false);
    });

    it("should still dedupe presences that carry an explicit id", () => {
      const instance = new XmppJsInstance(config, {} as any);
      const stanza = () =>
        x("presence", {
          from: "user@example.com/res1",
          to: "other@example.com",
          id: "pres-1",
        });
      expect(instance.isDuplicateStanza(stanza())).toBe(false);
      expect(instance.isDuplicateStanza(stanza())).toBe(true);
    });
  });

  it("should be able to transform a xmpp username to a mxid and back", () => {
    const username = "frogman@frogplanet.com/frog$£!%& device";
    const instance = new XmppJsInstance(config, {} as any);
    const mxUser = XMPP_PROTOCOL.getMxIdForProtocol(username, "example.com", "_xmpp_").userId;
    const res = instance.getUsernameFromMxid(mxUser, "_xmpp_");
    expect(res.protocol).toBe(XMPP_PROTOCOL);
    expect(res.username).toBe(username);
  });
});
