import * as Chai from "chai";
import { PresenceCache } from "../../src/xmppjs/PresenceCache";
import { jid } from "@xmpp/component";
import { x } from "@xmpp/xml";
import {  StzaPresenceItem } from "../../src/xmppjs/Stanzas";
const expect = Chai.expect;

describe("Stanzas", () => {
    describe("StzaPresence", () => {
        it("should create a valid <presence> stanza", () => {
            expect(new StzaPresenceItem("foo@bar", "baz@bar", "someid").xml).to.equal(
`<presence from='foo@bar' to='baz@bar' id='someid' >
     <x xmlns='http://jabber.org/protocol/muc'/>
     <item affiliation='member' role='participant'/>
</presence>`,
);
        });
    });
});
