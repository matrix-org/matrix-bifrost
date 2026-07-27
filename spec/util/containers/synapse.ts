import {
    GenericContainer,
    Wait,
    AbstractStartedContainer,
    StartedTestContainer,
} from "testcontainers";
import { AppServiceRegistration } from "matrix-appservice-bridge";
import YAML from "yaml";
import { randomUUID } from "node:crypto";

const DEFAULT_SYNAPSE_IMAGE = process.env.SYNAPSE_IMAGE || "ghcr.io/element-hq/synapse:latest";
const DEFAULT_SIGNING_KEY = "ed25519 a_DTli HDSh+iM94MpMlvoebjuY3hqmHi/CU7j8kANUsq1gjws";

// Sets up a Synapse homeserver in a test container.
// Adapted from matrix-hookshot's spec/util/containers.ts::SynapseContainer.
export class SynapseContainer extends GenericContainer {
    private appserviceFiles: Set<string> = new Set();

    public readonly signingKey: string;
    public readonly registrationSecret: string;

    constructor(
        public readonly serverName: string,
        opts: { signingKey?: string; image?: string } = {},
    ) {
        super(opts.image ?? DEFAULT_SYNAPSE_IMAGE);
        this.withNetworkAliases(serverName)
            .withExposedPorts(8008)
            .withTmpFs({ "/media_store": "rw,noexec,nosuid,size=65536k" })
            .withWaitStrategy(Wait.forHttp("/_matrix/client/versions", 8008))
            .withEnvironment({ SERVER_NAME: serverName });

        this.signingKey = opts.signingKey ?? DEFAULT_SIGNING_KEY;
        this.registrationSecret = randomUUID();
    }

    public withAppServiceRegistration(registration: AppServiceRegistration): this {
        const target = `/__conf/appservices/${randomUUID()}.yaml`;
        const content = YAML.stringify(registration.getOutput());
        this.withCopyContentToContainer([{ content, target }]);
        this.appserviceFiles.add(target);
        return this;
    }

    private generateConfig() {
        const rc = { per_second: 9999, burst_count: 9999 };
        return {
            server_name: this.serverName,
            signing_key: this.signingKey,
            listeners: [{
                port: 8008,
                bind_addresses: ["::"],
                type: "http",
                tls: false,
                x_forwarded: false,
                resources: [{ names: ["client", "federation"] }],
            }],
            report_stats: false,
            trusted_key_servers: [],
            enable_registration: false,
            bcrypt_rounds: 4,
            registration_shared_secret: this.registrationSecret,
            app_service_config_files: Array.from(this.appserviceFiles),
            federation_ip_range_blacklist: [],
            database: { name: "sqlite3", args: { database: ":memory:" } },
            rc_federation: { window_size: 1000, sleep_limit: 10, sleep_delay: 500, reject_limit: 99999, concurrent: 3 },
            rc_message: rc,
            rc_registration: rc,
            rc_login: { address: rc, account: rc, failed_attempts: rc },
            rc_admin_redaction: rc,
            rc_joins: { local: rc, remote: rc },
            rc_joins_per_room: rc,
            rc_3pid_validation: rc,
            rc_invites: { per_room: rc, per_user: rc },
            federation_rr_transactions_per_room_per_second: 9999,
            // Bifrost's typing events rely on ephemeral event pushing.
            experimental_features: {
                msc2409_to_device_messages_enabled: true,
            },
        };
    }

    public override async beforeContainerCreated(): Promise<void> {
        const target = "/__conf/config.yaml";
        const content = YAML.stringify(this.generateConfig());
        this.withCopyContentToContainer([{ content, target }]);
        this.withEnvironment({ SYNAPSE_CONFIG_PATH: target });
    }

    public override async start(): Promise<StartedSynapseContainer> {
        return new StartedSynapseContainer(
            this.serverName,
            this.registrationSecret,
            await super.start(),
        );
    }
}

export class StartedSynapseContainer extends AbstractStartedContainer {
    constructor(
        public readonly serverName: string,
        public readonly registrationSecret: string,
        startedTestContainer: StartedTestContainer,
    ) {
        super(startedTestContainer);
    }

    public get baseUrl(): string {
        return `http://${this.getHost()}:${this.getMappedPort(8008)}`;
    }
}
