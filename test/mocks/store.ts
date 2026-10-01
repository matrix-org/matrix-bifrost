import { IStore } from "../../src/store/Store";
import { FakeStore } from "./FakeStore";

const DEF_REGEX = /@remote/;

export function mockStore(remoteUserRegex = DEF_REGEX): IStore {
  return new FakeStore({
    isRemoteUser: (u) => remoteUserRegex.exec(u) !== null,
  });
}
