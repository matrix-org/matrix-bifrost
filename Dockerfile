# Builder
FROM node:14-buster as builder

COPY ./package.json ./package.json
COPY ./yarn.lock ./yarn.lock
COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json

# For node-purple (we need buster for python3.6+)
RUN apt-get update && apt-get install -y libpurple0 libpurple-dev libglib2.0-dev python3 git build-essential
RUN yarn install --frozen-lockfile

# App
FROM node:14-buster-slim

RUN mkdir app
WORKDIR /app

RUN apt-get update && apt-get install -y libpurple0 pidgin-sipe
COPY ./package.json /app/package.json
COPY ./yarn.lock /app/yarn.lock

# Built in previous step
# Don't install devDependencies, node-purple will probably fail so we copy it in from the builder
RUN npm i
COPY --from=builder ./node_modules/node-purple /app/node_modules/node-purple
# Copy compiled JS only
COPY --from=builder ./lib /app/lib
COPY ./config/config.schema.yaml ./config/config.schema.yaml


VOLUME [ "/data" ]

# Needed for libpurple symbols to load
ENV LD_PRELOAD="/usr/lib/libpurple.so.0"

ENTRYPOINT [ "node", \
	"/app/lib/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]
