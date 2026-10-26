# Build node-purple, which needs Debian for Python
FROM node:24-trixie@sha256:016f604a11c4c725f0a4c62e29ff11adab153d297bf97046c9bf2ddb9f1011d3 AS builder

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
FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS deps

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
FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS purple

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
FROM gcr.io/distroless/nodejs24-debian13:debug@sha256:0b53969943b26ddc7044e2b5a1ddcf1685257559fa9f888dee579b9b4dc14057 AS debug

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
FROM gcr.io/distroless/nodejs24-debian13@sha256:206cfbab1a64af20b63645150e3aa61b7babc17869e0254914947732963d6f07

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
