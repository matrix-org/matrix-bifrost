import { test as baseTest } from "vitest";
import { BifrostTestEnv, BifrostTestEnvOpts } from "./bifrost-env";

const DefaultOpts = {
  matrixLocalparts: ["alice"],
} satisfies Partial<BifrostTestEnvOpts>;

// One Synapse+Prosody+Postgres+Bifrost stack is booted per spec file and shared
// across all `test()`s in that file. Override `testEnvOpts` per-file via `.override(...)`
// for scenarios that need different bridge config (e.g. gateway/portals).
export const test = baseTest
  .extend("testEnvOpts", { scope: "file" }, () => ({}) as BifrostTestEnvOpts)
  .extend("testEnv", { scope: "file" }, async ({ testEnvOpts }, { onCleanup }) => {
    const env = new BifrostTestEnv();
    await env.setUp({ ...DefaultOpts, ...testEnvOpts });
    onCleanup(() => env.tearDown());
    return env;
  })
  .extend("alice", { scope: "file" }, async ({ testEnv }) => testEnv.getUser("alice"));
