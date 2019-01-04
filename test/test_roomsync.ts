import * as Chai from "chai";
import { Util } from "../src/Util";
import { PurpleProtocol } from "../src/purple/PurpleProtocol";
import { RoomSync } from "../src/RoomSync";
import { Deduplicator } from "../src/Deduplicator";
import { create } from "domain";
import { IRoomEntry } from "../src/StoreTypes";
const expect = Chai.expect;

const dummyProtocol = new PurpleProtocol({
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
    };
    const intent = {

    };
    return {bot, intent};
}

function createRoomSync(rooms: IRoomEntry[] = []) {
    // Create dummy objects, only implement needed stuff.
    const purple = {
        on: (ev: string, func: () => void) => {
            // No-op
        },
    };

    const store = {
        getRoomsOfType: (type: string) => rooms,
        getRemoteUsersFromMxId: async (userId: string) => {
            if (userId === "@foo:bar") {
                return [{
                    get: (key: string) => {
                        return {
                            username: "foobar",
                            protocolId: dummyProtocol.id,
                        }[key];
                    },
                    getId: () => "foobar",
                }];
            }
            return [];
        },
    };

    return new RoomSync(purple as any, store as any, new Deduplicator());
}

describe("RoomSync", () => {
    it("constructs", () => {
        const rs = createRoomSync();
    });
    it("should sync one room", async () => {
        const rs = createRoomSync([
            {
                matrix: {
                    getId: () => "!abc:foobar",
                },
                remote: {
                    get: (key: string) => {
                        return {
                            protocol_id: dummyProtocol.id,
                            room_name: "abc",
                        }[key];
                    },
                    getId: () => "foobar",
                },
            },
        ]);
        const {bot, intent} = createBotAndIntent();
        await rs.sync(bot, intent);
        expect(rs.getMembershipForUser("foobar")).to.deep.equal([
            {
                membership: "join",
                params: {},
                room_name: "abc",
            },
        ]);
    });
});
