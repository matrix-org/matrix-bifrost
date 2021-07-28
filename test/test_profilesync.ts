// tslint:disable: no-any
import * as Chai from "chai";
import { mockStore } from "./mocks/store";
import { ProfileSync } from "../src/ProfileSync";
import { Config } from "../src/Config";
import { PurpleProtocol } from "../src/purple/PurpleProtocol";
const expect = Chai.expect;

const dummyProtocol = new PurpleProtocol({
    id: "prpl-dummy",
    name: "Dummy",
    homepage: undefined,
    summary: undefined,
});

function createProfileSync(userInfo?: {}) {
    const values = {
        displayname: "",
        avatarUrl: "",
        userId: "",
        uri: "",
        uploadedData: undefined,
    };
    const store = mockStore();
    const bridge = {
        getIntent: (userId) => {
            values.userId = userId;
            return {
                setDisplayName: (displayname) => {
                    values.displayname = displayname;
                },
                setAvatarUrl: (avatarUrl) => {
                    values.avatarUrl = avatarUrl;
                },
                uploadContent: (data) => {
                    values.uploadedData = data;
                    return "mxc://example.com/foobar";
                },
            };
        },
    };
    const config = new Config();
    config.bridge.userPrefix = "_bifrost_";
    config.bridge.domain = "localhost";
    const account = {
        getBuddy: () => undefined,
        getUserInfo: (senderID) => userInfo,
        getAvatarBuffer: (uri, senderId) => {
            values.uri = uri;
            return Buffer.from("12345");
        },
    };
    return {
        profileSync: new ProfileSync(
            bridge as any,
            config,
            store,
        ),
        store,
        account,
        values,
    };
}

describe("ProfileSync", () => {
    it("will sync one profile without any UserInfo", async () => {
        const time = Date.now();
        const {profileSync, account, values, store} = createProfileSync();
        await profileSync.updateProfile(dummyProtocol, "alice@foobar.com", account as any, false);
        expect(values.displayname).to.equal("alice@foobar.com");
        expect(values.userId).to.equal("@_bifrost_dummy_alice=40foobar.com:localhost");
        const matrixUser = await store.getMatrixUser(values.userId);
        expect(matrixUser?.get("last_check")).to.be.above(time);
        expect(matrixUser?.get("displayname")).to.be.equal(values.displayname);
        expect(matrixUser?.get("avatar_url")).to.be.undefined;
    });
    it("can sync one profile without useful UserInfo", async () => {
        const time = Date.now();
        const {profileSync, account, values, store} = createProfileSync({
            foo: "bar",
        });
        await profileSync.updateProfile(dummyProtocol, "alice@foobar.com", account as any, false);
        expect(values.displayname).to.equal("alice@foobar.com");
        expect(values.userId).to.equal("@_bifrost_dummy_alice=40foobar.com:localhost");
        const matrixUser = await store.getMatrixUser(values.userId);
        expect(matrixUser?.get("last_check")).to.be.above(time);
        expect(matrixUser?.get("displayname")).to.be.equal(values.displayname);
        expect(matrixUser?.get("avatar_url")).to.be.undefined;
    });
    it("can sync one profile with a nickname", async () => {
        const time = Date.now();
        const {profileSync, account, values, store} = createProfileSync({
            Nickname: "SuperAlice",
        });
        await profileSync.updateProfile(dummyProtocol, "alice@foobar.com", account as any, false);
        expect(values.displayname).to.equal("SuperAlice");
        expect(values.userId).to.equal("@_bifrost_dummy_alice=40foobar.com:localhost");
        const matrixUser = await store.getMatrixUser(values.userId);
        expect(matrixUser?.get("last_check")).to.be.above(time);
        expect(matrixUser?.get("displayname")).to.be.equal("SuperAlice");
        expect(matrixUser?.get("avatar_url")).to.be.undefined;
    });
    it("can sync one profile with a avatar ", async () => {
        const time = Date.now();
        const {profileSync, account, values, store} = createProfileSync({
            Avatar: "http://example.com/myamazingavatar.png",
        });
        await profileSync.updateProfile(dummyProtocol, "alice@foobar.com", account as any, false);
        expect(values.displayname).to.equal("alice@foobar.com");
        expect(values.userId).to.equal("@_bifrost_dummy_alice=40foobar.com:localhost");
        const matrixUser = await store.getMatrixUser(values.userId);
        expect(matrixUser?.get("last_check")).to.be.above(time);
        expect(matrixUser?.get("displayname")).to.be.equal("alice@foobar.com");
        expect(values.avatarUrl).to.be.equal("mxc://example.com/foobar");
        expect(matrixUser?.get("avatar_url")).to.be.equal("http://example.com/myamazingavatar.png");
    });
    it("will skip the second profile update", async () => {
        const time = Date.now();
        const {profileSync, account, values, store} = createProfileSync({});
        await profileSync.updateProfile(dummyProtocol, "aconvo@foobar.com/FOO!$BAR", account as any, false);
        const matrixUser = await store.getMatrixUser(values.userId);
        expect(matrixUser?.get("last_check")).to.be.above(time);
        const lastTime = matrixUser?.get("last_check");
        await profileSync.updateProfile(dummyProtocol, "aconvo@foobar.com/FOO!$BAR", account as any, false);
        const matrixUserTwo = await store.getMatrixUser(values.userId);
        expect(matrixUserTwo?.get("last_check")).to.be.equal(lastTime);
    });
});
