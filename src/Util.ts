import { PurpleProtocol } from "./purple/PurpleInstance";
import { MatrixUser } from "matrix-appservice-bridge";
import { ProtoHacks } from "./ProtoHacks";

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
        senderId = ProtoHacks.getSenderId(protocol, senderId, isGroupChat);
        // This is a little bad, but we drop the prpl- because it's a bit ugly.
        const protocolName = protocol.id.startsWith("prpl-") ? protocol.id.substr("prpl-".length) : protocol.id;
        // senderId containing : can mess things up
        senderId = senderId.replace(/\:/g, "=3a");
        return new MatrixUser(`@${prefix}${protocolName}_${senderId}:${domain}`);
    }
}
