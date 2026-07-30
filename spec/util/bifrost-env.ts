import { Program } from "../../src/Program";
import { Config, ConfigValue } from "../../src/Config";
import { createContainers, createDatabase, dropDatabase, TestContainerNetwork } from "./containers";
import {
  XMPP_COMPONENT_DOMAIN,
  XMPP_COMPONENT_SECRET,
  XMPP_C2S_DOMAIN,
  XMPP_TEST_USER,
  XMPP_TEST_PASSWORD,
  XMPP_TEST_RESOURCE,
} from "./containers/prosody";
import { E2ETestMatrixClient } from "./e2e-test";
import { client as xmppClient } from "@xmpp/client";
import { jid } from "@xmpp/jid";
import { webcrypto, createHash, createHmac } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MatrixUser } from "matrix-appservice-bridge";

const DEFAULT_SERVER_NAME = "localhost";
// Each test env reserves a block of 10 ports, so mediaproxy/appservice ports never collide
// across concurrently-running BifrostTestEnv instances within the same Vitest worker.
const PORT_BLOCK_SIZE = 10;
const APPSERVICE_PORT_BASE = 21000;
let portBlockCounter = 0;

function nextPortBlock(): number {
  // VITEST_WORKER_ID keeps port blocks from colliding when Vitest shards spec files across workers.
  const worker = parseInt(process.env.VITEST_WORKER_ID ?? "0", 10);
  return APPSERVICE_PORT_BASE + worker * 1000 + portBlockCounter++ * PORT_BLOCK_SIZE;
}

async function generateSigningKey(dir: string): Promise<string> {
  const key = await webcrypto.subtle.generateKey({ name: "HMAC", hash: "SHA-512" }, true, [
    "sign",
    "verify",
  ]);
  const jwk = await webcrypto.subtle.exportKey("jwk", key);
  const keyPath = path.join(dir, "signingkey.jwk");
  fs.writeFileSync(keyPath, JSON.stringify(jwk));
  return keyPath;
}

async function registerMatrixUser(
  homeserverUrl: string,
  sharedSecret: string,
  localpart: string,
): Promise<{ mxid: string; accessToken: string }> {
  const registerUrl = `${homeserverUrl}/_synapse/admin/v1/register`;
  const nonce = await fetch(registerUrl)
    .then((r) => r.json())
    .then((j: { nonce: string }) => j.nonce);
  const password = createHash("sha256").update(localpart).update(sharedSecret).digest("hex");
  const hmac = createHmac("sha1", sharedSecret)
    .update(nonce)
    .update("\x00")
    .update(localpart)
    .update("\x00")
    .update(password)
    .update("\x00")
    .update("notadmin")
    .digest("hex");
  const res = (await fetch(registerUrl, {
    method: "POST",
    body: JSON.stringify({ nonce, username: localpart, password, admin: false, mac: hmac }),
  }).then((r) => r.json())) as { user_id?: string; access_token?: string };
  if (!res.access_token || !res.user_id) {
    throw Error(`Failed to register Matrix user ${localpart}: ${JSON.stringify(res)}`);
  }
  return { mxid: res.user_id, accessToken: res.access_token };
}

// Matches the Config class's default bridge.userPrefix (see src/Config.ts); the harness
// never overrides it, so it's safe to hardcode here for computing expected ghost mxids.
export const BIFROST_USER_PREFIX = "_bifrost_";

/**
 * Mirrors XJSInstance#getMxIdForProtocol (src/xmppjs/XJSInstance.ts) so tests can compute
 * the expected Matrix ghost mxid for a given XMPP sender without duplicating that logic inline.
 */
export function ghostMxidForXmppUser(homeserverDomain: string, senderJid: string): string {
  const j = jid(senderJid);
  const resource = j.resource ? `${j.resource}/` : "";
  const localpart = j.local
    ? `${BIFROST_USER_PREFIX}${resource}${j.local}@${j.domain}`
    : `${BIFROST_USER_PREFIX}${resource}${j.domain}`;
  // MatrixUser's constructor escapes the localpart by default (ESCAPE_DEFAULT = true),
  // matching what XJSInstance#getMxIdForProtocol produces (it also just does `new MatrixUser(...)`).
  const user = new MatrixUser(`@${localpart}:${homeserverDomain}`);
  return user.userId;
}

export interface BifrostTestEnvOpts {
  matrixLocalparts?: string[];
  /** Merged over the default e2e bridge config, for scenario-specific overrides (e.g. gateway/portals). */
  config?: ConfigValue;
}

/**
 * Boots a real Synapse + Prosody + Postgres, then starts Bifrost's xmpp-js backend
 * in-process against them. One instance is shared across all tests in a spec file
 * (see fixtures.ts).
 */
