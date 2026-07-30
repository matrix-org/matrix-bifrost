import { describe, expect } from "vitest";
import { xml } from "@xmpp/client";
import { test } from "./util/fixtures";
import { XMPP_COMPONENT_DOMAIN, XMPP_C2S_DOMAIN, XMPP_TEST_USER } from "./util/containers/prosody";
import { ghostMxidForXmppUser } from "./util/bifrost-env";

describe("Basic XMPP <-> Matrix message relay", () => {
  test("relays a 1:1 XMPP message into a new Matrix DM room", async ({ testEnv, alice }) => {
    // The bridge identifies the ghost by the sender's bare JID (no resource) for
    // 1:1 IM routing - see MatrixRoomHandler's "Identified ghost user as ..." log.
    const expectedSender = ghostMxidForXmppUser(
      testEnv.serverName,
      `${XMPP_TEST_USER}@${XMPP_C2S_DOMAIN}`,
    );

    const invite = alice.waitForRoomInvite({ sender: expectedSender });

    await testEnv.xmpp.send(
      xml(
        "message",
        {
          type: "chat",
          to: `alice_${testEnv.serverName}@${XMPP_COMPONENT_DOMAIN}`,
          from: testEnv.xmpp.jid?.toString(),
        },
        xml("body", {}, "Hello from XMPP!"),
      ),
    );

    const { roomId } = await invite;
    const message = alice.waitForRoomEvent({
      eventType: "m.room.message",
      sender: expectedSender,
      roomId,
    });
    await alice.joinRoom(roomId);

    const { data } = await message;
    expect((data.content as { body: string }).body).toEqual("Hello from XMPP!");
  });
});
