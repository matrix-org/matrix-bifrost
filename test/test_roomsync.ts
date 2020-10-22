// tslint:disable: no-any
import * as Chai from "chai";
import { BifrostProtocol } from "../src/bifrost/Protocol";
import { RoomSync } from "../src/RoomSync";
import { Deduplicator } from "../src/Deduplicator";
import { MROOM_TYPE_GROUP, IRemoteGroupData } from "../src/store/Types";
import { mockStore } from "./mocks/store";
import { RoomBridgeStoreEntry } from "matrix-appservice-bridge";
const expect = Chai.expect;

const dummyProtocol = new BifrostProtocol({
    id: "prpl-dummy",
    name: "Dummy",
    homepage: undefined,
    summary: undefined,
});

function createBotAndIntent() {
    const bot = {
        getJoinedMembers: async () => {
            return {
                "@foo:bar": {},
                "@remote_foo:bar": {},
            };
        },
        isRemoteUser: (userId: string) => {
            return userId.startsWith("@remote");
        },
        getUserId: () => "@bot:localhost",
    };
    const intent = {

    };
    return {bot, intent};
}

let remoteJoins: any[];

function createRoomSync(intent, rooms: RoomBridgeStoreEntry[] = []) {
    remoteJoins = [];
    // Create dummy objects, only implement needed stuff.
    const purple = {
        on: (ev: string, func: () => void) => {
            // No-op
        },
        getProtocol: () => true,
    };

    const gateway = {
        initialMembershipSync: (roomEntry) => remoteJoins.push(roomEntry),
    };

    const store = mockStore();

    // {
    //     get: (key: string) => {
    //         return {
    //             username: "foobar",
    //             protocolId: dummyProtocol.id,
    //         }[key];
    //     },
    //     getId: () => "foobar",
    // }

    return {
        rs: new RoomSync(purple as any, store, new Deduplicator(), gateway as any, intent),
        store,
    };
}

describe("RoomSync", () => {
    it("constructs", () => {
        const rs = createRoomSync(null);
    });
    it("should sync one room for one user", async () => {
        const {bot, intent} = createBotAndIntent();
        const {rs, store} = createRoomSync(intent);
        await store.storeRoom("!abc:foobar", MROOM_TYPE_GROUP, "foobar", {
            type: MROOM_TYPE_GROUP,
            protocol_id: dummyProtocol.id,
            room_name: "abc",
        } as IRemoteGroupData);
        await store.storeAccount("@foo:bar", dummyProtocol, "foobar");
        await rs.sync(bot);
        expect(rs.getMembershipForUser("prpl-dummy://foobar")).to.deep.equal([
            {
                membership: "join",
                params: {},
                room_name: "abc",
            },
        ]);
    });
    it("should sync remote users for gateways", async () => {
        const {bot, intent} = createBotAndIntent();
        const {rs, store} = createRoomSync(intent);
        await store.storeRoom("!abc:foobar", MROOM_TYPE_GROUP, "foobar", {
            type: MROOM_TYPE_GROUP,
            protocol_id: dummyProtocol.id,
            room_name: "abc",
            gateway: true,
        } as IRemoteGroupData);
        await store.storeAccount("@foo:bar", dummyProtocol, "foobar");
        await rs.sync(bot);
        expect(rs.getMembershipForUser("prpl-dummy://foobar")).to.not.exist;
        expect(remoteJoins[0].id).to.equal("!abc:foobar    foobar");
    });
});
