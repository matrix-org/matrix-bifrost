// tslint:disable: no-any
import * as Chai from "chai";
import { AutoRegistration } from "../src/AutoRegistration";
const expect = Chai.expect;

function createAR() {
    const bridge = {};
    const store = {};
    const purple = {};
    return new AutoRegistration(
        {} as any,
        bridge as any,
        store as any,
        purple as any,
    );
}

describe("AutoRegistration", () => {
    it("generateParameters", () => {
        const ar = createAR();
        const params = ar.generateParameters(
            {
                mxid_test: "<T_MXID>:foo",
                mxid_sane_test: "<T_MXID_SANE>:foo",
                domain_test: "<T_DOMAIN>:foo",
                localpart_test: "<T_LOCALPART>:foo",
                displayname_test: "<T_DISPLAYNAME>:foo",
                avatar_test: "<T_AVATAR>:foo",
            },
            "@towel:frogstar",
            {
                displayname: "FrogStar!",
                avatar_url: "mxc://pond",
            },
        );
        expect(params).to.deep.equal({
            domain_test: "frogstar:foo",
            localpart_test: "towel:foo",
            mxid_test: "@towel:frogstar:foo",
            mxid_sane_test: "towel_frogstar:foo",
            displayname_test: "FrogStar!:foo",
            avatar_test: "mxc://pond:foo",
        });
    });
});
