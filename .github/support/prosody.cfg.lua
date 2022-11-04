run_as_root = true
daemonize = false

---------- Server-wide settings ----------
-- Settings in this section apply to the whole server and are the default settings
-- for any virtual hosts

-- This is a (by default, empty) list of accounts that are admins
-- for the server. Note that you must create the accounts separately
-- (see https://prosody.im/doc/creating_accounts for info)
-- Example: admins = { "user1@example.com", "user2@example.net" }
admins = { }

-- Enable use of libevent for better performance under high load
-- For more information see: https://prosody.im/doc/libevent
--use_libevent = true

-- Prosody will always look in its source directory for modules, but
-- this option allows you to specify additional locations where Prosody
-- will look for modules first. For community modules, see https://modules.prosody.im/
plugin_paths = { "/usr/lib/prosody-modules" }

-- This is the list of modules Prosody will load on startup.
-- It looks for mod_modulename.lua in the plugins folder, so make sure that exists too.
-- Documentation for bundled modules can be found at: https://prosody.im/doc/modules
modules_enabled = {

    -- Generally required
        "roster"; -- Allow users to have a roster. Recommended ;)
        "saslauth"; -- Authentication for clients and servers. Recommended if you want to log in.
        "tls"; -- Add support for secure TLS on c2s/s2s connections
        "dialback"; -- s2s dialback support
        "disco"; -- Service discovery

    -- Not essential, but recommended
        "carbons"; -- Keep multiple clients in sync
        "pep"; -- Enables users to publish their mood, activity, playing music and more
        "private"; -- Private XML storage (for room bookmarks, etc.)
        "blocklist"; -- Allow users to block communications with other users
        "vcard"; -- Allow users to set vCards

    -- Nice to have
        "version"; -- Replies to server version requests
        "uptime"; -- Report how long server has been running
        "time"; -- Let others know the time here on this server
        "ping"; -- Replies to XMPP pings with pongs
        "register"; -- Allow users to register on this server using a client and change passwords
        --"mam"; -- Store messages in an archive and allow users to access it

    -- Admin interfaces
        "admin_adhoc"; -- Allows administration via an XMPP client that supports ad-hoc commands
        --"admin_telnet"; -- Opens telnet console interface on localhost port 5582

    -- HTTP modules
        --"bosh"; -- Enable BOSH clients, aka "Jabber over HTTP"
        --"websocket"; -- XMPP over WebSockets
        --"http_files"; -- Serve static files from a directory over HTTP

    -- Other specific functionality
        --"limits"; -- Enable bandwidth limiting for XMPP connections
        --"groups"; -- Shared roster support
        "server_contact_info"; -- Publish contact information for this service
        --"announce"; -- Send announcement to all online users
        --"welcome"; -- Welcome users who register accounts
        --"watchregistrations"; -- Alert admins of registrations
        --"motd"; -- Send a message to users when they log in
        --"legacyauth"; -- Legacy authentication. Only used by some old clients and bots.
        --"proxy65"; -- Enables a file transfer proxy service which clients behind NAT can use

      "bidi" -- Bi-directional S2S streams

      -- Bridging
      -- This was disabled as we now use components, which do not require us to register users.
      -- "register_json"
}

-- These modules are auto-loaded, but should you want
-- to disable them then uncomment them here:
modules_disabled = {
    -- "offline"; -- Store offline messages
    -- "c2s"; -- Handle client connections
    -- "s2s"; -- Handle server-to-server connections
    "posix"; -- POSIX functionality, sends server to background, enables syslog, etc.
}

allow_registration = true
c2s_require_encryption = true
s2s_require_encryption = true
s2s_secure_auth = true

component_ports = { 5347 }
component_interfaces = { "*" }

authentication = "internal_hashed"

archive_expires_after = "1w" -- Remove archived messages after 1 week

log = "*console"

-- Uncomment to enable statistics
-- For more info see https://prosody.im/doc/statistics
-- statistics = "internal"

-- Certificates
-- Every virtual host and component needs a certificate so that clients and
-- servers can securely verify its identity. Prosody will automatically load
-- certificates/keys from the directory specified here.
-- For more information, including how to use 'prosodyctl' to auto-import certificates
-- (from e.g. Let's Encrypt) see https://prosody.im/doc/certificates

-- Location of directory to find certificates in (relative to main config file):
certificates = "certs"

VirtualHost "localhost"

-- This must be localhost, it's not used but it allows
-- prosody to start.

------ Components ------

-- This is for the purple bridge
Component "matrixbridge.localhost"
         component_secret = "my_service_password"