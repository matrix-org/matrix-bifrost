# Build node-purple, which needs Debian for Python
FROM node:24-trixie@sha256:be40f6a87b9b22215ddb20da0a2320a5c6d583fe3ee3b0024d9fa4f05b40c8fd AS builder

WORKDIR /build
COPY /package.json ./package.json
COPY /yarn.lock ./yarn.lock
COPY /src ./src
COPY /tsconfig.json ./tsconfig.json

# node-purple dependencies
RUN apt-get update && apt-get install --no-install-recommends -y libpurple0t64 libpurple-dev libglib2.0-dev python3 git build-essential
# This will build the optional dependency node-purple AND compile the typescript.
RUN yarn install --frozen-lockfile --check-files

# Production dependencies and compiled app, shared by all variants
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS deps

WORKDIR /app
COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock

# Don't install devDependencies, or optionals.
RUN yarn --check-files --production --ignore-optional && yarn cache clean

# Copy compiled JS
COPY --from=builder /build/lib /app/lib

# Copy the schema for validation purposes.
COPY /config/config.schema.yaml /app/config/config.schema.yaml

# Variant with libpurple, for the node-purple backend. Build with `--target purple`.
FROM node:24-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe AS purple

# Update the bundled npm, to ensure latest.
RUN npm install -g npm@12.2.0 && npm cache clean --force

WORKDIR /app

# Install node-purple runtime dependencies.
RUN apt-get update && apt-get upgrade -y && apt-get install --no-install-recommends -y libpurple0t64

COPY --from=deps /app /app

# Copy the compiled node-purple module
COPY --from=builder /build/node_modules/node-purple /app/node_modules/node-purple

VOLUME [ "/data" ]

# Needed for libpurple symbols to load. See https://github.com/matrix-org/matrix-bifrost/issues/257
ENV LD_PRELOAD="libpurple.so.0"

ENTRYPOINT [ "node", \
	"--enable-source-maps", \
	"/app/lib/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]

# Default variant with a busybox shell, for debugging. Build with `--target debug`.
FROM gcr.io/distroless/nodejs24-debian13:debug@sha256:dad95587745231bc073f33fa76856511dc8d9ca49cd5dfdae92d174342ee7303 AS debug

# Make `node` available from the shell.
ENV PATH="/nodejs/bin:${PATH}"

WORKDIR /app

COPY --from=deps /app /app

VOLUME [ "/data" ]

ENTRYPOINT [ "/nodejs/bin/node", \
	"--enable-source-maps", \
	"/app/lib/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]

# Default variant, for the xmpp-js backend. Distroless, so there is no shell or package manager.
FROM gcr.io/distroless/nodejs24-debian13@sha256:85482a8359e1524bd1278f5b418bb397bbebbf2b5ceeea7ec13a9e640e2c1911

WORKDIR /app

COPY --from=deps /app /app

VOLUME [ "/data" ]

ENTRYPOINT [ "/nodejs/bin/node", \
	"--enable-source-maps", \
	"/app/lib/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]
