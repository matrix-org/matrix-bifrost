import * as Chai from "chai";
import { PurpleProtocol } from "../src/purple/PurpleInstance";
import { MessageFormatter } from "../src/MessageFormatter";
const expect = Chai.expect;

const dummyProtocol = new PurpleProtocol({
    id: "prpl-dummy",
    name: "Dummy",
    homepage: undefined,
    summary: undefined,
});
const XMPP = new PurpleProtocol({
    id: "prpl-jabber",
    name: "XMPP",
    homepage: undefined,
    summary: undefined,
});

describe("MessageFormatter", () => {
    describe("messageToMatrixEvent", () => {
        it("should transform an ordinary message to plaintext", () => {
            const contents = MessageFormatter.messageToMatrixEvent("This is an ordinary message", dummyProtocol);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                body: "This is an ordinary message",
            });
        });
        it("XMPP: should transform an ordinary message to plaintext", () => {
            const contents = MessageFormatter.messageToMatrixEvent("This is an ordinary message", XMPP);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                body: "This is an ordinary message",
            });
        });
        it("XMPP: should transform an HTML message to Matrix HTML", () => {
            const contents = MessageFormatter.messageToMatrixEvent(
`<html xmlns='http://jabber.org/protocol/xhtml-im'>
    <body xmlns='http://www.w3.org/1999/xhtml'>
        <p>
            <span style='font-family: Helvetica; font-size: x-large;'>hello halfshot!</span>
        </p>
    </body>
</html>`,
                XMPP,
            );
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                format: "org.matrix.custom.html",
            formatted_body: "<p><span style='font-family: Helvetica; font-size: x-large;'>hello halfshot!<\\span><\\p>",
                body: "## hello halfshot!",
            });
        });
    });
});
