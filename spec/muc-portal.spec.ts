import { describe, expect } from "vitest";
import { xml, client as xmppClient } from "@xmpp/client";
import { test as baseTest } from "./util/fixtures";
import { XMPP_MUC_DOMAIN } from "./util/containers/prosody";

const MUC_ROOM_LOCALPART = "e2eroom";
const MUC_ROOM_NAME = "E2E Test Room";
const MUC_ROOM_JID = `${MUC_ROOM_LOCALPART}@${XMPP_MUC_DOMAIN}`;

const TOPIC_MUC_ROOM_LOCALPART = "e2eroom-topic";
const TOPIC_MUC_ROOM_NAME = "E2E Topic Test Room";
const TOPIC_MUC_ROOM_JID = `${TOPIC_MUC_ROOM_LOCALPART}@${XMPP_MUC_DOMAIN}`;
const MUC_SUBJECT = "Welcome to the test room";

const test = baseTest.override("testEnvOpts", () => ({
    config: {
        portals: {
            aliases: {
                "^_bifrost_(.+)$": {
                    protocol: "xmpp-js",
                    properties: {
                        room: "regex:1",
                        server: XMPP_MUC_DOMAIN,
                    },
                },
            },
        },
    },
}));

/**
 * Joins a MUC as its first occupant (making the client the owner) and sets the room's
 * human-readable name via the XEP-0045 configuration form, so the bridge's disco#info-based
 * portal naming has something to read.
 */
async function joinAsOwnerAndSetName(xmpp: ReturnType<typeof xmppClient>, mucJid: string, name: string) {
    await xmpp.send(xml(
        "presence",
        { to: `${mucJid}/owner` },
        xml("x", { xmlns: "http://jabber.org/protocol/muc" }),
    ));
    await xmpp.iqCaller.request(xml(
        "iq",
        { type: "set", to: mucJid },
        xml(
            "query",
            { xmlns: "http://jabber.org/protocol/muc#owner" },
            xml(
                "x",
                { xmlns: "jabber:x:data", type: "submit" },
                xml(
                    "field",
                    { var: "FORM_TYPE", type: "hidden" },
                    xml("value", {}, "http://jabber.org/protocol/muc#roomconfig"),
                ),
                xml(
                    "field",
                    { var: "muc#roomconfig_roomname" },
                    xml("value", {}, name),
                ),
            ),
        ),
    ));
}

describe("XMPP MUC portal rooms", () => {
    test("names the Matrix portal room after the MUC's disco#info identity name", async ({ testEnv, alice }) => {
        await joinAsOwnerAndSetName(testEnv.xmpp, MUC_ROOM_JID, MUC_ROOM_NAME);

        const roomName = alice.waitForRoomEvent({
            eventType: "m.room.name", sender: testEnv.botMxid, stateKey: "",
        });

        await alice.joinRoom(`#_bifrost_${MUC_ROOM_LOCALPART}:${testEnv.serverName}`);

        const { data } = await roomName;
        expect((data.content as { name: string }).name).toEqual(MUC_ROOM_NAME);
    });

    test("keeps a portal room's existing name when the MUC subject is delivered on join", async ({ testEnv, alice }) => {
        // A MUC redelivers its current subject to every newly-joining occupant - including the
        // bridge's own ghost, joining on Alice's behalf as she joins the portal. handleTopic used
        // to treat that redelivery as a rename, resetting the room's name (set here from the MUC's
        // disco#info identity, same as the previous test) back to the raw MUC JID every time.
        await joinAsOwnerAndSetName(testEnv.xmpp, TOPIC_MUC_ROOM_JID, TOPIC_MUC_ROOM_NAME);
        await testEnv.xmpp.send(xml(
            "message",
            { type: "groupchat", to: TOPIC_MUC_ROOM_JID },
            xml("subject", {}, MUC_SUBJECT),
        ));

        // Registered before joining so we don't lose the topic event to a race.
        const topicSet = alice.waitForRoomEvent({
            eventType: "m.room.topic", sender: testEnv.botMxid, stateKey: "",
        });

        await alice.joinRoom(`#_bifrost_${TOPIC_MUC_ROOM_LOCALPART}:${testEnv.serverName}`);

        const { roomId, data } = await topicSet;
        expect((data.content as { topic: string }).topic).toEqual(MUC_SUBJECT);

        const nameContent = await alice.getRoomStateEvent(roomId, "m.room.name", "") as { name: string };
        expect(nameContent.name).toEqual(TOPIC_MUC_ROOM_NAME);
    });
});
