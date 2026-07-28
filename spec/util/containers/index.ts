import { ProsodyContainer, XMPP_TEST_USER, type StartedProsodyContainer, XMPP_TEST_PASSWORD } from "./prosody";
import { SynapseContainer, type StartedSynapseContainer } from "./synapse";

import {
    TestContainers,
    Network,
    StartedNetwork,
} from "testcontainers";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { AppServiceRegistration, AppServiceOutput } from "matrix-appservice-bridge";
import { randomUUID } from "node:crypto";
import { Client as PgClient } from "pg";

export interface TestContainerNetwork {
    network: StartedNetwork;
    synapse: StartedSynapseContainer;
    prosody: StartedProsodyContainer;
    postgres: StartedPostgreSqlContainer;
    registration: AppServiceRegistration;
}

export async function createContainers(
    serverName: string,
    appservicePort: number,
): Promise<TestContainerNetwork> {
    // Ensure the port forwarder is running so containers can call back into the host process.
    await TestContainers.exposeHostPorts(appservicePort);

    const network = await new Network().start();

    const registration = AppServiceRegistration.fromObject({
        id: "bifrost",
        hs_token: randomUUID(),
        as_token: randomUUID(),
        url: `http://host.testcontainers.internal:${appservicePort}`,
        sender_localpart: "_bifrost_bot",
        namespaces: {
            users: [{ exclusive: true, regex: `@_bifrost_.*:${serverName}` }],
            aliases: [{ exclusive: true, regex: `#_bifrost_.*:${serverName}` }],
        },
        "de.sorunome.msc2409.push_ephemeral": true,
    } as AppServiceOutput);

    const [synapse, prosody, postgres] = await Promise.all([
        new SynapseContainer(serverName).withNetwork(network).withAppServiceRegistration(registration).start(),
        new ProsodyContainer().withNetwork(network).start(),
        new PostgreSqlContainer("postgres:16-alpine")
            .withDatabase("bifrost")
            .withUsername("bifrost")
            .withPassword("bifrost")
            .withNetwork(network)
            .start(),
    ]);

    await prosody.registerUser(XMPP_TEST_USER, XMPP_TEST_PASSWORD);

    return { network, synapse, prosody, postgres, registration };
}

/**
 * Create a fresh, empty database on the shared Postgres container and return its connection string.
 * Callers are responsible for dropping the database again via dropDatabase().
 */
export async function createDatabase(postgres: StartedPostgreSqlContainer): Promise<{name: string, connectionString: string}> {
    const name = `bifrost_e2e_${randomUUID().replace(/-/g, "_")}`;
    const client = new PgClient(postgres.getConnectionUri());
    try {
        await client.connect();
        await client.query(`CREATE DATABASE ${name}`);
    } finally {
        await client.end();
    }
    const connectionString = new URL(postgres.getConnectionUri());
    connectionString.pathname = `/${name}`;
    return { name, connectionString: connectionString.toString() };
}

export async function dropDatabase(postgres: StartedPostgreSqlContainer, name: string): Promise<void> {
    const client = new PgClient(postgres.getConnectionUri());
    try {
        await client.connect();
        await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    } finally {
        await client.end();
    }
}
