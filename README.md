# matrix-appservice-purple

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
