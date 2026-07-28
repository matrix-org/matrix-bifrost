import { describe, expect } from "vitest";
import { xml, client as xmppClient } from "@xmpp/client";
import { jid } from "@xmpp/jid";
import type { Element } from "@xmpp/xml";
import { test as baseTest } from "./util/fixtures";
import { XMPP_COMPONENT_DOMAIN, XMPP_C2S_DOMAIN, XMPP_TEST_USER } from "./util/containers/prosody";
import { ghostMxidForXmppUser } from "./util/bifrost-env";
import type { BifrostTestEnv, BifrostTestEnvOpts } from "./util/bifrost-env";
import type { E2ETestMatrixClient } from "./util/e2e-test";

const STANZA_WAIT_TIMEOUT = parseInt(process.env.BIFROST_TEST_WAIT_TIMEOUT ?? "20000", 10);

// Gateway room support only runs when portals.enableGateway is set - see XJSInstance#preStart.
// Carol is a second Matrix user who joins a room and never leaves, purely so the membership
// test below has a stable observer for both Alice's and Bob's departures - whichever of the
// two of them leaves last has nobody left in the room to confirm their own leave from the
// Matrix side. The environment (and so its user list) is booted once per file, shared by both
// tests below, so she's declared here even though the messaging test doesn't use her.
const test = baseTest.override("testEnvOpts", {
    matrixLocalparts: ["alice", "carol"],
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

function isPresenceFrom(stanza: Element, from: string): boolean {
    return stanza.is("presence") && stanza.attrs.from === from;
}

function hasMucStatusCode(stanza: Element, code: string): boolean {
    return !!stanza.getChild("x", "http://jabber.org/protocol/muc#user")
        ?.getChildren("status")
        .some((s) => s.attrs.code === code);
}

/**
 * Tracks the occupants of a gateway room from incoming presence broadcasts, the way a real
 * XMPP client builds its member list - there's no disco#items support for the occupants of a
 * specific gateway room (only for listing rooms themselves), see ServiceHandler#handleIq.
 */
class OccupantTracker {
    private readonly nicks = new Set<string>();
    private readonly handler = (stanza: Element) => {
        if (!stanza.is("presence") || !stanza.attrs.from) {
            return;
        }
        const from = jid(stanza.attrs.from);
        if (!from.resource || `${from.local}@${from.domain}` !== this.chatJid) {
            return;
        }
        if (stanza.attrs.type === "unavailable") {
            this.nicks.delete(from.resource);
        } else {
            this.nicks.add(from.resource);
        }
    };

    constructor(private xmpp: ReturnType<typeof xmppClient>, private chatJid: string) {
        xmpp.on("stanza", this.handler);
    }

    public get occupantNicks(): string[] {
        return [...this.nicks].sort();
    }

    public stop(): void {
        this.xmpp.removeListener("stanza", this.handler);
    }
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

describe("XMPP gateway participation", () => {
    test("bridges bidirectional messages between a Matrix user and an XMPP user", async ({ testEnv, alice }) => {
        const bobNick = "bob";
        const bobBareJid = `${XMPP_TEST_USER}@${XMPP_C2S_DOMAIN}`;
        const bobGhostMxid = ghostMxidForXmppUser(testEnv.serverName, bobBareJid);

        // Gives Alice's occupant nick in the gateway room a stable value (otherwise it falls
        // back to her raw mxid - see GatewayStateResolve#resolveMatrixStateToXMPP).
        await alice.setDisplayName("Alice");
        const alias = await createPublicRoom(testEnv, alice, "gateway-messaging-room", "Gateway Messaging Room");
        const roomId = await alice.resolveRoom(alias);
        const chatJid = roomJid(alias);
        const joinTo = `${chatJid}/${bobNick}`;

        await joinGateway(testEnv, joinTo);

        const matrixMsgToXmpp = waitForStanza(
            testEnv.xmpp, "groupchat message relayed from Matrix",
            (s) => s.is("message") && s.attrs.type === "groupchat" && s.getChildText("body") === "hello from matrix",
        );
        await alice.sendMessage(roomId, { msgtype: "m.text", body: "hello from matrix" });
        const matrixMsgStanza = await matrixMsgToXmpp;
        // The sender's occupant JID is anonymised to <room>/<nick> - Alice's ghost isn't exposed.
        expect(matrixMsgStanza.attrs.from).toEqual(`${chatJid}/Alice`);

        const xmppMsgToMatrix = alice.waitForRoomEvent({
            eventType: "m.room.message", sender: bobGhostMxid, roomId,
        });
        await testEnv.xmpp.send(xml(
            "message",
            { type: "groupchat", to: chatJid, from: testEnv.xmpp.jid?.toString() },
            xml("body", {}, "hello from xmpp"),
        ));
        const { data: xmppMsgData } = await xmppMsgToMatrix;
        expect((xmppMsgData.content as { body: string }).body).toEqual("hello from xmpp");
    });

    test(
        "keeps the memberlist correct on both sides as a Matrix user and an XMPP user join and leave",
        { timeout: 60000 },
        async ({ testEnv, alice }) => {
            // Carol never leaves - she's here purely so the Matrix-side memberlist can still be
            // checked after whichever of Alice/Bob leaves last (at that point there's nobody
            // else left in the room to confirm it from the Matrix side).
            const carol = testEnv.getUser("carol");
            const bobNick = "bob";
            const bobBareJid = `${XMPP_TEST_USER}@${XMPP_C2S_DOMAIN}`;
            const bobGhostMxid = ghostMxidForXmppUser(testEnv.serverName, bobBareJid);
            const aliceMxid = `@alice:${testEnv.serverName}`;
            const carolMxid = `@carol:${testEnv.serverName}`;

            await alice.setDisplayName("Alice");
            const alias = await createPublicRoom(testEnv, alice, "gateway-membership-room", "Gateway Membership Room");
            const roomId = await carol.joinRoom(alias);
            const chatJid = roomJid(alias);
            const joinTo = `${chatJid}/${bobNick}`;

            expect((await carol.getJoinedRoomMembers(roomId)).sort()).toEqual([aliceMxid, carolMxid].sort());

            const tracker = new OccupantTracker(testEnv.xmpp, chatJid);

            // --- Bob (XMPP) joins ---
            const bobGhostJoined = carol.waitForRoomEvent({
                eventType: "m.room.member", sender: bobGhostMxid, stateKey: bobGhostMxid, roomId,
            });
            await joinGateway(testEnv, joinTo);
            const { data: joinData } = await bobGhostJoined;
            expect((joinData.content as { membership: string }).membership).toEqual("join");

            expect((await carol.getJoinedRoomMembers(roomId)).sort()).toEqual(
                [aliceMxid, carolMxid, bobGhostMxid].sort(),
            );
            expect(tracker.occupantNicks).toEqual(expect.arrayContaining(["Alice", bobNick]));

            // --- Alice (Matrix) leaves - Bob is still in the room to observe the XMPP side, and
            // Carol observes the Matrix side ---
            const aliceLeftMatrix = carol.waitForRoomEvent({
                eventType: "m.room.member", sender: aliceMxid, stateKey: aliceMxid, roomId,
            });
            const aliceLeftXmpp = waitForStanza(
                testEnv.xmpp, "presence unavailable for Alice leaving",
                (s) => isPresenceFrom(s, `${chatJid}/Alice`) && s.attrs.type === "unavailable",
            );
            await alice.leaveRoom(roomId);
            const { data: aliceLeaveData } = await aliceLeftMatrix;
            await aliceLeftXmpp;
            expect((aliceLeaveData.content as { membership: string }).membership).toEqual("leave");
            expect((await carol.getJoinedRoomMembers(roomId)).sort()).toEqual([carolMxid, bobGhostMxid].sort());
            expect(tracker.occupantNicks).not.toContain("Alice");

            // --- Bob (XMPP) leaves - Carol observes the Matrix side, Bob observes his own
            // self-presence confirming the leave ---
            const bobGhostLeft = carol.waitForRoomEvent({
                eventType: "m.room.member", sender: bobGhostMxid, stateKey: bobGhostMxid, roomId,
            });
            const bobSelfLeavePresence = waitForStanza(
                testEnv.xmpp, "self-presence confirming gateway leave",
                (s) => isPresenceFrom(s, joinTo) && s.attrs.type === "unavailable" && hasMucStatusCode(s, "110"),
            );
            await testEnv.xmpp.send(xml("presence", { type: "unavailable", to: joinTo }));
            await bobSelfLeavePresence;
            const { data: bobLeaveData } = await bobGhostLeft;
            expect((bobLeaveData.content as { membership: string }).membership).toEqual("leave");
            expect(await carol.getJoinedRoomMembers(roomId)).toEqual([carolMxid]);

            const messageAfterLeave = waitForStanza(
                testEnv.xmpp, "message delivered to Bob after he left (should not happen)",
                (s) => s.is("message") && s.getChildText("body") === "should not reach a departed member",
                3000,
            );
            await carol.sendMessage(roomId, { msgtype: "m.text", body: "should not reach a departed member" });
            await expect(messageAfterLeave).rejects.toThrow();

            tracker.stop();
        },
    );
});
