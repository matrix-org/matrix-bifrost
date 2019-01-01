import * as Chai from "chai";
import { PurpleProtocol } from "../src/purple/PurpleProtocol";
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
    describe("matrixEventToBody", () => {
        it("should transform a plain text message to a basic body", async () => {
            const msg = await MessageFormatter.matrixEventToBody({
                sender: "@foo:bar",
                event_id: "$event:bar",
                content: {
                    body: "This is some plaintext!",
                    msgtype: "m.text",
                },
                type: "m.room.message",
                origin_server_ts: 0,
                room_id: "!roomid:bar",
            }, {
                domain: "bar",
                homeserverUrl: "http://bar",
                userPrefix: "_xmpp",
            });
            expect(msg).to.deep.eq({
                body: "This is some plaintext!",
                formatted: [],
                id: "$event:bar",
            });
        });
        it("should transform a formatted message", async () => {
            const msg = await MessageFormatter.matrixEventToBody({
                sender: "@foo:bar",
                event_id: "$event:bar",
                content: {
                    body: "This is some plaintext!",
                    formatted_body: "<em>This</em> is some <b>plaintext</b>!",
                    format: "org.matrix.custom.html",
                    msgtype: "m.text",
                },
                type: "m.room.message",
                origin_server_ts: 0,
                room_id: "!roomid:bar",
            }, {
                domain: "bar",
                homeserverUrl: "http://bar",
                userPrefix: "_xmpp",
            });
            expect(msg).to.deep.eq({
                body: "This is some plaintext!",
                formatted: [{
                    type: "html",
                    body: "<em>This</em> is some <b>plaintext</b>!",
                }],
                id: "$event:bar",
            });
        });
        it("should transform an info-less media event", async () => {
            const msg = await MessageFormatter.matrixEventToBody({
                sender: "@foo:bar",
                event_id: "$event:bar",
                content: {
                    body: "image.jpg",
                    url: "mxc://bar/foosdsd",
                    msgtype: "m.image",
                },
                type: "m.room.message",
                origin_server_ts: 0,
                room_id: "!roomid:bar",
            }, {
                domain: "bar",
                homeserverUrl: "http://bar",
                userPrefix: "_xmpp",
            });
            expect(msg).to.deep.eq({
                body: "image.jpg",
                opts: {
                    attachments: [
                        {
                            mimetype: undefined,
                            size: undefined,
                            uri: "http://bar/_matrix/media/v1/download/bar/foosdsd",
                        },
                    ],
                },
                id: "$event:bar",
            });
        });
        it("should transform a media event", async () => {
            const msg = await MessageFormatter.matrixEventToBody({
                sender: "@foo:bar",
                event_id: "$event:bar",
                content: {
                    body: "image.jpg",
                    url: "mxc://bar/foosdsd",
                    msgtype: "m.image",
                    info: {
                        mimetype: "image/jpeg",
                        size: 1000,
                    },
                },
                type: "m.room.message",
                origin_server_ts: 0,
                room_id: "!roomid:bar",
            }, {
                domain: "bar",
                homeserverUrl: "http://bar",
                userPrefix: "_xmpp",
            });
            expect(msg).to.deep.eq({
                body: "image.jpg",
                opts: {
                    attachments: [
                        {
                            mimetype: "image/jpeg",
                            size: 1000,
                            uri: "http://bar/_matrix/media/v1/download/bar/foosdsd",
                        },
                    ],
                },
                id: "$event:bar",
            });
        });
        it("should transform a emote message to a basic body", async () => {
            const msg = await MessageFormatter.matrixEventToBody({
                sender: "@foo:bar",
                event_id: "$event:bar",
                content: {
                    body: "pets the dog",
                    msgtype: "m.emote",
                },
                type: "m.room.message",
                origin_server_ts: 0,
                room_id: "!roomid:bar",
            }, {
                domain: "bar",
                homeserverUrl: "http://bar",
                userPrefix: "_xmpp",
            });
            expect(msg).to.deep.eq({
                body: "/me pets the dog",
                formatted: [],
                id: "$event:bar",
            });
        });
    });

    describe("messageToMatrixEvent", () => {
        it("should transform an ordinary message to plaintext", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {body: "This is an ordinary message"},
            dummyProtocol);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                body: "This is an ordinary message",
            });
        });
        it("should transfer a id to the matrix message", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {
                    body: "This is an ordinary message",
                    id: "foobarID",
                },
            dummyProtocol);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                remote_id: "foobarID",
                body: "This is an ordinary message",
            });
        });
        it("should transform an /me to m.emote", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {body: "/me wags tail"},
            dummyProtocol);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.emote",
                body: "wags tail",
            });
        });
        it("should ignore an attachment", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {body: "/me wags tail"},
            dummyProtocol);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.emote",
                body: "wags tail",
            });
        });
        it("prpl-jabber: should transform an ordinary message to plaintext", async () => {
            const contents =  await MessageFormatter.messageToMatrixEvent({body: "This is an ordinary message"}, XMPP);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                body: "This is an ordinary message",
            });
        });
        it("prpl-jabber: should transform arrow bracketed plaintext to plaintext", async () => {
            const contents =  await MessageFormatter.messageToMatrixEvent({body: "<This is an ordinary message"}, XMPP);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                body: "<This is an ordinary message",
            });
        });
        it("prpl-jabber: should transform an HTML message to Matrix HTML", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent({
body: `<html xmlns='http://jabber.org/protocol/xhtml-im'>
    <body xmlns='http://www.w3.org/1999/xhtml'>
        <p>
            <span style='font-family: Helvetica; font-size: x-large;'>hello halfshot!</span>
        </p>
    </body>
</html>`},
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
