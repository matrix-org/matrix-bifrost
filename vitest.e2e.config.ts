/// <reference types="vitest/config" />

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["spec/*.spec.ts"],
        // Booting Synapse + Prosody + Postgres containers and starting Bifrost can take a while.
        hookTimeout: 120000,
        testTimeout: 30000,
        retry: process.env.CI ? 2 : 0,
    },
});