export class BifrostTestEnv {
  public readonly serverName = DEFAULT_SERVER_NAME;
  public readonly users: Map<string, E2ETestMatrixClient> = new Map();

  private xmppClient?: ReturnType<typeof xmppClient>;
  private containers?: TestContainerNetwork;
  private bridge?: Program;
  private tmpDir?: string;
  private dbName?: string;

  public get botMxid(): string {
    return `@_bifrost_bot:${this.serverName}`;
  }

  public getUser(localpart: string): E2ETestMatrixClient {
    const user = this.users.get(localpart);
    if (!user) {
      throw Error(`User ${localpart} was not created for this test (add it to matrixLocalparts)`);
    }
    return user;
  }

  public get xmpp(): ReturnType<typeof xmppClient> {
    if (!this.xmppClient) {
      throw Error("XMPP client not connected");
    }
    return this.xmppClient;
  }

  public async setUp(opts: BifrostTestEnvOpts = {}): Promise<void> {
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bifrost-e2e-"));
    const portBlock = nextPortBlock();
    const appservicePort = portBlock;
    const mediaProxyPort = portBlock + 1;

    this.containers = await createContainers(this.serverName, appservicePort);
    const { synapse, prosody, postgres, registration } = this.containers;

    const [signingKeyPath, db] = await Promise.all([
      generateSigningKey(this.tmpDir),
      createDatabase(postgres),
    ]);
    this.dbName = db.name;

    for (const localpart of opts.matrixLocalparts ?? []) {
      const { accessToken } = await registerMatrixUser(
        synapse.baseUrl,
        synapse.registrationSecret,
        localpart,
      );
      const client = new E2ETestMatrixClient(synapse.baseUrl, accessToken);
      await client.start();
      this.users.set(localpart, client);
    }

    this.xmppClient = xmppClient({
      service: `xmpp://${prosody.getHost()}:${prosody.c2sPort}`,
      domain: XMPP_C2S_DOMAIN,
      username: XMPP_TEST_USER,
      password: XMPP_TEST_PASSWORD,
      resource: XMPP_TEST_RESOURCE,
    });
    await this.xmppClient.start();

    const config = new Config();
    config.ApplyConfig({
      bridge: {
        domain: this.serverName,
        homeserverUrl: synapse.baseUrl,
        appservicePort,
      },
      mediaProxy: {
        signingKeyPath,
        ttlSeconds: 3600,
        bindPort: mediaProxyPort,
        publicUrl: `http://localhost:${mediaProxyPort}/media`,
      },
      datastore: {
        engine: "postgres",
        connectionString: db.connectionString,
      },
      purple: {
        backend: "xmpp-js",
        backendOpts: {
          service: prosody.componentService,
          domain: XMPP_COMPONENT_DOMAIN,
          password: XMPP_COMPONENT_SECRET,
        },
      },
      autoRegistration: {
        enabled: true,
        protocolSteps: {
          "xmpp-js": {
            type: "implicit",
            parameters: {
              username: `<T_LOCALPART>_<T_DOMAIN>@${XMPP_COMPONENT_DOMAIN}`,
            },
          },
        },
      },
      logging: {
        console: process.env.BIFROST_TEST_LOG_LEVEL ?? "warn",
      },
    } as ConfigValue);
    if (opts.config) {
      config.ApplyConfig(opts.config);
    }

    this.bridge = new Program();
    await this.bridge.runBridge(appservicePort, config as any, registration);
  }

  public async tearDown(): Promise<void> {
    await Promise.allSettled([
      this.xmppClient?.stop(),
      ...[...this.users.values()].map((u) => u.stop()),
    ]);
    // Synapse pushes AS transactions to the bridge's HTTP listener asynchronously, so stop
    // it before killing the bridge - otherwise a straggling push can land on a port that's
    // already closed. Testcontainers relays that inbound connection back to the host via an
    // SSH tunnel (see exposeHostPorts in containers/index.ts) whose relay socket has no
    // error handler, so an ECONNREFUSED there crashes the whole test process instead of
    // just failing a request.
    await this.containers?.synapse.stop();
    await this.bridge?.killBridge();
    await Promise.allSettled([
      this.dbName && this.containers
        ? dropDatabase(this.containers.postgres, this.dbName)
        : Promise.resolve(),
      this.containers?.prosody.stop(),
      this.containers?.postgres.stop(),
    ]);
    await this.containers?.network.stop();
    if (this.tmpDir) {
      fs.rmSync(this.tmpDir, { recursive: true, force: true });
    }
  }
}
