import * as Chai from "chai";
import { Util } from "../src/Util";
import { PurpleProtocol } from "../src/purple/PurpleProtocol";
import { XMPP_PROTOCOL } from "../src/xmppjs/XJSInstance";
const expect = Chai.expect;

describe("Util", () => {
    describe("createRemoteId", () => {
        it("should create a simple remoteId", () => {
            expect(Util.createRemoteId("prpl-protocol", "simple")).to.equal("prpl-protocol://simple");
        });
    });
    describe("getMxIdForProtocol", () => {
        const protocol = new PurpleProtocol({
            id: "prpl-protocol",
            name: "Fake Protocol",
            homepage: undefined,
            summary: undefined,
        });
        it("should create a simple userId", () => {
            const mxUser = protocol.getMxIdForProtocol("simple", "example.com", "_purple_");
            expect(
                mxUser.getId(),
            ).to.equal("@_purple_protocol_simple:example.com");
        });
        it("should create a sensible userId from a sender containing url parts", () => {
            const mxUser = protocol.getMxIdForProtocol("fred@banana.com", "example.com", "_purple_");
            expect(
                mxUser.getId(),
            ).to.equal("@_purple_protocol_fred=40banana.com:example.com");
        });
        it("should create a sensible userId from a sender containing a matrix userid", () => {
            const mxUser =  protocol.getMxIdForProtocol("@fred:banana.com", "example.com", "_purple_");
            expect(
                mxUser.getId(),
            ).to.equal("@_purple_protocol_=40fred=3abanana.com:example.com");
        });
        it("should create a sensible userId for an xmpp jid", () => {
            const mxUser = XMPP_PROTOCOL.getMxIdForProtocol("frogman@frogplanet.com", "example.com", "_xmpp_");
            expect(
                mxUser.getId(),
            ).to.equal("@_xmpp_frogman=40frogplanet.com:example.com");
        });
        it("should create a sensible userId for an xmpp jid with a resource", () => {
            const mxUser = XMPP_PROTOCOL.getMxIdForProtocol(
                "frogman@frogplanet.com/frogdevice", "example.com", "_xmpp_",
            );
            expect(
                mxUser.getId(),
            ).to.equal("@_xmpp_frogdevice=2ffrogman=40frogplanet.com:example.com");
        });
        it("should create a sensible userId for an xmpp jid with a resource with special chars", () => {
            const mxUser = XMPP_PROTOCOL.getMxIdForProtocol(
                "frogman@frogplanet.com/Frog!%$£ device", "example.com", "_xmpp_",
            );
            expect(
                mxUser.getId(),
            ).to.equal("@_xmpp_Frog=21=25=24=a3=20device=2ffrogman=40frogplanet.com:example.com");
        });
    });
    describe("passwordGen", () => {
        it("should create a printable password", () => {
            const passwd = Util.passwordGen(64);
            expect(passwd.length).to.be.at.least(64);
            for (const c of passwd) {
                const i = c.charCodeAt(0);
                if (i < 32 && i > 126) {
                    throw Error("Password is not printable");
                }
            }
        });
    });
    describe("sanitizeProperties", () => {
        it("should sanitize properties", () => {
            expect(Util.sanitizeProperties({
                "my.wonderful.property": "foo",
                "normal_property": "bar",
            })).to.deep.equal({
                // tslint:disable-next-line: object-literal-key-quotes
                "my·wonderful·property": "foo",
                // tslint:disable-next-line: object-literal-key-quotes
                "normal_property": "bar",
            });
        });
    });
    describe("desanitizeProperties", () => {
        it("should desanitize properties", () => {
            expect(Util.desanitizeProperties({
                // tslint:disable-next-line: object-literal-key-quotes
                "my·wonderful·property": "foo",
                // tslint:disable-next-line: object-literal-key-quotes
                "normal_property": "bar",
            })).to.deep.equal({
                "my.wonderful.property": "foo",
                "normal_property": "bar",
            });
        });
    });
    describe("unescapeUserId", () => {
        it("should unescape QF encoding", () => {
            expect(
                Util.unescapeUserId("Hello=a3=21=25=26=20World"),
            ).to.equal("Hello£!%& World");
        });
    });
});
