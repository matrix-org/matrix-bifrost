/* eslint-disable no-console */
/* eslint-disable max-classes-per-file */
import { Config } from '../../src/Config';
import { Program } from '../../src/Program';
import { ComplementHomeServer, createHS, destroyHS } from "./homerunner";
import { describe, beforeEach, afterEach, jest } from '@jest/globals';
import { AppServiceRegistration } from "matrix-appservice-bridge";
import { MatrixClient } from "matrix-bot-sdk";
import { Client as PgClient } from "pg";
import { client, Client as XMPPClient } from "@xmpp/client"

const DEFAULT_E2E_TIMEOUT = parseInt(process.env.TEST_TIMEOUT ?? '90000', 10);
const WAIT_EVENT_TIMEOUT = 10000;

// TODO: Expose these
const DEFAULT_PORT = parseInt(process.env.XMPP_TEST_PORT ?? '6667', 10);
const DEFAULT_ADDRESS = process.env.XMPP_TEST_ADDRESS ?? "127.0.0.1";

interface Opts {
    matrixLocalparts?: string[];
    timeout?: number;
}

interface DescribeEnv {
    homeserver: ComplementHomeServer;
    bifrostBridge: Program;
    client: XMPPClient;
}

export class BifrostTestEnvironment {

    /**
     * Test wrapper that automatically provisions an IRC server and Matrix server
     *
     * @param name The test name
     * @param fn The inner function
     * @returns A jest describe function.
     */
    static describeTest(name: string, fn: (env: () => DescribeEnv) => void, opts?: Opts) {
        return describe(name, () => {
            jest.setTimeout(opts?.timeout ?? DEFAULT_E2E_TIMEOUT);
            let env: BifrostTestEnvironment;
            beforeEach(async () => {
                env = new BifrostTestEnvironment();
                await env.setUp(opts?.matrixLocalparts);
            });
            afterEach(async () => {
                await env.tearDown();
            });
            fn(() => {
                if (!env.homeserver) {
                    throw Error('Homeserver not defined');
                }
                if (!env.bifrostBridge) {
                    throw Error('ircBridge not defined');
                }
                return { client: env.client, homeserver: env.homeserver, bifrostBridge: env.bifrostBridge }
            });
        });
    }

    public homeserver?: ComplementHomeServer;
    public bifrostBridge?: Program;
    public postgresDb?: string;
    public client: XMPPClient;

    constructor() {
        this.client = client({
            domain: "localhost",
            resource: "testinstance",
            username: "bob",
            password: "xmpp_password",
        });
    }

    private async createDatabase() {
        const pgClient = new PgClient(`${process.env.IRCBRIDGE_TEST_PGURL}/postgres`);
        try {
            await pgClient.connect();
            const postgresDb = `${process.env.IRCBRIDGE_TEST_PGDB}_${process.hrtime().join("_")}`;
            await pgClient.query(`CREATE DATABASE ${postgresDb}`);
            return postgresDb;
        }
        finally {
            await pgClient.end();
        }
    }

    private async dropDatabase() {
        if (!this.postgresDb) {
            // Database was never set up.
            return;
        }
        const pgClient = new PgClient(`${process.env.BIFROST_TEST_PGURL}/postgres`);
        await pgClient.connect();
        await pgClient.query(`DROP DATABASE ${this.postgresDb}`);
        await pgClient.end();
    }

