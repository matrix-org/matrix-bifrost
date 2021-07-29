import { jid } from "@xmpp/jid";
import { expect } from "chai";
import { PresenceAffiliation, PresenceRole, StzaPresenceItem } from "../../src/xmppjs/Stanzas";
import { MatrixMembershipEvent } from "../../src/MatrixTypes";
import { GatewayMUCMembership } from "../../src/xmppjs/GatewayMUCMembership";
import { GatewayStateResolve } from "../../src/xmppjs/GatewayStateResolve";
import { XMPP_CHAT_NAME, MATRIX_MEMBER_ANONYMOUS, MATRIX_MEMBER_MXID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_JID, XMPP_MEMBER_MXID } from "./fixtures";


const generateMember = (membership: "join"|"leave", mxid: string): MatrixMembershipEvent => ({
    sender: mxid,
    state_key: mxid,
    content: {
        membership,
    },
    room_id: "!foo:bar",
    origin_server_ts: 123456,
    event_id: "$abc:def",
    type: "m.room.member",
});

describe("GatewayStateResolve", () => {
    let members: GatewayMUCMembership;
    beforeEach(() => {
        members = new GatewayMUCMembership();
    });
    it("will ignore a join for a room without XMPP members", () => {
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(XMPP_CHAT_NAME, members, generateMember("join", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(0);
    });
    it("will handle a Matrix join", () => {
        members.addXmppMember(XMPP_CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(XMPP_CHAT_NAME, members, generateMember("join", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(1);
        const presence = res[0] as StzaPresenceItem;
        expect(presence.to).to.equal(XMPP_MEMBER_JID.toString());
        expect(presence.from).to.equal(XMPP_CHAT_NAME + "/" + MATRIX_MEMBER_MXID);
        expect(presence.role).to.equal(PresenceRole.Participant);
        expect(presence.affiliation).to.equal(PresenceAffiliation.Member);
    });
    it("will ignore a leave for a room without XMPP members", () => {
        members.addMatrixMember(XMPP_CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(XMPP_CHAT_NAME, members, generateMember("leave", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(0);
    });
    it("will ignore a leave for a room if the matrix user wasn't joined", () => {
        members.addXmppMember(XMPP_CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(XMPP_CHAT_NAME, members, generateMember("leave", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(0);
    });
    it("will ignore a leave for a room without XMPP members", () => {
        members.addXmppMember(XMPP_CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
        members.addMatrixMember(XMPP_CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
        const res = GatewayStateResolve.resolveMatrixStateToXMPP(XMPP_CHAT_NAME, members, generateMember("leave", MATRIX_MEMBER_MXID));
        expect(res).to.have.lengthOf(1);
        const presence = res[0] as StzaPresenceItem;
        expect(presence.to).to.equal(XMPP_MEMBER_JID.toString());
        expect(presence.from).to.equal(MATRIX_MEMBER_ANONYMOUS.toString());
        expect(presence.role).to.equal(PresenceRole.None);
        expect(presence.affiliation).to.equal(PresenceAffiliation.Member);
    });
})