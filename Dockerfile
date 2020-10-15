# Builder
FROM node:14-slim as builder

COPY ./package.json ./package.json
COPY ./yarn.lock ./yarn.lock
COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json

RUN yarn install

# App
FROM node:12-slim

RUN mkdir app
WORKDIR /app

COPY ./package.json /app/package.json
COPY ./yarn.lock /app/yarn.lock
# Don't install devDependencies
RUN yarn install --production --ignore-scripts
# Copy compiled JS only
COPY --from=builder ./lib /app/lib
COPY ./config/config.schema.yaml ./config/config.schema.yaml


VOLUME [ "/data" ]

ENTRYPOINT [ "node", \
	"/app/lib/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]