    public async setUp(matrixLocalparts?: string[]): Promise<void> {
        // Setup PostgreSQL.
        this.postgresDb = await this.createDatabase();
        const [postgresDb, homeserver] = await Promise.all([
            this.createDatabase(),
            createHS(["ircbridge_bot", ...matrixLocalparts || []]),
            // super.setUp(clients),
        ]);
        this.homeserver = homeserver;
        this.postgresDb = postgresDb;
        await this.client.connect("xmpp://localhost");
        const config = new Config();
        config.ApplyConfig({
            bridge: {
                homeserver: this.homeserver.domain,
                homeserverUrl: this.homeserver.url,
                appservicePort: this.homeserver.appserviceConfig.port,
            },
            datastore: {
                engine: "postgres",
                connectionString: `${process.env.BIFROST_TEST_PGURL}/${this.postgresDb}`
            },
            purple: {
                backend: "xmpp-js",
                backendOpts: {
                    service: process.env.BIFROST_TEST_XMPP_SERVICE,
                    domain: process.env.BIFROST_TEST_XMPP_DOMAIN,
                    password: process.env.BIFROST_TEST_XMPP_PASSWORD,
                },
                enableGateway: true,
                aliases: {
                    "^xmpp_(.+)_(.+)$": {
                        protocol: "xmpp-js",
                        properties: {
                            room: "regex:1",
                            server: "regex:2",
                        }
                    }
                }
            },
            autoRegistration: {
                enabled: true,
                protocolSteps: {
                    "xmpp-js": {
                        type: "implicit",
                        parameters: {
                            username: `<T_LOCALPART>@${process.env.BIFROST_TEST_XMPP_DOMAIN}`
                        }
                    }
                }
            },
            logging: {
                console: "debug",
            }
        });

        this.bifrostBridge = new Program();
        const appservices = AppServiceRegistration.fromObject({
            id: this.homeserver.id,
            as_token: this.homeserver.appserviceConfig.asToken,
            hs_token: this.homeserver.appserviceConfig.hsToken,
            sender_localpart: this.homeserver.appserviceConfig.senderLocalpart,
            namespaces: {
                users: [{
                    exclusive: true,
                    regex: `@xmpp_.+:${this.homeserver.domain}`,
                }],
                // TODO: No support on complement yet:
                // https://github.com/matrix-org/complement/blob/8e341d54bbb4dbbabcea25e6a13b29ead82978e3/internal/docker/builder.go#L413
                aliases: [{
                    exclusive: true,
                    regex: `#xmpp_.+:${this.homeserver.domain}`,
                }]
            },
            url: "not-used",
        });
        console.log('Starting bridge')
        await this.bifrostBridge.runBridge(7777, config, appservices);
    }

    public async tearDown(): Promise<void> {
        await Promise.allSettled([
            this.bifrostBridge?.killBridge(),
            this.homeserver?.users.map(c => c.client.stop()),
            this.homeserver && destroyHS(this.homeserver.id),
            this.client.stop(),
            this.dropDatabase(),
        ]);
    }
}

export class E2ETestMatrixClient extends MatrixClient {

    public async waitForRoomEvent(
        opts: {eventType: string, sender: string, roomId?: string, stateKey?: string}
    ): Promise<{roomId: string, data: unknown}> {
        const {eventType, sender, roomId, stateKey} = opts;
        return this.waitForEvent('room.event', (eventRoomId: string, eventData: {
            sender: string, type: string, state_key?: string, content: unknown
        }) => {
            console.info(`Got ${eventRoomId}`, eventData);
            if (eventData.sender !== sender) {
                return undefined;
            }
            if (eventData.type !== eventType) {
                return undefined;
            }
            if (roomId && eventRoomId !== roomId) {
                return undefined;
            }
            if (stateKey !== undefined && eventData.state_key !== stateKey) {
                return undefined;
            }
            return {roomId: eventRoomId, data: eventData};
        }, `Timed out waiting for ${eventType} from ${sender} in ${roomId || "any room"}`)
    }

    public async waitForRoomInvite(
        opts: {sender: string, roomId?: string}
    ): Promise<{roomId: string, data: unknown}> {
        const {sender, roomId} = opts;
        return this.waitForEvent('room.invite', (eventRoomId: string, eventData: {
            sender: string
        }) => {
            const inviteSender = eventData.sender;
            console.info(`Got invite to ${eventRoomId} from ${inviteSender}`);
            if (eventData.sender !== sender) {
                return undefined;
            }
            if (roomId && eventRoomId !== roomId) {
                return undefined;
            }
            return {roomId: eventRoomId, data: eventData};
        }, `Timed out waiting for invite to ${roomId || "any room"} from ${sender}`)
    }

    public async waitForEvent<T>(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        emitterType: string, filterFn: (...args: any[]) => T|undefined, timeoutMsg: string)
        : Promise<T> {
        return new Promise((resolve, reject) => {
            // eslint-disable-next-line prefer-const
            let timer: NodeJS.Timeout;
            const fn = (...args: unknown[]) => {
                const data = filterFn(...args);
                if (data) {
                    clearTimeout(timer);
                    resolve(data);
                }
            };
            timer = setTimeout(() => {
                this.removeListener(emitterType, fn);
                reject(new Error(timeoutMsg));
            }, WAIT_EVENT_TIMEOUT);
            this.on(emitterType, fn)
        });
    }
}
