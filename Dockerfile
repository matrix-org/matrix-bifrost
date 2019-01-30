# Builder
FROM node:10-slim as builder

COPY ./package.json ./package.json
COPY ./package-lock.json ./package-lock.json
COPY ./src ./src
COPY ./tsconfig.json ./tsconfig.json

RUN npm install
# Compile Typescript
RUN npm run build

# App
FROM node:10-slim

RUN mkdir app
WORKDIR /app

COPY ./package.json /app/package.json
COPY ./package-lock.json /app/package-lock.json
# Don't install devDependencies
RUN npm install --production 
# Copy compiled JS only
COPY --from=builder ./build /app/src
COPY ./config/config.schema.yaml ./config/config.schema.yaml


VOLUME [ "/data" ]

ENTRYPOINT [ "node", \
	"/app/src/Program.js", \
	"--port", "5000", \
	"--config", "/data/config.yaml", \
	"--file", "/data/registration.yaml" \
]
