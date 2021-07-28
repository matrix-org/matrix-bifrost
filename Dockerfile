# Build node-purple. We need buster for python3.6, which is needed for node-purple
FROM node:14-buster as builder
COPY ./package.json ./package.json
COPY ./yarn.lock ./yarn.lock
COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json

# node-purple dependencies
RUN apt-get update && apt-get install -y libpurple0 libpurple-dev libglib2.0-dev python3 git build-essential
# This will build the optional dependency node-purple AND compile the typescript.
RUN yarn install --frozen-lockfile --check-files

# App
FROM node:14-buster-slim

RUN mkdir app
WORKDIR /app

# Install node-purple runtime dependencies.
RUN apt-get update && apt-get install -y libpurple0 pidgin-sipe
COPY ./package.json /app/package.json
COPY ./yarn.lock /app/yarn.lock

# Don't install devDependencies, or optionals.
RUN yarn --check-files --production --ignore-optional

# Copy the compiled node-purple module
COPY --from=builder ./node_modules/node-purple /app/node_modules/node-purple

# Copy compiled JS
COPY --from=builder ./lib /app/lib

# Copy the schema for validation purposes.
COPY ./config/config.schema.yaml ./config/config.schema.yaml

VOLUME [ "/data" ]

# Needed for libpurple symbols to load. See https://github.com/matrix-org/matrix-bifrost/issues/257
ENV LD_PRELOAD="/usr/lib/libpurple.so.0"

ENTRYPOINT [ "node", \
	"/app/lib/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]
