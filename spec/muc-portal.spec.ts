import { describe, expect } from "vitest";
import { xml } from "@xmpp/client";
import { test as baseTest } from "./util/fixtures";
import { XMPP_MUC_DOMAIN } from "./util/containers/prosody";

const MUC_ROOM_LOCALPART = "e2eroom";
const MUC_ROOM_NAME = "E2E Test Room";
const MUC_ROOM_JID = `${MUC_ROOM_LOCALPART}@${XMPP_MUC_DOMAIN}`;

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

describe("XMPP MUC portal rooms", () => {
    test("names the Matrix portal room after the MUC's disco#info identity name", async ({ testEnv, alice }) => {
        // Join the MUC as its first occupant (making us the owner), then set the room's
        // human-readable name via the XEP-0045 configuration form. That name ends up in
        // the MUC's disco#info identity, which the bridge reads to name the portal room.
        await testEnv.xmpp.send(xml(
            "presence",
            { to: `${MUC_ROOM_JID}/owner` },
            xml("x", { xmlns: "http://jabber.org/protocol/muc" }),
        ));
        await testEnv.xmpp.iqCaller.request(xml(
            "iq",
            { type: "set", to: MUC_ROOM_JID },
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
                        xml("value", {}, MUC_ROOM_NAME),
                    ),
                ),
            ),
        ));

        const roomName = alice.waitForRoomEvent({
            eventType: "m.room.name", sender: testEnv.botMxid, stateKey: "",
        });

        await alice.joinRoom(`#_bifrost_${MUC_ROOM_LOCALPART}:${testEnv.serverName}`);

        const { data } = await roomName;
        expect((data.content as { name: string }).name).toEqual(MUC_ROOM_NAME);
    });
});
