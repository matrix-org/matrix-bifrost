# matrix-bifröst

[![Build Status](https://travis-ci.org/matrix-org/matrix-appservice-purple.svg?branch=master)](https://travis-ci.org/matrix-org/matrix-bifr-st)
[![#rainbum:half-shot.uk](https://img.shields.io/badge/matrix-%23bifrost%3Ahalf--shot.uk-lightgrey.svg)](https://matrix.to/#/#bifrost:half-shot.uk)

General purpose puppeting bridges using libpurple and other backends.

This bridge is in very active development currently and intended mainly for experimentation and evaluation purposes.

This has been tested to work on `Node.JS v10` and `Synapse 0.34.0`.

**You must read this README carefully as simply installing required dependencies may NOT be enough for some backends**

## Backends

This bridge features multiple backends for spinning up bridges on different types of network.
The following are supported:
* `xmpp.js`
    Designed to bridge to XMPP networks directly, without purple. Good for setups requiring an extremely scalable XMPP bridge. Uses XMPP components.
* `node-purple`
    Uses libpurple to bridge to a number of networks supported by libpurple2. Good for simple bridges for a small number of users, or for bridging to less available protocols.
    * **WARNING**: If using `node-purple` then you MUST install the dependency: `npm i node-purple`
## Installing

### Dependencies

For `node-purple` to compile correctly, you will need (for Debian):

* build-essential
* libuv1

You can install this on Ubuntu/Debian using `sudo apt install build-essential libuv1`.

Instructions for other distributions will come soon.

### Installing & Configuring

```shell
npm install # Install dependencies
npm run build # Build files
cp config.sample.yaml config.yaml
# ... Set the domain name, homeserver url, and then review the rest of the config
sed -i  "s/domain: \"localhost\"/domain: \"$YOUR_MATRIX_DOMAIN\"/g" config.yaml
```

You must also generate a registration file:

```shell
npm run genreg -- -u http://localhost:9555 # Set listener url here.
```

This file should be accessible by your **homeserver**, which will use this file to get the correct url and tokens to push events to.

### XMPP bridge using the xmpp.js backend

After completing all the above, you should do the following:
* Set the `purple.backend` in `config.yaml` to `xmpp.js`
* Possibly change the registration file alias and user regexes
  to be `_xmpp_` instead of `_purple_`. Make sure to replicate those
  changes in `config.yaml`
* Setup your XMPP server to support a new component.
* Setup the `purple.backendOpts` options for the new component.
* Setup autoregistration and portals in `config.yaml`.

### Starting

The `start.sh` script will auto preload the build libpurple library and offers a better experience than the system libraries in most cases. Pleas remember to modify the port in the script if you are using a different port. 

If you are not using the `node-purple` backend, you can just start the service with:

```shell
npm run start -- -p 9555
```

## Help

### Binding purple accounts to a Matrix User

The bridge won't do much unless it has accounts to bind. Due to the infancy of the bridge, we still use `~/.purple/accounts.xml`
for the location of all the accounts. Our advice is to create the accounts you want to use on your local machine with Pidgin, and
then copy the `accounts.xml` file to the bridge (where you should be copying the file to `/$BRIDGE_USER/.purple/accounts.xml`).

Once you have started the bridge, you can instruct it to bind by starting a conversation with the bridge user and 
sending `accounts add-existing $PROTOCOL $USERNAME` where the protocol and username are given in the `accounts.xml` file.

You should also run `accounts enable $PROTOCOL $USERNAME` to enable the account for the bridge, and then it should connect automatically.

#### Bridging XMPP room (on node-purple)

Connect to your matrix server and open a chat with `@_purple_bot:$YOUR_MATRIX_DOMAIN`.
```
accounts add-existing prpl-jabber $USERNAME@$XMPP_SERVER/$CLIENT_NAME
accounts enable prpl-jabber $USERNAME@$XMPP_SERVER/$CLIENT_NAME
accounts
join xmpp $ROOM $XMPP_SERVER
```

### My bridge crashed with a segfault

The `node-purple` rewrite is still not quite bugfree and we are working hard to iron out the kinks in it. We ask that you report
if certain purple plugins cause more crashes, or if anything in particular lead up to it.


## Testing

Running the tests is as simple as doing `npm run test`
