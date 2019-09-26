// tslint:disable: no-any
import * as Chai from "chai";
import { MatrixEventHandler } from "../src/MatrixEventHandler";
import { mockStore } from "./mocks/store";
import { Deduplicator } from "../src/Deduplicator";
import { Config } from "../src/Config";
import { IEventRequest, IBridgeContext } from "../src/MatrixTypes";
import { dummyProtocol } from "./mocks/dummyprotocol";
import { IStore } from "../src/store/Store";
import { IRemoteImData, MROOM_TYPE_IM } from "../src/store/Types";
const expect = Chai.expect;

function createRequest(extraEvData: any): IEventRequest {
    const eventData = {
        room_id: "!12345:localhost",
        event_id: "$12345:localhost",
        sender: "@alice:localhost",
        type: "m.room.message",
        origin_server_ts: 0,
        content: { },
        ...extraEvData,
    };
    return {
        getData: () => eventData,
        getDuration: () => 0,
        getId: () => "requestId",
        getPromise: () => Promise.resolve(),
        outcomeFrom: () => null,
    };
}

function createContext(): IBridgeContext {
    return {
        senders: {
            matrix: null,
            remote: null,
            remotes: [],
        },
        targets: {
            matrix: null,
            remote: null,
            remotes: [],
        },
        rooms: {
            matrix: null,
            remote: null,
            remotes: [],
        },
    };
}

function createMEH() {
    const purple = {
        getUsernameFromMxid: (userId) => {
            if (userId === "@definitelyremote:localhost") {
                return {username: "definitelyremote", protocol: dummyProtocol};
            }
            throw Error("Username didn't match");
        },
    };
    const config = new Config();
    const store = mockStore();
    const gatewayHandler = {

    };
    const bridge = {
        getBot: () => ({
            getUserId: () => "@theboss:localhost",
            isRemoteUser: (userId: string) => userId === "@definitelyremote:localhost",
        }),
        getIntent: (userId: string) => ({
            opts: {

            },
            join: () => { /* empty */ },
            getClient: () => ({
                getUserId: () => userId,
                _createMessagesRequest: () => Promise.resolve({
                    chunk: [{
                        type: "m.room.message",
                        event_id: "$1:localhost",
                    },
                    {
                        type: "m.room.member",
                        sender: userId,
                        event_id: "$2:localhost",
                    },
                    {
                        type: "m.room.message",
                        event_id: "$3:localhost",
                    }],
                }),
            }),
        }),
    };
    const meh = new MatrixEventHandler(
        purple as any,
        store,
        new Deduplicator(),
        config,
        gatewayHandler as any,
    );
    meh.setBridge(bridge as any);
    return {meh, store};
}

describe("MatrixEventHandler", () => {
    describe("onEvent", () => {
        let meh: MatrixEventHandler;
        let store: IStore;
        beforeEach(() => {
            const res = createMEH();
            meh = res.meh;
            store = res.store;
        });
        it("handle new invite for bot", async () => {
            let handleInviteForBotCalledWith;
            (meh as any).handleInviteForBot = (ev) => handleInviteForBotCalledWith = ev;
            await meh.onEvent(createRequest({
                type: "m.room.member",
                content: {
                    membership: "invite",
                },
                event_id: "$botinviteevent",
                state_key: "@theboss:localhost",
            }), createContext());
            expect(handleInviteForBotCalledWith.event_id).to.be.equal("$botinviteevent");
        });
        it("handle new invite for ghost", async () => {
            let messagesHandled = 0;
            (meh as any).getAccountForMxid = (ev) => ({
                acct: {
                    protocol: dummyProtocol,
                },
            });
            (meh as any).handleImMessage = (ev) => {
                messagesHandled++;
            };
            await meh.onEvent(createRequest({
                type: "m.room.member",
                content: {
                    membership: "invite",
                    is_direct: true,
                },
                event_id: "$ghostinviteevent",
                state_key: "@definitelyremote:localhost",
            }), createContext());
            expect(messagesHandled).to.equal(1);
            const storeEntry = await store.getRoomByRemoteData({
                recipient: "definitelyremote",
                matrixUser: "@alice:localhost",
                protocol_id: dummyProtocol.id,
            } as IRemoteImData);
            expect(storeEntry).to.exist;
            expect(storeEntry.matrix.getId()).to.equal("!12345:localhost");
            expect(storeEntry.matrix.get("type")).to.equal(MROOM_TYPE_IM);
        });
    });
});
