import { describe, it, expect } from "vitest";
import { PresenceCache } from "../../src/xmppjs/PresenceCache";
import { x } from "@xmpp/xml";

const aliceJoin = x("presence", {
  xmlns: "jabber:client",
  to: "bob@xmpp.matrix.org/fakedevice",
  from: "aroom@conf.xmpp.matrix.org/alice",
});

const aliceJoinGateway = x("presence", {
  xmlns: "jabber:client",
  from: "alice@xmpp.matrix.org/fakedevice",
  to: "aroom@conf.xmpp.matrix.org/alice",
});

const aliceLeave = x(
  "presence",
  {
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/alice",
    type: "unavailable",
  },
  [
    x("x", { xmlns: "http://jabber.org/protocol/muc#user" }, [
      x("item", { affiliation: "none", role: "none" }),
    ]),
  ],
);

const bobJoin = x(
  "presence",
  {
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/bob",
  },
  [
    x("x", { xmlns: "http://jabber.org/protocol/muc#user" }, [
      x("item", { affiliation: "member", role: "participant" }),
      x("status", { code: "110" }),
    ]),
  ],
);

const aliceSeesBobJoin = x(
  "presence",
  {
    to: "alice@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/bob",
  },
  [
    x("x", { xmlns: "http://jabber.org/protocol/muc#user" }, [
      x("item", { affiliation: "member", role: "participant" }),
    ]),
  ],
);

const bobLeave = x(
  "presence",
  {
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/bob",
    type: "unavailable",
  },
  [
    x("x", { xmlns: "http://jabber.org/protocol/muc#user" }, [
      x("item", { affiliation: "none", role: "none" }),
      x("status", { code: "110" }),
    ]),
  ],
);

const aliceKick = x(
  "presence",
  {
    xmlns: "jabber:client",
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/alice",
    type: "unavailable",
  },
  x(
    "x",
    {
      xmlns: "http://jabber.org/protocol/muc#user",
    },
    [
      x("status", {
        code: "307",
      }),
      x("item", undefined, [
        x("actor", {
          nick: "bob",
        }),
        x("reason", undefined, "Didn't like em much"),
      ]),
    ],
  ),
);

describe("PresenceCache", () => {
  it("should parse a join message", () => {
    const p = new PresenceCache();
    const delta = p.add(aliceJoin)!;
    expect(delta).not.toBeUndefined();
    expect(delta.changed).toContain("online");
    expect(delta.changed).toContain("new");
    expect(delta.error).toBeNull();
    expect(delta.isSelf).toBe(false);
    expect(delta.status!.resource).toBe("alice");
    const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
    expect(status).not.toBeUndefined();
    expect(status!.online).toBe(true);
    expect(status!.ours).toBe(false);
    expect(status!.resource).toBe("alice");
  });

  it("should parse a leave message", () => {
    const p = new PresenceCache();
    p.add(aliceJoin)!;
    const delta = p.add(aliceLeave)!;
    expect(delta).not.toBeUndefined();
    expect(delta.changed).toContain("offline");
    expect(delta.error).toBeNull();
    expect(delta.isSelf).toBe(false);
    expect(delta.status!.resource).toBe("alice");
    const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
    expect(status).not.toBeUndefined();
    expect(status!.online).toBe(false);
    expect(status!.ours).toBe(false);
    expect(status!.resource).toBe("alice");
  });

  it("should parse own join and leave", () => {
    const p = new PresenceCache();
    let delta;
    delta = p.add(bobJoin)!;
    expect(delta).not.toBeUndefined();
    expect(delta.changed).toContain("online");
    expect(delta.changed).toContain("new");
    expect(delta.error).toBeNull();
    expect(delta.isSelf).toBe(true);
    expect(delta.status!.resource).toBe("bob");
    delta = p.add(bobLeave)!;
    expect(delta).not.toBeUndefined();
    expect(delta.changed).toContain("offline");
    expect(delta.error).toBeNull();
    expect(delta.isSelf).toBe(true);
    expect(delta.status!.resource).toBe("bob");
    const status = p.getStatus("aroom@conf.xmpp.matrix.org/bob");
    expect(status).not.toBeUndefined();
    expect(status!.online).toBe(false);
    expect(status!.ours).toBe(true);
    expect(status!.resource).toBe("bob");
  });

  it("should handle join presence races", () => {
    const p = new PresenceCache();
    let delta;
    delta = p.add(aliceSeesBobJoin)!;
    expect(delta).not.toBeUndefined();
    expect(delta.changed).toContain("online");
    expect(delta.changed).toContain("new");
    expect(delta.error).toBeNull();
    expect(delta.isSelf).toBe(false);
    expect(delta.status!.resource).toBe("bob");
    delta = p.add(bobJoin)!;
    expect(delta).not.toBeUndefined();
    expect(delta.changed).toContain("online");
    expect(delta.error).toBeNull();
    expect(delta.isSelf).toBe(true);
    expect(delta.status!.resource).toBe("bob");
    const status = p.getStatus("aroom@conf.xmpp.matrix.org/bob");
    expect(status).not.toBeUndefined();
    expect(status!.online).toBe(true);
    expect(status!.ours).toBe(true);
    expect(status!.resource).toBe("bob");
  });

  it("should parse a kick message", () => {
    const p = new PresenceCache();
    p.add(aliceJoin)!;
    const delta = p.add(aliceKick)!;
    expect(delta).not.toBeUndefined();
    expect(delta.changed).toContain("kick");
    expect(delta.error).toBeNull();
    expect(delta.isSelf).toBe(false);
    expect(delta.status!.resource).toBe("alice");
    const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
    expect(status).not.toBeUndefined();
    expect(status!.online).toBe(false);
    expect(status!.ours).toBe(false);
    expect(status!.kick!.kicker).toBe("bob");
    expect(status!.kick!.reason).toBe("Didn't like em much");
    expect(status!.resource).toBe("alice");
  });

  it("should handle two new devices in gateway mode", () => {
    const p = new PresenceCache(true);
    p.add(aliceJoinGateway)!;
    const delta2 = p.add(
      x("presence", {
        xmlns: "jabber:client",
        from: "alice@xmpp.matrix.org/fakedevice2",
        to: "aroom@conf.xmpp.matrix.org/alice",
      }),
    )!;
    expect(delta2).not.toBeUndefined();
    expect(delta2.changed).not.toContain("online");
    expect(delta2.changed).not.toContain("new");
    expect(delta2.changed).toContain("newdevice");
    expect(delta2.error).toBeNull();
    expect(delta2.isSelf).toBe(false);
    const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
    expect(status).not.toBeUndefined();
    expect(status!.online).toBe(true);
    expect(status!.ours).toBe(false);
    expect(status!.resource).toBe("alice");
    expect(status!.devices!).toContain("fakedevice");
    expect(status!.devices!).toContain("fakedevice2");
  });
});
