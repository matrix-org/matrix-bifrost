import { MatrixRoom, RemoteRoom, MatrixUser, Bridge } from "matrix-appservice-bridge";
import { IRemoteRoomData, IRemoteGroupData, IRoomEntry, MROOM_TYPES, MUSER_TYPES } from "./Types";
import { BifrostProtocol } from "../bifrost/Protocol";
import { IAccountMinimal } from "../bifrost/Events";
import { BifrostRemoteUser } from "./BifrostRemoteUser";
import { IConfigDatastore } from "../Config";
import { NeDBStore } from "./NeDBStore";

export async function initiateStore(config: IConfigDatastore, bridge: Bridge): Promise<IStore> {
    if (config.engine === "nedb") {
        return new NeDBStore(bridge);
    }
    throw Error("Database engine not supported");
}

export interface IStore {

    getMatrixUser(id: string): Promise<MatrixUser|null>;

    getMatrixUserForAccount(account: IAccountMinimal): Promise<MatrixUser|null>;

    setMatrixUser(matrix: MatrixUser): Promise<void>;

    getRemoteUserBySender(sender: string, protocol: BifrostProtocol): Promise<BifrostRemoteUser|null>;

    getRemoteUsersFromMxId(userId: string): Promise<BifrostRemoteUser[]>;

    getRoomByRemoteData(remoteData: IRemoteRoomData|IRemoteGroupData);

    getRoomByRoomId(roomId: string);

    getUsernameMxidForProtocol(protocol: BifrostProtocol): Promise<{[mxid: string]: string}>;

    getRoomsOfType(type: MROOM_TYPES): Promise<IRoomEntry[]>;

    storeUser(userId: string, protocol: BifrostProtocol, username: string, type: MUSER_TYPES, extraData?: any)
        : Promise<{remote: BifrostRemoteUser, matrix: MatrixUser}>;

    removeRoomByRoomId(matrixId: string);

    getEntryByMatrixId(roomId: string): Promise<{matrix: MatrixRoom, remote: RemoteRoom}|null>;

    storeRoom(matrixId: string, type: MROOM_TYPES, remoteId: string, remoteData: IRemoteRoomData)
    : Promise<{remote: RemoteRoom, matrix: MatrixRoom}>;

    integrityCheck(canWrite: boolean): Promise<void>;
}
