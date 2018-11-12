import { PurpleProtocol } from "./purple/PurpleInstance";
import { MatrixUser } from "matrix-appservice-bridge";

export class Util {
    public static createRemoteId(protocol: string, id: string) {
        return `${protocol}://${id}`;
    }

    public static getMxIdForProtocol(protocol: PurpleProtocol, senderId: string, domain: string, prefix: string = ""): MatrixUser {
        // XXX: XMPP senders have a /host appended to their sender.
        // We're stripping them because they look ugly AF.
        if (protocol.id === "prpl-jabber") {
            senderId = senderId.split("/")[0];
        }
        // This is a little bad, but we drop the prpl- because it's a bit ugly.
        const protocolName = protocol.id.startsWith("prpl-") ? protocol.id.substr("prpl-".length) : protocol.id;
        // senderId containing : can mess things up
        senderId = senderId.replace(/\:/g, "=3a");
        return new MatrixUser(`@${prefix}${protocolName}_${senderId}:${domain}`);
    }
}
