import { RemoteUser, AppServiceBot } from "matrix-appservice-bridge";

export class BifrostRemoteUser {
    public static fromRemoteUser(remoteUser: RemoteUser, asBot: AppServiceBot, userId: string): BifrostRemoteUser {
        return new BifrostRemoteUser(
            remoteUser.getId(),
            remoteUser.get("username"),
            remoteUser.get("protocol_id") || remoteUser.get("protocolId"),
            asBot.isRemoteUser(userId),
            remoteUser.get("displayname"),
            remoteUser.data,
        );
    }

    constructor(
        public readonly id: string,
        public readonly username: string,
        public readonly protocolId: string,
        public readonly isRemote: boolean,
        public readonly displayname?: string,
        public readonly extraData: unknown = {}) {
        // do nothing
    }
}
