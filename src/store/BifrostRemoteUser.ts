import { RemoteUser } from "matrix-appservice-bridge";
import { MUSER_TYPE_ACCOUNT, MUSER_TYPE_GHOST } from "./Types";

export class BifrostRemoteUser {
    constructor(public readonly remoteUser: RemoteUser, private userIds: string, public readonly isRemote: boolean) {

    }

    public get extraData() {
        return this.remoteUser.data;
    }

    public get id() {
        return this.remoteUser.getId();
    }

    public get username(): string {
        return this.remoteUser.get("username");
    }

    public get protocolId() {
        return this.remoteUser.get("protocol_id") || this.remoteUser.get("protocolId");
    }

    public get isAccount() {
        return this.remoteUser.get("type") === MUSER_TYPE_ACCOUNT;
    }

    public get isGhost() {
        return this.remoteUser.get("type") === MUSER_TYPE_GHOST;
    }

    public get displayname(): string|undefined {
        return this.remoteUser.get("displayname");
    }
}