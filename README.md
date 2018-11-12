# matrix-appservice-purple

General purpose bridging using libpurple 

This bridge is in a pre-alpha state while we get all the bits and pieces working. However you may run it at your own risk

## Installing

```
npm install # Install dependencies
npm run build # Build files
cp config.sample.yaml config.yaml
# ... Edit the config to taste
```

## Usage

### Generate a registration file

```
npm run genreg -- -u http://localhost:9555 # Set listener url here.
```

### Starting

```
npm run start -- -p 9555
```
