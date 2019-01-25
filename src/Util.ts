import { IChatJoinProperties } from "./purple/PurpleEvents";
import { PurpleProtocol } from "./purple/PurpleProtocol";
import { MatrixUser } from "matrix-appservice-bridge";
import { ProtoHacks } from "./ProtoHacks";
import * as crypto from "crypto";

export class Util {

    public static MINUTE_MS = 60000;

    public static createRemoteId(protocol: string, id: string) {
        return `${protocol}://${id}`;
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

    public static sanitizeProperties(props: IChatJoinProperties): IChatJoinProperties {
        for (const k of Object.keys(props)) {
            const value = props[k];
            const newkey = k.replace(/\./g, "·");
            delete props[k];
            props[newkey] = value;
        }
        return props;
    }

    public static desanitizeProperties(props: IChatJoinProperties) {
        for (const k of Object.keys(props)) {
            const value = props[k];
            const newkey = k.replace(/·/g, ".");
            delete props[k];
            props[newkey] = value;
        }
        return props;
    }
}
