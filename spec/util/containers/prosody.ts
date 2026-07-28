import {
    GenericContainer,
    Wait,
    AbstractStartedContainer,
    StartedTestContainer,
} from "testcontainers";


const DEFAULT_PROSODY_IMAGE = process.env.PROSODY_IMAGE || "prosody/prosody:latest";

// The domain the Bifrost xmpp-js component connects to Prosody as (XEP-0114).
export const XMPP_COMPONENT_DOMAIN = "matrixbridge.localhost";
// Shared secret configured on the "Component" line in prosody.cfg.lua.
export const XMPP_COMPONENT_SECRET = "bifrost_component_secret";
// A real XMPP client account, registered on Prosody's VirtualHost, used to act as a "human" XMPP user in tests.
export const XMPP_C2S_DOMAIN = "xmpp.localhost";
export const XMPP_TEST_USER = "bob";
export const XMPP_TEST_PASSWORD = "xmpp_password";
// Fixed so tests can compute the expected ghost mxid (XJSInstance#getMxIdForProtocol
// puts the resource first in the localpart) deterministically.
export const XMPP_TEST_RESOURCE = "testinstance";
// A MUC component, for tests that bridge XMPP group chats into Matrix portal rooms.
export const XMPP_MUC_DOMAIN = "conference.xmpp.localhost";

const PROSODY_C2S_PORT = 5222;
const PROSODY_COMPONENT_PORT = 5347;

function prosodyConfig(): string {
    // Adapted from matrix-bifrost's abandoned hs/e2e-test branch (.github/support/prosody.cfg.lua),
    // which is proven to work with the xmpp-js backend's XEP-0114 component connection.
    // TLS is intentionally disabled here (this never leaves the test container network).
    return `
pidfile = "/var/run/prosody/prosody.pid"

modules_enabled = {
    "roster";
    "saslauth";
    "dialback";
    "disco";
    "carbons";
    "pep";
    "private";
    "blocklist";
    "vcard";
    "version";
    "uptime";
    "time";
    "ping";
    "register";
    "admin_adhoc";
}

allow_registration = true
c2s_require_encryption = false
s2s_require_encryption = false
s2s_secure_auth = false
-- This is a test-only server on an isolated docker network; there's no TLS
-- certificate to negotiate, so explicitly allow PLAIN auth over plaintext c2s.
allow_unencrypted_plain_auth = true
authentication = "internal_hashed"
-- @xmpp/client always prefers SCRAM-SHA-1 over PLAIN when both are offered, and there's
-- a SCRAM-SHA-1 interop bug somewhere in this dependency tree (server rejects the response
-- as malformed-request). Force PLAIN by disabling SCRAM-SHA-1 server-side; fine for an
-- ephemeral, throwaway test server.
disable_sasl_mechanisms = { "SCRAM-SHA-1" }

component_ports = { ${PROSODY_COMPONENT_PORT} }
component_interfaces = { "*" }

log = "*console"

VirtualHost "${XMPP_C2S_DOMAIN}"

Component "${XMPP_COMPONENT_DOMAIN}"
    component_secret = "${XMPP_COMPONENT_SECRET}"

Component "${XMPP_MUC_DOMAIN}" "muc"
    name = "Chatrooms"
`;
}

export class ProsodyContainer extends GenericContainer {
    constructor(image = DEFAULT_PROSODY_IMAGE) {
        super(image);
        this.withExposedPorts(PROSODY_C2S_PORT, PROSODY_COMPONENT_PORT)
            .withWaitStrategy(Wait.forListeningPorts())
            .withCopyContentToContainer([
                { content: prosodyConfig(), target: "/etc/prosody/prosody.cfg.lua" },
            ]);
    }

    public override async start(): Promise<StartedProsodyContainer> {
        return new StartedProsodyContainer(await super.start());
    }
}

export class StartedProsodyContainer extends AbstractStartedContainer {
    constructor(startedTestContainer: StartedTestContainer) {
        super(startedTestContainer);
    }

    public get componentService(): string {
        return `xmpp://${this.getHost()}:${this.getMappedPort(PROSODY_COMPONENT_PORT)}`;
    }

    public get c2sPort(): number {
        return this.getMappedPort(PROSODY_C2S_PORT);
    }

    public async registerUser(username: string, password: string): Promise<void> {
        const result = await this.exec([
            "prosodyctl", "register", username, XMPP_C2S_DOMAIN, password,
        ]);
        if (result.exitCode !== 0) {
            throw Error(`Failed to register XMPP user ${username}: ${result.output}`);
        }
    }
}
