import { jid } from "@xmpp/jid";
import { expect } from "chai";
import { PresenceAffiliation, PresenceRole, StzaPresenceItem } from "../../src/xmppjs/Stanzas";
import { MatrixMembershipEvent } from "../../src/MatrixTypes";
import { GatewayMUCMembership } from "../../src/xmppjs/GatewayMUCMembership";
import { GatewayStateResolve } from "../../src/xmppjs/GatewayStateResolve";

const CHAT_NAME = "mychatname";
const XMPP_MEMBER_JID = jid("xmpp_bob", "xmpp.example.com", "myresource");
const XMPP_MEMBER_JID_STRIPPED = jid("xmpp_bob", "xmpp.example.com");
const XMPP_MEMBER_JID_SECOND_DEVICE = jid("xmpp_bob", "xmpp.example.com", "myresource2");
const XMPP_MEMBER_ANONYMOUS = jid("mychatname", "xmpp.example.com", "bob");
const XMPP_MEMBER_MXID = "@_x_xmpp_bob:matrix.example.com";

const MATRIX_MEMBER_MXID = "@alice:matrix.example.com";
const MATRIX_MEMBER_ANONYMOUS = jid("mychatname", "xmpp.example.com", "alice");

const generateMember = (membership: "join"|"leave", mxid: string): MatrixMembershipEvent => {
    return {
        sender: mxid,
        state_key: mxid,
        content: {
            membership,
        },
        room_id: "!foo:bar",
        origin_server_ts: 123456,
        event_id: "$abc:def",
        type: "m.room.member",
    };
};

describe("GatewayStateResolve", () => {
    let members: GatewayMUCMembership;
    beforeEach(() => {
        members = new GatewayMUCMembership();
    });
    it("will ignore a join for a room without XMPP members", () => {
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(CHAT_NAME, members, generateMember("join", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(0);
    });
    it("will handle a Matrix join", () => {
        members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(CHAT_NAME, members, generateMember("join", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(1);
        const presence = res[0] as StzaPresenceItem;
        expect(presence.to).to.equal(XMPP_MEMBER_JID.toString());
        expect(presence.from).to.equal(CHAT_NAME + "/" + MATRIX_MEMBER_MXID);
        expect(presence.role).to.equal(PresenceRole.Participant);
        expect(presence.affiliation).to.equal(PresenceAffiliation.Member);
    });
    it("will ignore a leave for a room without XMPP members", () => {
        members.addMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(CHAT_NAME, members, generateMember("leave", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(0);
    });
    it("will ignore a leave for a room if the matrix user wasn't joined", () => {
        members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(CHAT_NAME, members, generateMember("leave", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(0);
    });
    it("will ignore a leave for a room without XMPP members", () => {
        members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
        members.addMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(CHAT_NAME, members, generateMember("leave", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(1);
        const presence = res[0] as StzaPresenceItem;
        expect(presence.to).to.equal(XMPP_MEMBER_JID.toString());
        expect(presence.from).to.equal(MATRIX_MEMBER_ANONYMOUS.toString());
        expect(presence.role).to.equal(PresenceRole.None);
        expect(presence.affiliation).to.equal(PresenceAffiliation.Member);
    });
})