/// <reference types="vitest/config" />

import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["test/**/test_*.ts"],
        setupFiles: ["test/test.ts"],
        coverage: {
            provider: "v8",
            include: ["src/**"],
            exclude: ["src/Program.ts"],
            reporter: ["lcov", "text-summary"],
            thresholds: {
                lines: 85,
                statements: 85,
                functions: 75,
                branches: 75,
            },
        },
    },
});
