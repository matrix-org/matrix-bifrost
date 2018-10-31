export const MROOM_TYPE_UADMIN = "user-admin";
export const MROOM_TYPE_IM = "im";

export interface IMatrixRoomData {
    type: string; // One of [MROOM_TYPE_UADMIN, MROOM_TYPE_IM]
}

export interface IMatrixUserData {
    accounts: {[key: string]: IMatrixUserAccount}
}

export interface IMatrixUserAccount {
    username: string;
    protocolId: string;
}