import { Logger } from "matrix-appservice-bridge";

if (process.argv.includes("--logging")) {
    Logger.configure({console: "debug"});
} else {
    Logger.configure({console: "error"});
}