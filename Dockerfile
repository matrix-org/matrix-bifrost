# Build node-purple, which needs Debian for Python
FROM node:22-bookworm AS builder

WORKDIR /build
COPY /package.json ./package.json
COPY /yarn.lock ./yarn.lock
COPY /src ./src
COPY /tsconfig.json ./tsconfig.json

# node-purple dependencies
RUN apt-get update && apt-get install --no-install-recommends -y libpurple0 libpurple-dev libglib2.0-dev python3 git build-essential
# This will build the optional dependency node-purple AND compile the typescript.
RUN yarn install --frozen-lockfile --check-files

# App
FROM node:22-bookworm-slim

RUN mkdir app
WORKDIR /app

# Install node-purple runtime dependencies.
RUN apt-get update && apt-get install --no-install-recommends -y libpurple0 pidgin-sipe
COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock

# Don't install devDependencies, or optionals.
RUN yarn --check-files --production --ignore-optional && yarn cache clean

# Copy the compiled node-purple module
COPY --from=builder /build/node_modules/node-purple /app/node_modules/node-purple

# Copy compiled JS
COPY --from=builder /build/lib /app/lib

# Copy the schema for validation purposes.
COPY /config/config.schema.yaml /app/config/config.schema.yaml

VOLUME [ "/data" ]

# Needed for libpurple symbols to load. See https://github.com/matrix-org/matrix-bifrost/issues/257
ENV LD_PRELOAD="/usr/lib/libpurple.so.0"

ENTRYPOINT [ "node", \
	"--enable-source-maps", \
	"/app/lib/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]
