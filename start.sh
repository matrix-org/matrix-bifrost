#!/bin/bash
npm run build
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libpurple.so.0 npm start -- --port 9555