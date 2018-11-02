# matrix-appservice-purple
General purpose bridging using libpurple 

**Note: This will not work for you yet. The `node-purple` supporting bit's are not all set up and ready yet**

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
