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

