import { describe, expect } from "vitest";
import { xml } from "@xmpp/client";
import { test as baseTest } from "./util/fixtures";
import { XMPP_COMPONENT_DOMAIN } from "./util/containers/prosody";
import { createPublicRoom, roomJid } from "./util/gateway";
import type { BifrostTestEnvOpts } from "./util/bifrost-env";

// Gateway room discovery (ServiceHandler's disco#items/disco#info handling for gateway room
// JIDs) only runs when portals.enableGateway is set - see XJSInstance#preStart.
const test = baseTest.override("testEnvOpts", {
    config: {
        portals: { enableGateway: true },
    },
} as BifrostTestEnvOpts);

describe("XMPP gateway", () => {
    test("lists public Matrix rooms via disco#items", async ({ testEnv, alice }) => {
        const alias = await createPublicRoom(testEnv, alice, "disco-items-room", "Disco Items Room");

        const response = await testEnv.xmpp.iqCaller.request(xml(
            "iq",
            { type: "get", to: XMPP_COMPONENT_DOMAIN, from: testEnv.xmpp.jid?.toString() },
            xml("query", { xmlns: "http://jabber.org/protocol/disco#items" }),
        ));

        const items = response.getChild("query", "http://jabber.org/protocol/disco#items")?.getChildren("item") ?? [];
        const item = items.find((i) => i.attrs.jid === roomJid(alias));
        expect(item).toBeDefined();
        expect(item?.attrs.name).toEqual("Disco Items Room");
    });

    test("returns search fields for a jabber:iq:search 'get' request", async ({ testEnv }) => {
        const response = await testEnv.xmpp.iqCaller.request(xml(
            "iq",
            { type: "get", to: XMPP_COMPONENT_DOMAIN, from: testEnv.xmpp.jid?.toString() },
            xml("query", { xmlns: "jabber:iq:search" }),
        ));

        const query = response.getChild("query", "jabber:iq:search");
        expect(query?.getChild("instructions")).toBeDefined();
        expect(query?.getChild("Term")).toBeDefined();
        expect(query?.getChild("Homeserver")).toBeDefined();
    });

    test("finds a public room by search term via jabber:iq:search", async ({ testEnv, alice }) => {
        const alias = await createPublicRoom(testEnv, alice, "search-findme-room", "Findable Room");

        const response = await testEnv.xmpp.iqCaller.request(xml(
            "iq",
            { type: "set", to: XMPP_COMPONENT_DOMAIN, from: testEnv.xmpp.jid?.toString() },
            xml("query", { xmlns: "jabber:iq:search" }, xml("Term", {}, "Findable Room")),
        ));

        const items = response.getChild("query", "jabber:iq:search")?.getChildren("item") ?? [];
        expect(items.some((i) => i.attrs.jid === roomJid(alias))).toEqual(true);
    });

    test("returns disco#info for a gateway room JID, naming it after the Matrix room", async ({ testEnv, alice }) => {
        const alias = await createPublicRoom(testEnv, alice, "disco-info-room", "Disco Info Room");

        const response = await testEnv.xmpp.iqCaller.request(xml(
            "iq",
            { type: "get", to: roomJid(alias), from: testEnv.xmpp.jid?.toString() },
            xml("query", { xmlns: "http://jabber.org/protocol/disco#info" }),
        ));

        const identities = response.getChild("query", "http://jabber.org/protocol/disco#info")
            ?.getChildren("identity") ?? [];
        const conference = identities.find((i) => i.attrs.category === "conference");
        const gateway = identities.find((i) => i.attrs.category === "gateway");
        expect(conference?.attrs.name).toEqual("Disco Info Room");
        expect(gateway?.attrs.name).toEqual(alias);
    });

    test("returns item-not-found for a gateway room JID with no matching Matrix alias", async ({ testEnv }) => {
        const to = roomJid(`#does-not-exist:${testEnv.serverName}`);

        await expect(testEnv.xmpp.iqCaller.request(xml(
            "iq",
            { type: "get", to, from: testEnv.xmpp.jid?.toString() },
            xml("query", { xmlns: "http://jabber.org/protocol/disco#info" }),
        ))).rejects.toMatchObject({ condition: "item-not-found" });
    });
});
