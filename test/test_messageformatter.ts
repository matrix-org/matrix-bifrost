import * as Chai from "chai";
import { BifrostProtocol } from "../src/bifrost/Protocol";
import { MessageFormatter } from "../src/MessageFormatter";
import { dummyProtocol } from "./mocks/dummyprotocol";
const expect = Chai.expect;

const XMPP = new BifrostProtocol({
    id: "prpl-jabber",
    name: "XMPP",
    homepage: undefined,
    summary: undefined,
});

const intent = {
    uploadContent: async () => "mxc://abc/def",
    getClient: () => ({
        getMediaConfig: async () => ({"m.upload.size": 1024}),
    }),
} as any;

describe("MessageFormatter", () => {
    describe("matrixEventToBody", () => {
        it("should transform a plain text message to a basic body", () => {
            const msg = MessageFormatter.matrixEventToBody({
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
        it("should transform a formatted message", () => {
            const msg = MessageFormatter.matrixEventToBody({
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
        it("should transform an info-less media event", () => {
            const msg = MessageFormatter.matrixEventToBody({
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
        it("should transform a media event", () => {
            const msg = MessageFormatter.matrixEventToBody({
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
        it("should transform a emote message to a basic body", () => {
            const msg = MessageFormatter.matrixEventToBody({
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

    describe("messageToMatrixEvent", async () => {
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
        it("should transform a html message", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {
                    body: "wags tail",
                    formatted: [
                        {
                            type: "html",
                            body: "<body><span>Hi</span></body>",
                        },
                    ],
                },
            dummyProtocol);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                body: "wags tail",
                format: "org.matrix.custom.html",
                formatted_body: "<body><span>Hi</span></body>",
            });
        });
        it("should ignore an attachment without http", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {body: "awoo", opts: {
                    attachments: [{uri: "fake://thing"}],
                }},
            dummyProtocol, intent);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.text",
                body: "awoo",
            });
        });
        it("should handle an attachment using http", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {body: "awoo", opts: {
                    attachments: [{uri: "https://matrix.org/blog/wp-content/uploads/2015/01/logo1.png"}],
                }},
            dummyProtocol, intent);
            expect(
                contents,
            ).to.deep.equal({
                msgtype: "m.image",
                filename: "logo1.png",
                url: "mxc://abc/def",
                info: {
                    mimetype: "image/png",
                    size: 2239,
                },
                body: "awoo",
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
        it("should transform an edited message", async () => {
            const contents = await MessageFormatter.messageToMatrixEvent(
                {
                    body: "This is an edited message",
                    original_message: "This is the original message",
                },
            dummyProtocol);
            expect(
                contents,
            ).to.deep.equal({
                "msgtype": "m.text",
                "body": " * This is an edited message",
                "format": undefined,
                "formatted_body": undefined,
                "m.new_content": {
                  "body": "This is an edited message",
                  "msgtype": "m.text",
                },
                "m.relates_to": {
                  event_id: "This is the original message",
                  rel_type: "m.replace",
                },
            });
        });
    });
});
