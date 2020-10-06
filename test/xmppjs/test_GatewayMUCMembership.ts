import { jid } from "@xmpp/jid";
import { expect } from "chai";
import { GatewayMUCMembership } from "../../src/xmppjs/GatewayMUCMembership";

const CHAT_NAME = "mychatname";
const XMPP_MEMBER_JID = jid("xmpp_bob", "xmpp.example.com", "myresource");
const XMPP_MEMBER_JID_STRIPPED = jid("xmpp_bob", "xmpp.example.com");
const XMPP_MEMBER_JID_SECOND_DEVICE = jid("xmpp_bob", "xmpp.example.com", "myresource2");
const XMPP_MEMBER_ANONYMOUS = jid("mychatname", "xmpp.example.com", "bob");
const XMPP_MEMBER_MXID = "@_x_xmpp_bob:matrix.example.com";

const MATRIX_MEMBER_MXID = "@alice:matrix.example.com";
const MATRIX_MEMBER_ANONYMOUS = jid("mychatname", "xmpp.example.com", "alice");

describe("GatewayMUCMembership", () => {
    let members: GatewayMUCMembership;
    beforeEach(() => {
        members = new GatewayMUCMembership();
    })
    describe("adding members", () => {
        it("can add a XMPP member", () => {
            const firstDevice = members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            expect(firstDevice).to.be.true;
        });
        it("can add another device for the same XMPP member", () => {
            members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            const firstDevice = members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID_SECOND_DEVICE, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            expect(firstDevice).to.be.false;
        });
        it("can add a Matrix member", () => {
            const firstDevice = members.addMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
            expect(firstDevice).to.be.true;
        });
        it("can add another device for the same Matrix member", () => {
            members.addMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
            const firstDevice = members.addMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
            expect(firstDevice).to.be.false;
        });
    });
    describe("removing members", () => {
        it("can remove a XMPP member", () => {
            members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            const lastDevice = members.removeXmppMember(CHAT_NAME, XMPP_MEMBER_JID.toString());
            expect(lastDevice).to.be.true;
        });
        it("can add two devices, and remove one", () => {
            members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID_SECOND_DEVICE, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            let lastDevice = members.removeXmppMember(CHAT_NAME, XMPP_MEMBER_JID.toString());
            expect(lastDevice).to.be.false;
            lastDevice = members.removeXmppMember(CHAT_NAME, XMPP_MEMBER_JID_SECOND_DEVICE.toString());
            expect(lastDevice).to.be.true;
        });
        it("can remove a Matrix member", () => {
            members.addMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
            const removed = members.removeMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID);
            expect(removed).to.be.true;
        });
        it("will return false if the Matrix member was not removed", () => {
            const removed = members.removeMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID);
            expect(removed).to.be.false;
        });

    });
    describe("finding members", () => {
        it("can find an XMPP member by real JID", () => {
            members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            const member = members.getXmppMemberByRealJid(CHAT_NAME, XMPP_MEMBER_JID);
            expect(member?.realJid.toString()).to.be.equal(XMPP_MEMBER_JID_STRIPPED.toString());
            expect(member?.anonymousJid.toString()).to.be.equal(XMPP_MEMBER_ANONYMOUS.toString());
            expect(member?.matrixId).to.be.equal(XMPP_MEMBER_MXID);
            expect(member?.devices.size).to.equal(1);
            expect(member?.devices.values().next().value).to.equal(XMPP_MEMBER_JID.toString())
        });
        it("can find an XMPP member by real JID", () => {
            members.addXmppMember(CHAT_NAME, XMPP_MEMBER_JID, XMPP_MEMBER_ANONYMOUS, XMPP_MEMBER_MXID);
            const member = members.getXmppMemberByMatrixId(CHAT_NAME, XMPP_MEMBER_MXID);
            expect(member?.realJid.toString()).to.be.equal(XMPP_MEMBER_JID_STRIPPED.toString());
            expect(member?.anonymousJid.toString()).to.be.equal(XMPP_MEMBER_ANONYMOUS.toString());
            expect(member?.matrixId).to.be.equal(XMPP_MEMBER_MXID);
            expect(member?.devices.size).to.equal(1);
            expect(member?.devices.values().next().value).to.equal(XMPP_MEMBER_JID.toString())
        });
        it("can find a Matrix member by mxId", () => {
            members.addMatrixMember(CHAT_NAME, MATRIX_MEMBER_MXID, MATRIX_MEMBER_ANONYMOUS);
            const member = members.getMatrixMemberByMatrixId(CHAT_NAME, MATRIX_MEMBER_MXID);
            expect(member?.type).to.equal("matrix");
            expect(member?.anonymousJid.toString()).to.be.equal(MATRIX_MEMBER_ANONYMOUS.toString());
            expect(member?.matrixId).to.be.equal(MATRIX_MEMBER_MXID);
        });
    });
})