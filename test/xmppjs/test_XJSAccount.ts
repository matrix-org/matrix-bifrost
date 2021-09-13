/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Chai from "chai";
import { XmppJsAccount } from "../../src/xmppjs/XJSAccount";
import { IBasicProtocolMessage } from "../../src/MessageFormatter";
import { MockXJSInstance } from "../mocks/XJSInstance";

const expect = Chai.expect;

let acct: XmppJsAccount;
const instance = new MockXJSInstance();
instance.accountUsername = "bob@matrix.localhost";

function createXJSAccount() {
    return new XmppJsAccount(
        "bob@matrix.localhost",
        "matrix-bridge",
        instance as any,
        "@bob:localhost",
    );
}

describe("XJSAccount", () => {

    beforeEach(() => {
        acct = createXJSAccount();
    });

    it("should have the correct property values on construction", () => {
        expect(acct.connected).to.be.true;
        expect(acct.remoteId).to.be.equal("bob@matrix.localhost");
        expect(acct.roomHandles).to.be.empty;
    });

    describe("sendIM", () => {
        it("should be able to send a basic message", () => {
            acct.sendIM("alice@remote.server", {
                body: "Hello!",
                id: "12345",
            } as IBasicProtocolMessage);
            expect(instance.sentMessageIDs).to.include("12345");
            expect(instance.sentMessages[0]).to.deep.equal({
                hFrom: "bob@matrix.localhost/matrix-bridge",
                hTo: "alice@remote.server",
                messageType: "chat",
                hId: "12345",
                html: "",
                body: "Hello!",
                markable: true,
                attachments: [],
            });
        });
    });

    describe("joinChat", () => {
        it("should be able to join a chat", async () => {
            await acct.joinChat({
                room: "den",
                server: "remote.server",
                handle: "Bob",
            }, instance as any, 50, true);
        });

        it("should fail to join a chat without the required components", async () => {
            try {
                await acct.joinChat({
                    room: "den",
                    server: "remote.server",
                }, instance as any, 50, true);
            } catch (ex) {
                expect(ex.message).to.equal("Missing handle");
                return;
            }
            throw Error("Didn't throw");
        });

    });

    afterEach(() => {
        acct.stop();
    });
});
