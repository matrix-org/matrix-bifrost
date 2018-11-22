import { PurpleProtocol } from "./purple/PurpleInstance";
import { MatrixUser } from "matrix-appservice-bridge";
import { ProtoHacks } from "./ProtoHacks";
import * as crypto from "crypto";

export class Util {

    public static MINUTE_MS = 60000;

    public static createRemoteId(protocol: string, id: string) {
        return `${protocol}://${id}`;
    }

    public static getMxIdForProtocol(
        protocol: PurpleProtocol,
        senderId: string,
        domain: string,
        prefix: string = "",
        isGroupChat: boolean = false): MatrixUser {
        // This is a little bad, but we drop the prpl- because it's a bit ugly.
        const protocolName = protocol.id.startsWith("prpl-") ? protocol.id.substr("prpl-".length) : protocol.id;
        // senderId containing : can mess things up
        senderId = senderId.replace(/\:/g, "=3a");
        return new MatrixUser(`@${prefix}${protocolName}_${senderId}:${domain}`);
    }

    public static passwordGen(minLength: number = 32): string {
        let password = "";
        while (password.length < minLength) {
            // must be printable
            for (const char of crypto.randomBytes(32)) {
                if (char >= 32 && char <= 126) {
                    password += String.fromCharCode(char);
                }
            }
        }
        return password;
    }
}
