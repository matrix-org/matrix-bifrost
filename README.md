# matrix-appservice-purple
General purpose bridging using libpurple 

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
