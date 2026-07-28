import { describe, expect } from "vitest";
import { xml, client as xmppClient } from "@xmpp/client";
import type { Element } from "@xmpp/xml";
import { test as baseTest } from "./util/fixtures";
import { XMPP_COMPONENT_DOMAIN, XMPP_C2S_DOMAIN, XMPP_TEST_USER } from "./util/containers/prosody";
import { ghostMxidForXmppUser } from "./util/bifrost-env";
import type { BifrostTestEnv, BifrostTestEnvOpts } from "./util/bifrost-env";
import type { E2ETestMatrixClient } from "./util/e2e-test";

const STANZA_WAIT_TIMEOUT = parseInt(process.env.BIFROST_TEST_WAIT_TIMEOUT ?? "20000", 10);

// Gateway room support only runs when portals.enableGateway is set - see XJSInstance#preStart.
const test = baseTest.override("testEnvOpts", {
    config: {
        portals: { enableGateway: true },
    },
} as BifrostTestEnvOpts);

async function createPublicRoom(
    testEnv: BifrostTestEnv, alice: E2ETestMatrixClient, aliasLocalpart: string, name: string,
): Promise<string> {
    const roomId = await alice.createRoom({
        visibility: "public",
        preset: "public_chat",
        name,
        room_alias_name: aliasLocalpart,
    });
    const alias = `#${aliasLocalpart}:${testEnv.serverName}`;
    // createRoom's room_alias_name maps the alias but does not set canonical_alias itself.
    await alice.sendStateEvent(roomId, "m.room.canonical_alias", "", { alias });
    return alias;
}

// Mirrors ServiceHandler#createJIDFromAlias, so tests can address a gateway room's JID directly.
function roomJid(alias: string): string {
    const [local, server] = alias.replace(/^#/, "").split(":");
    return `#${local}#${server}@${XMPP_COMPONENT_DOMAIN}`;
}

function waitForStanza(
    xmpp: ReturnType<typeof xmppClient>, description: string, predicate: (stanza: Element) => boolean,
    timeoutMs = STANZA_WAIT_TIMEOUT,
): Promise<Element> {
    return new Promise((resolve, reject) => {
        const onStanza = (stanza: Element) => {
            if (predicate(stanza)) {
                clearTimeout(timer);
                xmpp.removeListener("stanza", onStanza);
                resolve(stanza);
            }
        };
        const timer = setTimeout(() => {
            xmpp.removeListener("stanza", onStanza);
            reject(new Error(`Timed out waiting for stanza: ${description}`));
        }, timeoutMs);
        xmpp.on("stanza", onStanza);
    });
}

/** Collects `count` matching stanzas, in arrival order. Rejects if that many don't show up in time. */
function collectStanzas(
    xmpp: ReturnType<typeof xmppClient>, description: string, predicate: (stanza: Element) => boolean,
    count: number, timeoutMs = STANZA_WAIT_TIMEOUT,
): Promise<Element[]> {
    return new Promise((resolve, reject) => {
        const collected: Element[] = [];
        const onStanza = (stanza: Element) => {
            if (!predicate(stanza)) {
                return;
            }
            collected.push(stanza);
            if (collected.length >= count) {
                clearTimeout(timer);
                xmpp.removeListener("stanza", onStanza);
                resolve(collected);
            }
        };
        const timer = setTimeout(() => {
            xmpp.removeListener("stanza", onStanza);
            reject(new Error(`Timed out waiting for ${count} stanzas (got ${collected.length}): ${description}`));
        }, timeoutMs);
        xmpp.on("stanza", onStanza);
    });
}

function isPresenceFrom(stanza: Element, from: string): boolean {
    return stanza.is("presence") && stanza.attrs.from === from;
}

function hasMucStatusCode(stanza: Element, code: string): boolean {
    return !!stanza.getChild("x", "http://jabber.org/protocol/muc#user")
        ?.getChildren("status")
        .some((s) => s.attrs.code === code);
}

function isDelayedGroupchatMessage(stanza: Element): boolean {
    return stanza.is("message") && stanza.attrs.type === "groupchat"
        && !!stanza.getChild("delay", "urn:xmpp:delay");
}

/** Sends the MUC join presence used to enter a gateway room, and waits for the self-presence ack. */
async function joinGateway(testEnv: BifrostTestEnv, joinTo: string): Promise<void> {
    const selfPresence = waitForStanza(
        testEnv.xmpp, "self-presence confirming gateway join",
        (s) => isPresenceFrom(s, joinTo) && hasMucStatusCode(s, "110"),
    );
    await testEnv.xmpp.send(xml(
        "presence", { to: joinTo },
        xml("x", { xmlns: "http://jabber.org/protocol/muc" }),
    ));
    await selfPresence;
}

/** Sends the MUC unavailable presence used to leave a gateway room, and waits for the self-presence ack. */
async function leaveGateway(testEnv: BifrostTestEnv, joinTo: string): Promise<void> {
    const selfPresence = waitForStanza(
        testEnv.xmpp, "self-presence confirming gateway leave",
        (s) => isPresenceFrom(s, joinTo) && s.attrs.type === "unavailable" && hasMucStatusCode(s, "110"),
    );
    await testEnv.xmpp.send(xml("presence", { type: "unavailable", to: joinTo }));
    await selfPresence;
}

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
});
