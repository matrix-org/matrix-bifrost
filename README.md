# matrix-bifröst

[![Build status](https://badge.buildkite.com/36e28cac6177e2faad18f63099e5422b4a839d525560e38ed0.svg)](https://buildkite.com/matrix-dot-org/matrix-bifrost)[![#bifrost:half-shot.uk](https://img.shields.io/matrix/bifrost:half-shot.uk?server_fqdn=matrix.half-shot.uk&label=%23bifrost:half-shot.uk&logo=matrix)](https://matrix.to/#/#bifrost:half-shot.uk)

General purpose puppeting bridges using libpurple and other backends.

This bridge is in very active development currently and intended mainly for experimentation and evaluation purposes.

This has been tested to work on `Node.JS v10` and `Synapse 0.34.0`.

## Helping out

If you wish to file an issue or create a PR, **please read [CONTRIBUTING.md](./CONTRIBUTING.md) first.

**NOTE: You must read this README carefully as simply installing required dependencies may NOT be enough for some backends**

## Backends

This bridge features multiple backends for spinning up bridges on different types of network.
The following are supported:
* `xmpp.js` *Supported on Docker*
    Designed to bridge to XMPP networks directly, without purple. Good for setups requiring an extremely scalable XMPP bridge. Uses XMPP components.
* `node-purple`
    Uses libpurple to bridge to a number of networks supported by libpurple2. Good for simple bridges for a small number of users, or for bridging to less available protocols.
    * **WARNING**: If using `node-purple` then you MUST install the dependency: `npm i node-purple`

## Docker

If you wish to use the `xmpp.js` backend, you can go straight ahead and use the provided Dockerfile
to build the bridge. You can build the docker image with `docker build -t bifrost:latest` and then
run the image with: `docker run -v /your/path/to/data:/data bifrost:latest -p 5000:9555`.

An image is available on [Dockerhub](https://hub.docker.com/r/matrixdotorg/matrix-bifrost).

### Things to note

- Make sure you store your `config.yaml`, `registration.yaml` inside /data.
- You should configure your `config.yaml`'s `userStoreFile` and `roomStoreFile` to point to files inside `/data`
- The intenal port for the bridge is `5000`, you should map this to an external port in docker.
- Be careful not to leave any config options pointing to `127.0.0.1` / `localhost` as they will not resolve inside docker.
 - The exception to this rule is `bridge.domain`, which MUST be your homeserver's URL.

## Installing (non-docker)

### Dependencies

For `node-purple` to compile correctly, you will need (for Debian):

* build-essential
* libuv1

You can install this on Ubuntu/Debian using `sudo apt install build-essential libuv1`.

Instructions for other distributions will come soon.

### Installing & Configuring

**NOTE: You must carefully read the config.sample.yaml and use the bits appropriate for you. Do NOT copy and paste it verbatim as it won't work.**

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

For Synapse, this can be done by:

* Editing `app_service_config_files` in `homeserver.yaml` to include the full path of your registration file generated above.

```yaml
app_service_config_files: 
    - ".../bifrost-registration.yaml"
```

* Restart synapse, if it is running (`synctl restart`)


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
