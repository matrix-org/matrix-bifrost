import * as Chai from "chai";
import { StzaPresenceItem, StzaPresenceError, StzaMessageSubject,
    StzaMessage, StzaPresencePart, StzaPresenceKick, SztaIqError } from "../../src/xmppjs/Stanzas";
import { assertXML } from "./util";
const expect = Chai.expect;

describe("Stanzas", () => {
    describe("StzaPresenceItem", () => {
        it("should create a valid stanza", () => {
            const xml = new StzaPresenceItem("foo@bar", "baz@bar", "someid").xml;
            assertXML(xml);
            expect(xml).to.equal(
                "<presence from=\"foo@bar\" to=\"baz@bar\" id=\"someid\">" +
                "<x xmlns='http://jabber.org/protocol/muc#user'>"
                + "<item affiliation='member' role='participant'/></x></presence>",
            );
        });
    });
    describe("StzaPresenceError", () => {
        it("should create a valid stanza", () => {
            const xml = new StzaPresenceError("foo@bar", "baz@bar", "someid", "baz2@bar", "cancel", "inner-error").xml;
            assertXML(xml);
            expect(xml).to.equal(
                "<presence from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='error'><x"
                + " xmlns='http://jabber.org/protocol/muc'/><error type='cancel' by='baz2@bar'>"
                + "<inner-error xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></presence>",
            );
        });
    });
    describe("StzaPresencePart", () => {
        it("should create a valid stanza", () => {
            const xml = new StzaPresencePart("foo@bar", "baz@bar").xml;
            assertXML(xml);
            expect(xml).to.equal(
                "<presence from=\"foo@bar\" to=\"baz@bar\" type='unavailable'></presence>",
            );
        });
    });
    describe("StzaPresenceKick", () => {
        it("should create a valid stanza", () => {
            const xml = new StzaPresenceKick("foo@bar", "baz@bar", "reasonable reason", "Kicky", true).xml;
            assertXML(xml);
            expect(xml).to.equal(
                `<presence from="foo@bar" to="baz@bar" type='unavailable'>`
                + "<x xmlns='http://jabber.org/protocol/muc#user'><status code='110'/>"
                + "<status code='307'/><item affiliation='none' role='none'>"
                + "<actor nick='Kicky'/><reason>reasonable reason</reason></item></x></presence>",
            );
        });
    });
    describe("StzaMessage", () => {
        it("should create a valid stanza for a simple plain message", () => {
            const stanza = new StzaMessage("foo@bar", "baz@bar", "someid", "groupchat");
            stanza.body = "Viva la matrix̭";
            assertXML(stanza.xml);
            expect(stanza.xml).to.equal(
                "<message from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='groupchat'>"
                + "<body>Viva la matrix&#813;</body><markable xmlns='urn:xmpp:chat-markers:0'/></message>",
            );
        });
        it("should create a valid stanza for a html message", () => {
            const stanza = new StzaMessage("foo@bar", "baz@bar", "someid", "groupchat");
            stanza.body = "Viva la matrix̭";
            stanza.html = "<html><p><strong>Viva la</strong> matrix&#813;</p></html>";
            assertXML(stanza.xml);
            expect(stanza.xml).to.equal(
                "<message from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='groupchat'><html><p>"
                + "<strong>Viva la</strong> matrix&#813;</p></html><body>Viva la matrix&#813;</body>"
                + "<markable xmlns='urn:xmpp:chat-markers:0'/></message>",
            );
        });
        it("should create a valid stanza for a message with attachments", () => {
            const stanza = new StzaMessage("foo@bar", "baz@bar", "someid", "groupchat");
            stanza.body = "Viva la matrix̭";
            stanza.html = "<html><p><strong>Viva la</strong> matrix&#x32D;</p></html>";
            stanza.attachments = ["http://matrix.org"];
            assertXML(stanza.xml);
            expect(stanza.xml).to.equal(
                "<message from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='groupchat'><html><p>"
                + "<strong>Viva la</strong> matrix&#x32D;</p></html><body>http://matrix.org</body>"
                + "<x xmlns='jabber:x:oob'><url>http://matrix.org</url></x>"
                + "<markable xmlns='urn:xmpp:chat-markers:0'/></message>",
            );
        });
    });
    describe("StzaMessageSubject", () => {
        it("should create a valid stanza", () => {
            const xml = new StzaMessageSubject("foo@bar", "baz@bar", "someid", "This is a subject").xml;
            assertXML(xml);
            expect(xml).to.equal(
                "<message from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='groupchat'>"
                + "<subject>This is a subject</subject></message>",
            );
        });
    });
    describe("SztaIqError", () => {
        it("should create a an error", () => {
            const xml = new SztaIqError("foo@bar", "baz@bar", "someid", "cancel", null, "not-acceptable", "foo").xml;
            assertXML(xml);
            expect(xml).to.equal(
                "<iq from='foo@bar' to='baz@bar' id='someid' type='error' xml:lang='en'>" +
                 "<error type='cancel' by='foo'><not-acceptable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>" +
                 "</error></iq>",
            );
        });
    });
    it("should create a an error with custom text", () => {
        const xml = new SztaIqError("foo@bar", "baz@bar", "someid", "cancel", null, "not-acceptable", "foo", "Something isn't right").xml;
        assertXML(xml);
        expect(xml).to.equal(
            "<iq from='foo@bar' to='baz@bar' id='someid' type='error' xml:lang='en'>" +
             "<error type='cancel' by='foo'><not-acceptable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/>" +
             `<text xmlns="urn:ietf:params:xml:ns:xmpp-stanzas">Something isn&apos;t right</text>` +
             "</error></iq>",
        );
    });
});
