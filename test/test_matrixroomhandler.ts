/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { EventEmitter } from "events";
import { MatrixRoomHandler } from "../src/MatrixRoomHandler";
import { Config } from "../src/Config";

const ROOM_ID = "!room:localhost";
const MUC_JID = "muc@conference.localhost";

function createHandler(roomState: any[]) {
    const purple: any = new EventEmitter();
    purple.needsDedupe = () => false;
    purple.needsAccountLock = () => false;
    const calls: {setRoomName: any[]; setRoomTopic: any[]} = { setRoomName: [], setRoomTopic: [] };
    const intent = {
        roomState: async () => roomState,
        setRoomName: async (roomId: string, name: string) => { calls.setRoomName.push([roomId, name]); },
        setRoomTopic: async (roomId: string, topic: string) => { calls.setRoomTopic.push([roomId, topic]); },
    };
    const bridge: any = { getIntent: () => intent };
    const handler = new MatrixRoomHandler(
        purple, {} as any, {} as any, new Config(), {} as any, bridge,
    ) as any;
    handler.createOrGetGroupChatRoom = async () => ROOM_ID;
    return { handler, calls };
}

function topicEvent(topic = "the topic") {
    return {
        eventName: "chat-topic",
        conv: { name: MUC_JID },
        account: { protocol_id: "prpl-dummy", username: "acct" },
        sender: `${MUC_JID}/someone`,
        topic,
    };
}

describe("MatrixRoomHandler", () => {
    describe("handleTopic", () => {
        it("should not overwrite an existing room name with the conversation name", async () => {
            // The topic is (re)delivered on every join, and conv.name is the raw MUC JID on
            // XMPP — overwriting kept resetting a human-set room name back to the JID.
            const { handler, calls } = createHandler([
                { type: "m.room.name", content: { name: "A Human Name" } },
            ]);
            await handler.handleTopic(topicEvent());
            expect(calls.setRoomName).toHaveLength(0);
        });

        it("should name a room that has no name yet", async () => {
            const { handler, calls } = createHandler([]);
            await handler.handleTopic(topicEvent());
            expect(calls.setRoomName).toEqual([[ROOM_ID, MUC_JID]]);
        });

        it("should set a changed topic and skip an unchanged one", async () => {
            const { handler, calls } = createHandler([
                { type: "m.room.name", content: { name: "A Human Name" } },
                { type: "m.room.topic", content: { topic: "old topic" } },
            ]);
            await handler.handleTopic(topicEvent("new topic"));
            expect(calls.setRoomTopic).toEqual([[ROOM_ID, "new topic"]]);
            calls.setRoomTopic.length = 0;
            // unchanged topic: reads content.topic (was content.name, so every redelivery
            // re-sent an identical m.room.topic state event)
            await handler.handleTopic(topicEvent("old topic"));
            expect(calls.setRoomTopic).toHaveLength(0);
        });
    });
});
