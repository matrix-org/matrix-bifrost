Hi there! Please read the [CONTRIBUTING.md](https://github.com/matrix-org/matrix-appservice-bridge/blob/develop/CONTRIBUTING.md) guide for all matrix.org bridge
projects.

## Matrix-bifrost Guidelines

 - When creating an issue, please clearly state whether you are using libpurple or xmpp.js. If possible, please also state the server and client implementation name and versions.

## Releasing

* Ensure you have a Python3 env and then `pip install towncrier`
* Bump the version in `package.json`
* Run `scripts/towncrier.sh`
* Commit the resulting changes
* Create a git tag and push everything
* Create a release in GitHub