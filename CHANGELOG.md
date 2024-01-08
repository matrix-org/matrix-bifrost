1.0.0 (2024-01-08)
==================

Deprecations and Removals
-------------------------

- Drop support for Node 16, and support Node 20 and 21. ([\#343](https://github.com/matrix-org/matrix-bifrost/issues/343))


Internal Changes
----------------

- Upgrade json5 (development dependency) to 1.0.2 to fix prototype pollution vulnerability. ([\#328](https://github.com/matrix-org/matrix-bifrost/issues/328))


0.4.2 (2022-12-01)
==================

Bugfixes
--------

- Fix being unable to join XMPP MUCs via Matrix room aliases. ([\#323](https://github.com/matrix-org/matrix-bifrost/issues/323))


0.4.1 (2022-11-16)
===================

Bugfixes
--------

- Fix crash on startup due to logging / metrics failures. ([\#321](https://github.com/matrix-org/matrix-bifrost/issues/321))


0.4.0 (2022-11-07)
===================

This release requires **Node.JS 16** or greater.

Features
--------

- Add support for Jingle file uploads, presence, IM typing notifications for the XMPP backend. ([\#288](https://github.com/matrix-org/matrix-bifrost/issues/288))
- Include attachment URLs (if present) with libpurple-bridged messages ([\#290](https://github.com/matrix-org/matrix-bifrost/issues/290))


Bugfixes
--------

- Fix an issue where Bifrost could not register users (by upgrading to matrix-appservice-bridge@2.6.0) ([\#246](https://github.com/matrix-org/matrix-bifrost/issues/246))
- Don't log pings being sent before they're actually sent ([\#260](https://github.com/matrix-org/matrix-bifrost/issues/260))
- Make XMPP connection handling more resilient ([\#264](https://github.com/matrix-org/matrix-bifrost/issues/264))
- Fix message formatter sometimes producing invalid HTML ([\#286](https://github.com/matrix-org/matrix-bifrost/issues/286))
- correct typo of pluginDir in sample config/doc ([\#302](https://github.com/matrix-org/matrix-bifrost/issues/302))


Deprecations and Removals
-------------------------

- The minimum supported version of node.js is now 16. ([\#315](https://github.com/matrix-org/matrix-bifrost/issues/315))


Internal Changes
----------------

- Optimize updateMatrixMemberListForRoom() ([\#243](https://github.com/matrix-org/matrix-bifrost/issues/243))
- Migrate to `eslint` for linting. ([\#262](https://github.com/matrix-org/matrix-bifrost/issues/262))
- Sanity check that the homeserver can reach the bridge on startup. ([\#266](https://github.com/matrix-org/matrix-bifrost/issues/266))
- Update dependencies including `axios`, `prom-client` and `uuid`. The handling of entities in XMPP messages is now XML compliant rather than HTML5 complaint. ([\#267](https://github.com/matrix-org/matrix-bifrost/issues/267))
- Add new store function `getAdminRoom` and rename `getRoomByRemoteData` -> `getGroupRoomByRemoteData` ([\#272](https://github.com/matrix-org/matrix-bifrost/issues/272))
- Speed up joins for large rooms from XMPP gateways, preventing them from locking up the process ([\#293](https://github.com/matrix-org/matrix-bifrost/issues/293))
- Docker images are now automatically build and published via GitHub Actions, replacing DockerHub Autobuilds. ([\#295](https://github.com/matrix-org/matrix-bifrost/issues/295))
- Use GitHub actions for CI. ([\#316](https://github.com/matrix-org/matrix-bifrost/issues/316))


0.3.0 (2021-04-26)
==================

Features
--------

- Add `roomRules` configuration to block rooms. ([\#224](https://github.com/matrix-org/matrix-bifrost/issues/224))


Bugfixes
--------

- - Add @xmpp/component-core and @xmpp/reconnect dependencies so the project is installed well with pnpm (#173). Thanks to @bodqhrohro ([\#192](https://github.com/matrix-org/matrix-bifrost/issues/192))
- If the bridge is already connected to a remote room requested via an alias, add that alias to the room. ([\#208](https://github.com/matrix-org/matrix-bifrost/issues/208))
- Fix bridge errors not showing human error text due to a missing attribute on a stanza. ([\#209](https://github.com/matrix-org/matrix-bifrost/issues/209))
- Download files as binary instead of as UTF-8 string. ([\#220](https://github.com/matrix-org/matrix-bifrost/issues/220))
- Fix TypeError in MatrixEventHandler ([\#221](https://github.com/matrix-org/matrix-bifrost/issues/221))


Internal Changes
----------------

- Improve remote gateway join performance ([\#222](https://github.com/matrix-org/matrix-bifrost/issues/222))
- Validate room joins to ensure they contain a handle, domain and localparts ([\#225](https://github.com/matrix-org/matrix-bifrost/issues/225))


0.2.0 (2020-10-30)
===================

Internal Changes
----------------

- Add CONTRIBUTING.md ([\#189](https://github.com/matrix-org/matrix-bifrost/issues/189))


0.2.0-rc2 (2020-10-27)
=======================

Features
--------

- Check if a MUC room exists before creating a portal ([\#188](https://github.com/matrix-org/matrix-bifrost/issues/188))


Bugfixes
--------

- XMPP self-pings to gateways will now return an error if the device is not in a MUC ([\#184](https://github.com/matrix-org/matrix-bifrost/issues/184))
- The bridge will no longer part remote users who have another device joined to a gateway room ([\#185](https://github.com/matrix-org/matrix-bifrost/issues/185))
- Ensure stanzas are emitted in the right order when an XMPP user joins a MUC ([\#189](https://github.com/matrix-org/matrix-bifrost/issues/189))


0.2.0-rc1 (2020-10-22)
=======================

Features
--------

- Report message corrections as an available feature to MUCs ([\#149](https://github.com/matrix-org/matrix-bifrost/issues/149))
- Support Matrix -> XMPP edits ([\#154](https://github.com/matrix-org/matrix-bifrost/issues/154))
- Set the user's displayname in the room based on their nickname ([\#161](https://github.com/matrix-org/matrix-bifrost/issues/161))
- The bridge will now close the AS and XMPP connections on a SIGTERM signal ([\#182](https://github.com/matrix-org/matrix-bifrost/issues/182))


Bugfixes
--------

- Fix compatibility with XEP-0045 by only sending messages after sending all presence to new joiners ([\#134](https://github.com/matrix-org/matrix-bifrost/issues/134))
- Fix a bug that would cause some XMPP clients to assume that Gateway MUCs are unjoinable ([\#138](https://github.com/matrix-org/matrix-bifrost/issues/138))
- Fix bug where failed messages would be reported as successful ([\#148](https://github.com/matrix-org/matrix-bifrost/issues/148))
- Send leaves from the anonymous JID, not mxid ([\#150](https://github.com/matrix-org/matrix-bifrost/issues/150))
- Improve performance of Matrix -> XMPP gateway messages and joining ([\#159](https://github.com/matrix-org/matrix-bifrost/issues/159))
- Fix a critical issue where sending HTML with multiple attributes in a tag would cause the message to not be sent ([\#170](https://github.com/matrix-org/matrix-bifrost/issues/170))
- Do not send back an additional error stanza on S2S ping ([\#171](https://github.com/matrix-org/matrix-bifrost/issues/171))
- Self pings to gateways should check devices, not MUC JIDs ([\#177](https://github.com/matrix-org/matrix-bifrost/issues/177))
- Fix issue where XMPP users would not be informed of other XMPP users joining ([\#179](https://github.com/matrix-org/matrix-bifrost/issues/179))
- Fixed an issue where if creating a room for a remote chat failed, it would not allow users to retry joining ([\#180](https://github.com/matrix-org/matrix-bifrost/issues/180))
- Fix an issue where joining a room through the XMPP gateway would sometimes fail if the user was invited ([\#181](https://github.com/matrix-org/matrix-bifrost/issues/181))


Internal Changes
----------------

- Upgrade dependencies and types ([\#133](https://github.com/matrix-org/matrix-bifrost/issues/133))
- Tests now show Typescript stacktraces ([\#142](https://github.com/matrix-org/matrix-bifrost/issues/142))
- Use `/lib` for build output rather than `/build/(src|test)` ([\#169](https://github.com/matrix-org/matrix-bifrost/issues/169))
- Improve support for multiple devices for XMPP users connected to the gateway ([\#176](https://github.com/matrix-org/matrix-bifrost/issues/176))
- Some errors now report helpful error text ([\#178](https://github.com/matrix-org/matrix-bifrost/issues/178))


0.1.8 (2020-02-12)
===================

Bugfixes
--------

- Fix exception involving `log.log` ([\#109](https://github.com/matrix-org/matrix-bifrost/issues/109))


0.1.7 (2020-02-12)
===================

Bugfixes
--------

- Moved `source-map-support` to dependencies to fix a crash on startup. ([\#108](https://github.com/matrix-org/matrix-bifrost/issues/108))


0.1.6 (2020-02-12)
===================

Features
--------

- TypeScript stack traces are now shown instead of compiled JavaScript. ([\#105](https://github.com/matrix-org/matrix-bifrost/issues/105))


Bugfixes
--------

- Fix issue where the XMPP gateway would incorrecly report that a user isn't joined ([\#107](https://github.com/matrix-org/matrix-bifrost/issues/107))


0.1.5 (2020-02-10)
===================

Features
--------

- XMPP and Matrix users are no longer anonymous over the gateway. This is to keep in line with Matrix's own identity visibility. ([\#97](https://github.com/matrix-org/matrix-bifrost/issues/97))


Bugfixes
--------

- Matrix profiles can now be viewed over the gateway ([\#96](https://github.com/matrix-org/matrix-bifrost/issues/96))
- Refactor ping handling to support Server-Server pings. ([\#101](https://github.com/matrix-org/matrix-bifrost/issues/101))
- Kicking gatewayed XMPP users should now contain the correct status codes. ([\#102](https://github.com/matrix-org/matrix-bifrost/issues/102))
- Additionally, XMPP profiles should now be viewable over Matrix.


Internal Changes
----------------

- Use Typescript 3.7.5 ([\#95](https://github.com/matrix-org/matrix-bifrost/issues/95))
- Refactor vcard support for gateways ([\#103](https://github.com/matrix-org/matrix-bifrost/issues/103))
- Refactor profile handing for the gateway handler ([\#104](https://github.com/matrix-org/matrix-bifrost/issues/104))


0.1.4 (2020-02-03)
===================

Bugfixes
--------

- Fix issue where XMPP message corrections would not get sent to Matrix. ([\#90](https://github.com/matrix-org/matrix-bifrost/issues/90))
- `config.metrics.enable` should be `config.metrics.enabled`. Please update config files to match. ([\#92](https://github.com/matrix-org/matrix-bifrost/issues/92))
- Fix issue where sending content from a remote network will use the JSON body for the `url`.
- Fix self pings not quite working on XMPP.

0.1.3 (2020-01-24)
===================

Bugfixes
--------

- Fix bug where docker would not build using `yarn` ([\#89](https://github.com/matrix-org/matrix-bifrost/issues/89))


0.1.2 (2020-01-24)
===================

Features
--------

- Run Node 12 for docker image ([\#87](https://github.com/matrix-org/matrix-bifrost/issues/87))
- Bump `nyc` to 15.X ([\#88](https://github.com/matrix-org/matrix-bifrost/issues/88))


0.1.1 (2020-01-24)
===================

**NOTE**: This is the first versioned release for Bifrost. The application is still in an unstable state and is not reccomended for production use.

Features
--------

- Start tracking releases and using Towncrier. ([\#86](https://github.com/matrix-org/matrix-bifrost/issues/86))

