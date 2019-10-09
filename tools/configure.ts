import { Logging } from "matrix-appservice-bridge";
import { Command } from "commander";
import { Config } from "../src/Config";
import * as yaml from "yaml";
import { promises } from "fs";

Logging.configure({console: "info"});
const log = Logging.get("script");

async function main(): Promise<number> {
    const program = new Command();
    program.description("Generate or check your bifrost bridge configuration file");
    program.option("-c, --check", "Check if the configuration is correct", false);
    program.option("-f, --config", "Config file", "config.yaml");
    program.parse(process.argv);
    const checkMode = program.check;
    const config: Config = new Config();
    try {
        const stat = await promises.stat(program.config);
        if (!checkMode) {
            log.error("Script is running in configure mode but config file already exists");
            return 2;
        }
        if (stat.isDirectory()) {
            log.error("Given config file is actually a directory");
            throw Error("is directory");
        }
    } catch (ex) {
        if (checkMode) {
            log.error("Config file is invalid or does not exist. Not proceeding.");
            return 2;
        }
    }
    if (program.f) {
        const doc = yaml.parse(program.f);
        config.ApplyConfig(doc);
    }
    if (checkMode) {
        await checkConfig();
    } else {
        await generateConfig();
    }
    return 0;
}

async function checkConfig() {

}

async function generateConfig() {

}

main().then((code) => {
    if (code === 0) {
        log.info("Script finished");
    } else {
        log.error("Script failed");
    }
    process.exit(code);
}).catch((ex) => {
    log.error("Script failed:", ex);
    process.exit(1);
});
