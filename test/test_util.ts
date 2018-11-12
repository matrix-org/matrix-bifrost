import * as Chai from "chai";
import { Util } from "../src/Util";
import { PurpleProtocol } from "../src/purple/PurpleInstance";
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
        });
        it("should create a simple userId", () => {
            const mxUser = Util.getMxIdForProtocol(protocol, "simple", "example.com", "_purple_");
            expect(
                mxUser.getId(),
            ).to.equal("@_purple_protocol_simple:example.com");
        });
        it("should create a sensible userId from a sender containing url parts", () => {
            const mxUser = Util.getMxIdForProtocol(protocol, "fred@banana.com", "example.com", "_purple_");
            expect(
                mxUser.getId(),
            ).to.equal("@_purple_protocol_fred=40banana.com:example.com");
        });
        it("should create a sensible userId from a sender containing a matrix userid", () => {
            const mxUser = Util.getMxIdForProtocol(protocol, "@fred:banana.com", "example.com", "_purple_");
            expect(
                mxUser.getId(),
            ).to.equal("@_purple_protocol_=40fred=3abanana.com:example.com");
        });
    });
});
