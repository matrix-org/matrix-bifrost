import * as Chai from "chai";
import { IStore } from "../src/store/Store";
import { mockStore } from "./mocks/store";
import { BifrostProtocol } from "../src/bifrost/Protocol";
import { MUSER_TYPE_GHOST } from "../src/store/Types";
import { Util } from "../src/Util";
import { MatrixUser, RemoteUser } from "matrix-appservice-bridge";
const expect = Chai.expect;

let store: IStore;

const dummyProtocol = new BifrostProtocol({
    id: "prpl-dummy",
    name: "Dummy",
    homepage: undefined,
    summary: undefined,
});

describe("Store", () => {
    beforeEach(() => {
        store = mockStore();
    });
    it("should not overrwrite custom keys", async () => {
        // First, store a user.
        await store.storeUser(
            "@_xmpp_ghosty:localhost", dummyProtocol,
            "ghostly", MUSER_TYPE_GHOST, {
                myCustomKey: 1000,
            },
        );
        // Now let's set some data about that user
        const mxUser = new MatrixUser("@_xmpp_ghosty:localhost");
        mxUser.set("anotherCustomKey", 5000);
        await store.setMatrixUser(mxUser);
        // Store them again
        await store.storeUser(
            "@_xmpp_ghosty:localhost", dummyProtocol,
            "ghostly", MUSER_TYPE_GHOST, {
                myCustomKey: 1000,
            },
        );
        // Now get the user
        const fetchedUser = await store.getMatrixUser("@_xmpp_ghosty:localhost");
        expect(fetchedUser.userId).to.equal("@_xmpp_ghosty:localhost");
        expect(fetchedUser.get("anotherCustomKey")).to.equal(5000);
    });
    it("should update an mxid when the account changes", async () => {
        // First, store a user.
        await store.storeUser(
            "@_xmpp_old_ghosty:localhost", dummyProtocol,
            "ghostly", MUSER_TYPE_GHOST, {
                myCustomKey: 1000,
            },
        );
        // Store them again, but with a different mxid
        await store.storeUser(
            "@_xmpp_ghosty:localhost", dummyProtocol,
            "ghostly", MUSER_TYPE_GHOST, {
                myCustomKey: 1000,
            },
        );
        const remotes = await store.getRemoteUsersFromMxId("@_xmpp_ghosty:localhost");
        expect(remotes[0]).to.exist;
    });
});
