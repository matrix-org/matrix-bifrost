import * as Chai from "chai";
import { Store } from "../src/Store";
import { mockStore } from "./mocks/store";
import { PurpleProtocol } from "../src/purple/PurpleProtocol";
const expect = Chai.expect;

let store: Store;

const dummyProtocol = new PurpleProtocol({
    id: "prpl-dummy",
    name: "Dummy",
    homepage: undefined,
    summary: undefined,
});

describe("Store", () => {
    beforeEach(() => {
        store = mockStore();
    });
    describe("getUsernameMxidForProtocol", () => {
        it ("should fetch no users if none are in the store", async () => {
            const res = await store.getUsernameMxidForProtocol(dummyProtocol);
            expect(Object.keys(res)).to.be.empty;
        });
        it ("should fetch one user if two conflicting ones exist in the store.", async () => {
            const res = await store.getUsernameMxidForProtocol(dummyProtocol);
            expect(res[0]).to.equal;
        });
    });
});
