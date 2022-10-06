/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Chai from "chai";
import { Config } from "../../src/Config";
import { XmppJsInstance, XMPP_PROTOCOL } from "../../src/xmppjs/XJSInstance";

const expect = Chai.expect;

describe("XJSInstance", () => {
    let config: Config;
    before(() => {
        config = new Config();
        config.ApplyConfig({
            purple: {
                backendOpts: {}
            }
        });
    })
    it("should match an xmpp username", () => {
        const instance = new XmppJsInstance(config, {} as any);
        const res = instance.getUsernameFromMxid("@_xmpp_frogman=40frogplanet.com:example.com", "_xmpp_");
        expect(res.protocol).to.equal(XMPP_PROTOCOL);
        expect(res.username).to.equal("frogman@frogplanet.com");
    });

    it("should match an xmpp username with a resource", () => {
        const instance = new XmppJsInstance(config, {} as any);
        const res = instance.getUsernameFromMxid("@_xmpp_frogdevice=2ffrogman=40frogplanet.com:example.com", "_xmpp_");
        expect(res.protocol).to.equal(XMPP_PROTOCOL);
        expect(res.username).to.equal("frogman@frogplanet.com/frogdevice");
    });

    it("should be able to transform a xmpp username to a mxid and back", () => {
        const username = "frogman@frogplanet.com/frog$£!%& device";
        const instance = new XmppJsInstance(config, {} as any);
        const mxUser = XMPP_PROTOCOL.getMxIdForProtocol(
            username, "example.com", "_xmpp_",
        ).userId;
        const res = instance.getUsernameFromMxid(
            mxUser, "_xmpp_",
        );
        expect(res.protocol).to.equal(XMPP_PROTOCOL);
        expect(res.username).to.equal(username);
    });
});
