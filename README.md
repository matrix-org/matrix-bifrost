# matrix-appservice-purple

[![Build Status](https://travis-ci.org/matrix-org/matrix-appservice-purple.svg?branch=develop)](https://travis-ci.org/matrix-org/matrix-appservice-purple)
[![#purple-bridge:half-shot.uk](https://img.shields.io/badge/matrix-%23purple--bridge%3Ahalf--shot.uk-lightgrey.svg)](https://matrix.to/#/#purple-bridge:half-shot.uk)

General purpose bridging using libpurple 

This bridge is in a pre-alpha state while we get all the bits and pieces working. However you may run it at your own risk

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
# ... Edit the config to taste
```

## Usage

### Generate a registration file

```shell
npm run genreg -- -u http://localhost:9555 # Set listener url here.
```

### Starting

(Note, we reccomend using the `start.sh` script and modifying the port where needed)

```shell
npm run start -- -p 9555
```

### Binding purple accounts to a Matrix User

The bridge won't do much unless it has accounts to bind. Due to the infancy of the bridge, we still use `~/.purple/accounts.xml`
for the location of all the accounts. Our advice is to create the accounts you want to use on your local machine with Pidgin, and
then copy the `accounts.xml` file to the bridge (where you should be copying the file to `/$BRIDGE_USER/.purple/accounts.xml`).

Once you have started the bridge, you can instruct it to bind by starting a conversation with the bridge user and 
sending `accounts add-existing $PROTOCOL $USERNAME` where the protocol and username are given in the `accounts.xml` file.

You should also run `accounts enable $PROTOCOL $USERNAME` to enable the account for the bridge, and then it should connect automatically.

## Help

### My bridge crashed with a segfault

The `node-purple` rewrite is still not quite bugfree and we are working hard to iron out the kinks in it. We ask that you report
if certain purple plugins cause more crashes, or if anything in particular lead up to it.
