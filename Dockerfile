# Build node-purple, which needs Debian for Python
FROM node:22-trixie@sha256:072889700aecef94c5cee46c6e60107cc2aaad9aa9e418ce05abaa1e85752ee3 AS builder

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
FROM node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4 AS deps

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
FROM node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4 AS purple

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
FROM gcr.io/distroless/nodejs22-debian13:debug@sha256:bd8598495bbaf6bb1f60aac1b948d5ca44f344c91dc9eea99e79c5d5393759e2 AS debug

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
FROM gcr.io/distroless/nodejs22-debian13@sha256:f6c6d1b8ffe2691053118b5f607691142639305aedf25411bb95905e859a2e28

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
