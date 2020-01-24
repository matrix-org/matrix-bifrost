import { MatrixRoom, RemoteRoom, MatrixUser } from "matrix-appservice-bridge";
import { IChatJoinProperties } from "../bifrost/Events";

export const MROOM_TYPE_UADMIN = "user-admin";
export const MROOM_TYPE_IM = "im";
export const MROOM_TYPE_GROUP = "group";

export const MUSER_TYPE_ACCOUNT = "account";
export const MUSER_TYPE_GHOST = "ghost";

export type MROOM_TYPES = "user-admin"|"im"|"group";
export type MUSER_TYPES = "account"|"ghost";

export interface IRemoteRoomData {
    protocol_id?: string;
}

export interface IRemoteGroupData extends IRemoteRoomData {
    room_name?: string;
    properties?: IChatJoinProperties;
    gateway?: boolean;
}

export interface IRemoteImData extends IRemoteRoomData {
    matrixUser?: string;
    recipient?: string;
}

export interface IRemoteUserAdminData extends IRemoteRoomData {
    matrixUser?: string;
}

export interface IMatrixUserData {
    accounts: {[key: string]: IRemoteUserAccount};
}

export interface IRemoteUserAccount {
    // XXX: We are mixing camel case and snake case in here.
    type: MUSER_TYPES;
    username: string;
    protocolId: string;
    /**
     * @deprecated Use type: "ghost"
     */
    isRemoteUser: boolean;
}

export interface IRemoteUserAccountRemote extends IRemoteUserAccount {
    isRemoteUser: true;
    /**
     * Last time the profile was checked for this remote user, in milliseconds
     */
    last_check?: number;
    displayname?: string;
    avatar_url?: string;
    protocol_data: {[key: string]: string|number};
}

export interface IRoomEntry {
    matrix: MatrixRoom|undefined;
    remote: RemoteRoom|undefined;
}
