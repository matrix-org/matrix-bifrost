#!/bin/bash
npm run build
LD_PRELOAD=./node_modules/node-purple/deps/libpurple/libpurple.so npm start -- --port 9555
