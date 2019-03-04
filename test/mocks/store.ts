import { Store } from "../../src/Store";
import { RoomBridgeStore, UserBridgeStore } from "matrix-appservice-bridge";
import * as Datastore from "nedb";

const DEF_REGEX = /@remote/;

export function mockStore(remoteUserRegex = DEF_REGEX): Store {
    const userStore = new UserBridgeStore(new Datastore());
    const roomStore = new RoomBridgeStore(new Datastore());
    return new Store({
        getRoomStore: () => roomStore,
        getUserStore: () => userStore,
        getBot: () => ({
            isRemoteUser: (u) => remoteUserRegex.exec(u) !== null,
        }),
    });
}
