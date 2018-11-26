#!/bin/bash
npm run build
LD_PRELOAD=./node_modules/node-purple/deps/libpurple/libpurple.so npm start -- --port 3642
#LD_PRELOAD=/usr/lib/libpurple.so.0 npm start -- --port 9555
