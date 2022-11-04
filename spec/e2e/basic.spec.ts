import { BifrostTestEnvironment } from "../utils/test";
import { it, expect } from '@jest/globals';
import xml from "@xmpp/xml";

BifrostTestEnvironment.describeTest('Basic bridge usage', (env) => {
    it('should be able to handle an incoming DM', async () => {
        const { homeserver, bifrostBridge, client } = env();
        const alice = homeserver.users[0].client;
        const bob = client;

        // Send a message to alice
        await bob.send(xml("message", {
            from: bob.jid?.toString(),
            id: Date.now(),
            to: 'alice@matrixbridge.localhost',
            type: 'chat',
            'xml:lang': 'en',
        }, xml("body", "Hello world!")));

        const { roomId } = await alice.waitForRoomEvent(
            {eventType: 'm.room.member', sender: '@_xmpp_bob:localhost'}
        );
        const message = alice.waitForRoomEvent(
            {eventType: 'm.room.message', sender: '@_xmpp_bob:localhost'}
        );
        await alice.joinRoom(roomId);
        await alice.getRoomStateEvent(roomId, 'm.room.create', '');
        // Await for the XMPP message.
        await message;
    });
}, {
    matrixLocalparts: ['alice'],
});
