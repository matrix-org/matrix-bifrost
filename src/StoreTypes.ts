import { MatrixRoom, RemoteRoom, MatrixUser } from "matrix-appservice-bridge";
import { IChatJoinProperties } from "./purple/PurpleEvents";

export const MROOM_TYPE_UADMIN = "user-admin";
export const MROOM_TYPE_IM = "im";
export const MROOM_TYPE_GROUP = "group";

export type MROOM_TYPES = "user-admin"|"im"|"group";

export interface IRemoteRoomData {
    type?: MROOM_TYPES; // One of [MROOM_TYPE_UADMIN, MROOM_TYPE_IM]
    protocol_id?: string;
}

export interface IRemoteGroupData extends IRemoteRoomData {
    type?: "group";
    room_name?: "string";
    properties?: IChatJoinProperties;
    gateway?: boolean;
}

export interface IRemoteImData extends IRemoteRoomData {
    type?: "im";
    matrixUser?: MatrixUser;
    recipient?: string;
}

export interface IMatrixUserData {
    accounts: {[key: string]: IRemoteUserAccount};
}

export interface IRemoteUserAccount {
    username: string;
    protocolId: string;
}

export interface IRoomEntry {
    matrix: MatrixRoom|undefined;
    remote: RemoteRoom|undefined;
}
