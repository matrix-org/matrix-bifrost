import { MatrixRoom, RemoteRoom } from "matrix-appservice-bridge";

export const MROOM_TYPE_UADMIN = "user-admin";
export const MROOM_TYPE_IM = "im";
export const MROOM_TYPE_GROUP = "group";

export type MROOM_TYPES = "user-admin"|"im"|"group";

export interface IMatrixRoomData {
    type: string; // One of [MROOM_TYPE_UADMIN, MROOM_TYPE_IM]
}

export interface IMatrixUserData {
    accounts: {[key: string]: IMatrixUserAccount};
}

export interface IMatrixUserAccount {
    username: string;
    protocolId: string;
}

export interface IRoomEntry {
    matrix: MatrixRoom|undefined;
    remote: RemoteRoom|undefined;
}
