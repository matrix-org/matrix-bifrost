import * as Chai from "chai";
import { StzaPresenceItem, StzaPresenceError, StzaMessageSubject,
    StzaMessage, StzaPresencePart, StzaPresenceKick } from "../../src/xmppjs/Stanzas";
import * as parser from "fast-xml-parser";
const expect = Chai.expect;

function assertXML(xml) {
    const err = parser.validate(xml);
    if (err !== true) {
        console.error(xml);
        throw new Chai.AssertionError(err.err.code + ": " + err.err.msg);
    }
}

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
                + "<x xmlns='http://jabber.org/protocol/muc#user'><item affiliation='none' role='none'>"
                + "<actor nick='Kicky'/><reason>reasonable reason</reason></item><status code='110'/>"
                + "<status code='307'/></x></presence>",
            );
        });
    });
    describe("StzaMessage", () => {
        it("should create a valid stanza", () => {
            const xml = new StzaMessageSubject("foo@bar", "baz@bar", "someid", "This is a subject").xml;
            assertXML(xml);
            expect(xml).to.equal(
                "<message from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='groupchat'>"
                + "<subject>This is a subject</subject></message>",
            );
        });
    });
    describe("StzaMessageSubject", () => {
        it("should create a valid stanza for a simple plain message", () => {
            const stanza = new StzaMessage("foo@bar", "baz@bar", "someid", "groupchat");
            stanza.body = "Viva la matrix̭";
            assertXML(stanza.xml);
            expect(stanza.xml).to.equal(
                "<message from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='groupchat'>"
                + "<body>Viva la matrix&#x32D;</body></message>",
            );
        });
        it("should create a valid stanza for a html message", () => {
            const stanza = new StzaMessage("foo@bar", "baz@bar", "someid", "groupchat");
            stanza.body = "Viva la matrix̭";
            stanza.html = "<html><p><strong>Viva la</strong> matrix&#x32D;</p></html>";
            assertXML(stanza.xml);
            expect(stanza.xml).to.equal(
                "<message from=\"foo@bar\" to=\"baz@bar\" id=\"someid\" type='groupchat'><html><p>"
                + "<strong>Viva la</strong> matrix&#x32D;</p></html><body>Viva la matrix&#x32D;</body></message>",
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
                + "<x xmlns='jabber:x:oob'><url>http://matrix.org</url></x></message>",
            );
        });
    });
});
