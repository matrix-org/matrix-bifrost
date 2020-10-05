import Datastore from "nedb";
import { RoomBridgeStore, UserBridgeStore } from "matrix-appservice-bridge";
import { NeDBStore } from "../../src/store/NeDBStore";
import { IStore } from "../../src/store/Store";

const DEF_REGEX = /@remote/;

export function mockStore(remoteUserRegex = DEF_REGEX): IStore {
    const userStore = new UserBridgeStore(new Datastore());
    const roomStore = new RoomBridgeStore(new Datastore());
    return new NeDBStore({
        getRoomStore: () => roomStore,
        getUserStore: () => userStore,
        getBot: () => {
            const bot = { isRemoteUser: (u) => remoteUserRegex.exec(u) !== null }
            return bot as any;
        },
    } as any);
}
