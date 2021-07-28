import * as Chai from "chai";
import { PresenceCache } from "../../src/xmppjs/PresenceCache";
import { x } from "@xmpp/xml";
const expect = Chai.expect;

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

const aliceLeave = x("presence", {
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/alice",
    type: "unavailable",
}, [
    x("x", {xmlns: "http://jabber.org/protocol/muc#user"}, [
        x("item", {affiliation: "none", role: "none"}),
    ]),
]);

const bobJoin = x("presence", {
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/bob",
}, [
    x("x", {xmlns: "http://jabber.org/protocol/muc#user"}, [
        x("item", {affiliation: "member", role: "participant"}),
        x("status", {code: "110"}),
    ]),
]);

const aliceSeesBobJoin = x("presence", {
    to: "alice@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/bob",
}, [
    x("x", {xmlns: "http://jabber.org/protocol/muc#user"}, [
        x("item", {affiliation: "member", role: "participant"}),
    ]),
]);

const bobLeave = x("presence", {
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/bob",
    type: "unavailable",
}, [
    x("x", {xmlns: "http://jabber.org/protocol/muc#user"}, [
        x("item", {affiliation: "none", role: "none"}),
        x("status", {code: "110"}),
    ]),
]);

const aliceKick = x("presence", {
    xmlns: "jabber:client",
    to: "bob@xmpp.matrix.org/fakedevice",
    from: "aroom@conf.xmpp.matrix.org/alice",
    type: "unavailable",
},
x("x", {
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
));

describe("PresenceCache", () => {
    it("should parse a join message", () => {
        const p = new PresenceCache();
        const delta = p.add(aliceJoin)!;
        expect(delta).to.not.be.undefined;
        expect(delta.changed).to.contain("online");
        expect(delta.changed).to.contain("new");
        expect(delta.error).to.be.null;
        expect(delta.isSelf).to.be.false;
        expect(delta.status!.resource).to.eq("alice");
        const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
        expect(status).to.not.be.undefined;
        expect(status!.online).to.be.true;
        expect(status!.ours).to.be.false;
        expect(status!.resource).to.eq("alice");
    });

    it("should parse a leave message", () => {
        const p = new PresenceCache();
        p.add(aliceJoin)!;
        const delta = p.add(aliceLeave)!;
        expect(delta).to.not.be.undefined;
        expect(delta.changed).to.contain("offline");
        expect(delta.error).to.be.null;
        expect(delta.isSelf).to.be.false;
        expect(delta.status!.resource).to.eq("alice");
        const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
        expect(status).to.not.be.undefined;
        expect(status!.online).to.be.false;
        expect(status!.ours).to.be.false;
        expect(status!.resource).to.eq("alice");
    });

    it("should parse own join and leave", () => {
        const p = new PresenceCache();
        let delta;
        delta = p.add(bobJoin)!;
        expect(delta).to.not.be.undefined;
        expect(delta.changed).to.contain("online");
        expect(delta.changed).to.contain("new");
        expect(delta.error).to.be.null;
        expect(delta.isSelf).to.be.true;
        expect(delta.status!.resource).to.eq("bob");
        delta = p.add(bobLeave)!;
        expect(delta).to.not.be.undefined;
        expect(delta.changed).to.contain("offline");
        expect(delta.error).to.be.null;
        expect(delta.isSelf).to.be.true;
        expect(delta.status!.resource).to.eq("bob");
        const status = p.getStatus("aroom@conf.xmpp.matrix.org/bob");
        expect(status).to.not.be.undefined;
        expect(status!.online).to.be.false;
        expect(status!.ours).to.be.true;
        expect(status!.resource).to.eq("bob");
    });

    it("should handle join presence races", () => {
        const p = new PresenceCache();
        let delta;
        delta = p.add(aliceSeesBobJoin)!;
        expect(delta).to.not.be.undefined;
        expect(delta.changed).to.contain("online");
        expect(delta.changed).to.contain("new");
        expect(delta.error).to.be.null;
        expect(delta.isSelf).to.be.false;
        expect(delta.status!.resource).to.eq("bob");
        delta = p.add(bobJoin)!;
        expect(delta).to.not.be.undefined;
        expect(delta.changed).to.contain("online");
        expect(delta.error).to.be.null;
        expect(delta.isSelf).to.be.true;
        expect(delta.status!.resource).to.eq("bob");
        const status = p.getStatus("aroom@conf.xmpp.matrix.org/bob");
        expect(status).to.not.be.undefined;
        expect(status!.online).to.be.true;
        expect(status!.ours).to.be.true;
        expect(status!.resource).to.eq("bob");
    });

    it("should parse a kick message", () => {
        const p = new PresenceCache();
        p.add(aliceJoin)!;
        const delta = p.add(aliceKick)!;
        expect(delta).to.not.be.undefined;
        expect(delta.changed).to.contain("kick");
        expect(delta.error).to.be.null;
        expect(delta.isSelf).to.be.false;
        expect(delta.status!.resource).to.eq("alice");
        const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
        expect(status).to.not.be.undefined;
        expect(status!.online).to.be.false;
        expect(status!.ours).to.be.false;
        expect(status!.kick!.kicker).to.eq("bob");
        expect(status!.kick!.reason).to.eq("Didn't like em much");
        expect(status!.resource).to.eq("alice");
    });

    it("should handle two new devices in gateway mode", () => {
        const p = new PresenceCache(true);
        p.add(aliceJoinGateway)!;
        const delta2 = p.add(x("presence", {
            xmlns: "jabber:client",
            from: "alice@xmpp.matrix.org/fakedevice2",
            to: "aroom@conf.xmpp.matrix.org/alice",
        }))!;
        expect(delta2).to.not.be.undefined;
        expect(delta2.changed).to.not.contain("online");
        expect(delta2.changed).to.not.contain("new");
        expect(delta2.changed).to.contain("newdevice");
        expect(delta2.error).to.be.null;
        expect(delta2.isSelf).to.be.false;
        const status = p.getStatus("aroom@conf.xmpp.matrix.org/alice");
        expect(status).to.not.be.undefined;
        expect(status!.online).to.be.true;
        expect(status!.ours).to.be.false;
        expect(status!.resource).to.eq("alice");
        expect(status!.devices!).to.contain("fakedevice");
        expect(status!.devices!).to.contain("fakedevice2");
    });
});
