import { describe, expect } from "vitest";
import { xml } from "@xmpp/client";
import { test as baseTest } from "./util/fixtures";
import { XMPP_C2S_DOMAIN, XMPP_TEST_USER } from "./util/containers/prosody";
import { ghostMxidForXmppUser } from "./util/bifrost-env";
import type { BifrostTestEnvOpts } from "./util/bifrost-env";
import {
    createPublicRoom, roomJid, waitForStanza, collectStanzas, isDelayedGroupchatMessage,
    joinGateway, leaveGateway,
} from "./util/gateway";

// Gateway room support only runs when portals.enableGateway is set - see XJSInstance#preStart.
const test = baseTest.override("testEnvOpts", {
    config: {
        portals: { enableGateway: true },
    },
} as BifrostTestEnvOpts);

describe("XMPP gateway history backfill", () => {
    test("replays cached messages, in order, to an XMPP user rejoining a history-visible room", async ({ testEnv, alice }) => {
        const bobNick = "bob";
        const bobBareJid = `${XMPP_TEST_USER}@${XMPP_C2S_DOMAIN}`;
        const bobGhostMxid = ghostMxidForXmppUser(testEnv.serverName, bobBareJid);

        // Gives Alice's occupant nick in the gateway room a stable value (otherwise it falls
        // back to her raw mxid - see GatewayStateResolve#resolveMatrixStateToXMPP).
        await alice.setDisplayName("Alice");
        // public_chat defaults history_visibility to "shared", which is what makes the gateway
        // consider this room's history safe to replay to XMPP joiners - see
        // GatewayHandler#getVirtualRoom's allowHistory computation.
        const alias = await createPublicRoom(testEnv, alice, "gateway-history-room", "Gateway History Room");
        const roomId = await alice.resolveRoom(alias);
        const chatJid = roomJid(alias);
        const joinTo = `${chatJid}/${bobNick}`;

        await joinGateway(testEnv, joinTo);

        // Three messages, alternating sender, land while Bob is present - each is cached as it
        // is relayed (XJSGateway#sendMatrixMessage / #reflectXMPPMessage).
        const firstToXmpp = waitForStanza(
            testEnv.xmpp, "first live message", (s) => s.is("message") && s.getChildText("body") === "first message",
        );
        await alice.sendMessage(roomId, { msgtype: "m.text", body: "first message" });
        await firstToXmpp;

        const secondToMatrix = alice.waitForRoomEvent({ eventType: "m.room.message", sender: bobGhostMxid, roomId });
        await testEnv.xmpp.send(xml(
            "message", { type: "groupchat", to: chatJid, from: testEnv.xmpp.jid?.toString() },
            xml("body", {}, "second message"),
        ));
        await secondToMatrix;

        const thirdToXmpp = waitForStanza(
            testEnv.xmpp, "third live message", (s) => s.is("message") && s.getChildText("body") === "third message",
        );
        await alice.sendMessage(roomId, { msgtype: "m.text", body: "third message" });
        await thirdToXmpp;

        // Bob leaves and rejoins - a fresh join, so any backfill he receives must come from the
        // history cache rather than just being live traffic he was already subscribed to.
        await leaveGateway(testEnv, joinTo);

        const history = collectStanzas(
            testEnv.xmpp, "replayed history on rejoin", isDelayedGroupchatMessage, 3,
        );
        await joinGateway(testEnv, joinTo);
        const [first, second, third] = await history;

        expect(first.getChildText("body")).toEqual("first message");
        expect(first.attrs.from).toEqual(`${chatJid}/Alice`);
        expect(second.getChildText("body")).toEqual("second message");
        expect(second.attrs.from).toEqual(`${chatJid}/${bobNick}`);
        expect(third.getChildText("body")).toEqual("third message");
        expect(third.attrs.from).toEqual(`${chatJid}/Alice`);

        for (const message of [first, second, third]) {
            const stamp = message.getChild("delay", "urn:xmpp:delay")?.attrs.stamp;
            expect(new Date(stamp).toString()).not.toEqual("Invalid Date");
        }
    });

    test("does not replay history into a room whose history visibility isn't shared", async ({ testEnv, alice }) => {
        const bobNick = "bob";
        await alice.setDisplayName("Alice");
        const alias = await createPublicRoom(testEnv, alice, "gateway-private-history-room", "Gateway Private History Room");
        const roomId = await alice.resolveRoom(alias);
        // Flip history_visibility before anyone joins over the gateway, so the very first
        // GatewayHandler#getVirtualRoom hydration (uncached) picks it up as unsafe to replay.
        await alice.sendStateEvent(roomId, "m.room.history_visibility", "", { history_visibility: "joined" });
        const chatJid = roomJid(alias);
        const joinTo = `${chatJid}/${bobNick}`;

        await joinGateway(testEnv, joinTo);

        const messageDelivered = waitForStanza(
            testEnv.xmpp, "live message", (s) => s.is("message") && s.getChildText("body") === "should stay private",
        );
        await alice.sendMessage(roomId, { msgtype: "m.text", body: "should stay private" });
        await messageDelivered;

        await leaveGateway(testEnv, joinTo);

        const history = collectStanzas(
            testEnv.xmpp, "replayed history on rejoin (should not happen)", isDelayedGroupchatMessage, 1, 3000,
        );
        await joinGateway(testEnv, joinTo);
        await expect(history).rejects.toThrow();
    });

    test("picks up a live history_visibility change without a restart, only caching what followed it", async ({ testEnv, alice }) => {
        const bobNick = "bob";
        await alice.setDisplayName("Alice");
        const alias = await createPublicRoom(testEnv, alice, "gateway-history-visibility-change-room", "Gateway History Visibility Change Room");
        const roomId = await alice.resolveRoom(alias);
        // Restrict visibility before the gateway ever hydrates this room, so it starts out
        // (correctly) treating history as unsafe to cache.
        await alice.sendStateEvent(roomId, "m.room.history_visibility", "", { history_visibility: "joined" });
        const chatJid = roomJid(alias);
        const joinTo = `${chatJid}/${bobNick}`;

        await joinGateway(testEnv, joinTo);

        const beforeWideningDelivered = waitForStanza(
            testEnv.xmpp, "live message before widening",
            (s) => s.is("message") && s.getChildText("body") === "before widening",
        );
        await alice.sendMessage(roomId, { msgtype: "m.text", body: "before widening" });
        await beforeWideningDelivered;

        // Widen visibility with the gateway room already hydrated/cached - this only works if
        // GatewayHandler#sendStateEvent live-patches the cached allowHistory flag rather than
        // relying on a fresh (uncached) hydration to notice the change.
        await alice.sendStateEvent(roomId, "m.room.history_visibility", "", { history_visibility: "shared" });

        const afterWideningDelivered = waitForStanza(
            testEnv.xmpp, "live message after widening",
            (s) => s.is("message") && s.getChildText("body") === "after widening",
        );
        await alice.sendMessage(roomId, { msgtype: "m.text", body: "after widening" });
        await afterWideningDelivered;

        await leaveGateway(testEnv, joinTo);

        // Only one message was ever eligible for caching - the one sent after visibility opened
        // up. If the write side wasn't gated, "before widening" would show up here too.
        const history = collectStanzas(
            testEnv.xmpp, "replayed history on rejoin", isDelayedGroupchatMessage, 1,
        );
        await joinGateway(testEnv, joinTo);
        const [onlyMessage] = await history;
        expect(onlyMessage.getChildText("body")).toEqual("after widening");

        const unexpectedSecondMessage = collectStanzas(
            testEnv.xmpp, "a second replayed message (should not happen)", isDelayedGroupchatMessage, 1, 3000,
        );
        await expect(unexpectedSecondMessage).rejects.toThrow();
    });
});
