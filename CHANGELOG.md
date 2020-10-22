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

