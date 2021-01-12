// tslint:disable: no-any
import * as Chai from "chai";
import { IGatewayRoom } from "../src/bifrost/Gateway";
import { Config } from "../src/Config";
import { mockStore } from "./mocks/store";
import { EventEmitter } from "events";
import { IGatewayJoin } from "../src/bifrost/Events";
import { dummyProtocol } from "./mocks/dummyprotocol";
import { MockIntent } from "./mocks/intent";
import { MROOM_TYPE_GROUP, IRemoteGroupData } from "../src/store/Types";
import { GatewayHandler } from "../src/GatewayHandler";
const expect = Chai.expect;

function createGH() {
    let remoteJoinResolve: any = null;
    const watch: any = {
        intent: null,
        profileUpdated: false,
        remoteJoin: null,
        remoteJoinPromise: new Promise((resolve) => remoteJoinResolve = resolve),
    };
    const bridge = {
        getIntent: (userId) => {
            watch.intent = new MockIntent(userId);
            return watch.intent;
        },
        getBot: () => {
            return {
                isRemoteUser: (userId: string) => userId.startsWith("@_prefix_"),
            };
        },
    };
    let purple: any = {
        gateway: {
            onRemoteJoin: (
                err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined) => {
                    watch.remoteJoin = {err, joinId, room, ownMxid};
                    remoteJoinResolve();
            },
            getMxidForRemote: (sender: string) => {
                return `@_prefix_${sender}:localhost`;
            },
        },
        getProtocol: () => dummyProtocol,
    };
    purple = Object.assign(new EventEmitter(), purple);
    const profileSync: any = {
        updateProfile: () => { watch.profileUpdated = true; },
    };
    const config = new Config();
    config.roomRules.push({
        action: "deny",
        room: "#badroom:example.com"
    });
    config.roomRules.push({
        action: "deny",
        room: "!evilroom:example.com"
    });
    config.portals.enableGateway = true;
    config.bridge.domain = "localhost";
    config.bridge.userPrefix = "_prefix_";
    const store = mockStore();
    const gh = new GatewayHandler(
        purple,
        bridge as any,
        config as any,
        store,
        profileSync,
    );
    return {gh, purple, watch, store};
}

describe("GatewayHandler", () => {
    it("will handle a remote room join sucessfully", async () => {
        const {purple, watch} = createGH();
        purple.emit("gateway-joinroom", {
            sender: "frogman@frogworld",
            protocol_id: dummyProtocol.id,
            join_id: "!roomId:localhost",
            roomAlias: "#roomAlias:localhost",
            room_name: "#roomAlias#localhost@bridge.place",
        } as IGatewayJoin);
        await watch.remoteJoinPromise;
        expect(watch.intent).to.not.be.null;
        expect(watch.intent.ensureRegisteredCalled).to.be.true;
        expect(watch.intent.userId).to.equal("@_prefix_frogman@frogworld:localhost");
        expect(watch.intent.clientJoinRoomCalledWith.roomString).to.equal("#roomAlias:localhost");
        expect(watch.profileUpdated).to.be.true;
        expect(watch.remoteJoin.err).is.null;
        expect(watch.remoteJoin.joinId).to.equal("!roomId:localhost");
        expect(watch.remoteJoin.room.roomId).to.equal("!roomAlias:localhost");
    });
    it("will block joining to a gateway if a room is already bridged.", async () => {
        const {purple, watch, store} = createGH();
        await store.storeRoom("!roomAlias2:localhost", MROOM_TYPE_GROUP, "remoteId", {
            protocol_id: dummyProtocol.id,
            room_name: "#roomAlias2#localhost@bridge.place",
        } as IRemoteGroupData);
        purple.emit("gateway-joinroom", {
            sender: "frogman@frogworld",
            protocol_id: dummyProtocol.id,
            join_id: "!roomId2:localhost",
            roomAlias: "#roomAlias2:localhost",
            room_name: "#roomAlias2#localhost@bridge.place",
        } as IGatewayJoin);
        await watch.remoteJoinPromise;
        expect(watch.intent).to.not.be.null;
        expect(watch.intent.ensureRegisteredCalled).to.be.true;
        expect(watch.intent.userId).to.equal("@_prefix_frogman@frogworld:localhost");
        expect(watch.intent.clientJoinRoomCalledWith.roomString).to.equal("#roomAlias2:localhost");
        expect(watch.profileUpdated).to.be.true;
        expect(watch.remoteJoin.joinId).to.equal("!roomId2:localhost");
        expect(watch.remoteJoin.err).to.equal(
            "This room is already bridged to #roomAlias2#localhost@bridge.place",
        );
    });
    it("will block joining to a gateway if the alias is banned.", async () => {
        const {purple, watch} = createGH();
        purple.emit("gateway-joinroom", {
            sender: "frogman@frogworld",
            protocol_id: dummyProtocol.id,
            join_id: "!roomId2:localhost",
            roomAlias: "#badroom:example.com",
        } as IGatewayJoin);
        await watch.remoteJoinPromise;
        expect(watch.intent).to.not.be.null;
        expect(watch.intent.ensureRegisteredCalled).to.be.false;
        expect(watch.remoteJoin.err).to.equal(
            "This room has been denied",
        );
    });
});
