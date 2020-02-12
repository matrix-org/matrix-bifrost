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

