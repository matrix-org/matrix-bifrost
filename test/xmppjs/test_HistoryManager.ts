import { expect } from "chai";
import { MemoryStorage, HistoryManager } from "../../src/xmppjs/HistoryManager";
import { Element } from "@xmpp/xml";
import { JID } from "@xmpp/jid";

describe("HistoryManager", () => {
    describe("MemoryStorage", () => {
        it("should return filtered history", async () => {
            const historyManager = new HistoryManager(new MemoryStorage(20));
            historyManager.addMessage(
                "room1@example.org", new Element("stanza1"),
                new JID("room1", "example.org", "user1"),
            );
            historyManager.addMessage(
                "room1@example.org", new Element("stanza2"),
                new JID("room1", "example.org", "user1"),
            );
            historyManager.addMessage(
                "room1@example.org", new Element("stanza3"),
                new JID("room1", "example.org", "user1"),
            );
            historyManager.addMessage(
                "room2@example.org", new Element("stanza1"),
                new JID("room1", "example.org", "user1"),
            );

            const unfilteredRoom1 = await historyManager.getHistory("room1@example.org", {});
            expect(unfilteredRoom1.length).to.equal(3);
            const unfilteredRoom2 = await historyManager.getHistory("room2@example.org", {});
            expect(unfilteredRoom2.length).to.equal(1);

            const maxStanzasRoom1 = await historyManager.getHistory("room1@example.org", {
                maxstanzas: 2,
            });
            expect(maxStanzasRoom1.length).to.equal(2);
            const maxStanzasRoom2 = await historyManager.getHistory("room2@example.org", {
                maxstanzas: 2,
            });
            expect(maxStanzasRoom2.length).to.equal(1);

            // each stanza will be about 40 characters, so maxchars 50 should
            // only give us one stanza
            const maxCharsRoom1 = await historyManager.getHistory("room1@example.org", {
                maxchars: 50,
            });
            expect(maxCharsRoom1.length).to.equal(1);
        });
    });
});
