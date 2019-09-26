// tslint:disable: no-any
import * as Chai from "chai";
import { BifrostProtocol } from "../src/bifrost/Protocol";
import { RoomSync } from "../src/RoomSync";
import { Deduplicator } from "../src/Deduplicator";
import { IRoomEntry, MROOM_TYPE_GROUP, IRemoteGroupData, MUSER_TYPE_ACCOUNT } from "../src/StoreTypes";
import { mockStore } from "./mocks/store";
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

function createRoomSync(rooms: IRoomEntry[] = []) {
    remoteJoins = [];
    // Create dummy objects, only implement needed stuff.
    const purple = {
        on: (ev: string, func: () => void) => {
            // No-op
        },
        getProtocol: () => true,
    };

    const gateway = {
        rejoinRemoteUser: (user, room) => remoteJoins.push({user, room}),
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
        rs: new RoomSync(purple as any, store, new Deduplicator(), gateway as any),
        store,
    };
}

describe("RoomSync", () => {
    it("constructs", () => {
        const rs = createRoomSync();
    });
    it("should sync one room for one user", async () => {
        const {rs, store} = createRoomSync();
        const {bot, intent} = createBotAndIntent();
        await store.storeRoom("!abc:foobar", MROOM_TYPE_GROUP, "foobar", {
            type: MROOM_TYPE_GROUP,
            protocol_id: dummyProtocol.id,
            room_name: "abc",
        } as IRemoteGroupData);
        await store.storeUser("@foo:bar", dummyProtocol, "foobar", MUSER_TYPE_ACCOUNT);
        await rs.sync(bot, intent);
        expect(rs.getMembershipForUser("prpl-dummy://foobar")).to.deep.equal([
            {
                membership: "join",
                params: {},
                room_name: "abc",
            },
        ]);
    });
    it("should sync remote users for gateways", async () => {
        const {rs, store} = createRoomSync();
        const {bot, intent} = createBotAndIntent();
        await store.storeRoom("!abc:foobar", MROOM_TYPE_GROUP, "foobar", {
            type: MROOM_TYPE_GROUP,
            protocol_id: dummyProtocol.id,
            room_name: "abc",
            gateway: true,
        } as IRemoteGroupData);
        await store.storeUser("@foo:bar", dummyProtocol, "foobar", MUSER_TYPE_ACCOUNT);
        await rs.sync(bot, intent);
        expect(rs.getMembershipForUser("prpl-dummy://foobar")).to.not.exist;
        expect(remoteJoins).to.deep.equal([
            {
                 user: "@remote_foo:bar",
                 room: "!abc:foobar",
            },
        ]);
    });
});
