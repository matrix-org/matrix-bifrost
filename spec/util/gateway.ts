import { xml, client as xmppClient } from "@xmpp/client";
import { jid } from "@xmpp/jid";
import type { Element } from "@xmpp/xml";
import { XMPP_COMPONENT_DOMAIN } from "./containers/prosody";
import type { BifrostTestEnv } from "./bifrost-env";
import type { E2ETestMatrixClient } from "./e2e-test";

export const STANZA_WAIT_TIMEOUT = parseInt(process.env.BIFROST_TEST_WAIT_TIMEOUT ?? "20000", 10);

export async function createPublicRoom(
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
export function roomJid(alias: string): string {
    const [local, server] = alias.replace(/^#/, "").split(":");
    return `#${local}#${server}@${XMPP_COMPONENT_DOMAIN}`;
}

export function waitForStanza(
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
export function collectStanzas(
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

export function isPresenceFrom(stanza: Element, from: string): boolean {
    return stanza.is("presence") && stanza.attrs.from === from;
}

export function hasMucStatusCode(stanza: Element, code: string): boolean {
    return !!stanza.getChild("x", "http://jabber.org/protocol/muc#user")
        ?.getChildren("status")
        .some((s) => s.attrs.code === code);
}

export function isDelayedGroupchatMessage(stanza: Element): boolean {
    return stanza.is("message") && stanza.attrs.type === "groupchat"
        && !!stanza.getChild("delay", "urn:xmpp:delay");
}

/** Sends the MUC join presence used to enter a gateway room, and waits for the self-presence ack. */
export async function joinGateway(testEnv: BifrostTestEnv, joinTo: string): Promise<void> {
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
export async function leaveGateway(testEnv: BifrostTestEnv, joinTo: string): Promise<void> {
    const selfPresence = waitForStanza(
        testEnv.xmpp, "self-presence confirming gateway leave",
        (s) => isPresenceFrom(s, joinTo) && s.attrs.type === "unavailable" && hasMucStatusCode(s, "110"),
    );
    await testEnv.xmpp.send(xml("presence", { type: "unavailable", to: joinTo }));
    await selfPresence;
}

/**
 * Tracks the occupants of a gateway room from incoming presence broadcasts, the way a real
 * XMPP client builds its member list - there's no disco#items support for the occupants of a
 * specific gateway room (only for listing rooms themselves), see ServiceHandler#handleIq.
 */
export class OccupantTracker {
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
