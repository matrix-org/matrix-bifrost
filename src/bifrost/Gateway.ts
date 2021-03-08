import { MatrixMembershipEvent } from "../MatrixTypes";
import { IBasicProtocolMessage } from "../MessageFormatter";
import { BifrostRemoteUser } from "../store/BifrostRemoteUser";
import { IProfileProvider } from "./Account";

export interface IGateway extends IProfileProvider {
    sendMatrixMessage(
        chatName: string,
        sender: string, body: IBasicProtocolMessage, room: IGatewayRoom,
    ): void;
    sendMatrixMembership(
        chatName: string, event: MatrixMembershipEvent, room: IGatewayRoom,
    ): void;
    sendStateChange(
        chatName: string, sender: string, type: "topic"|"name"|"avatar", room: IGatewayRoom,
    ): void;
    onRemoteJoin(err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined,
    ): Promise<void>;
    initialMembershipSync(chatName: string, room: IGatewayRoom, remoteGhosts: BifrostRemoteUser[]): void;
    getMxidForRemote(sender: string): string;
    memberInRoom(chatName: string, matrixId: string): boolean;
}

export interface IGatewayRoom {
    name: string;
    topic: string;
    avatar?: string;
    roomId: string;
    allowHistory: boolean;
    membership: {
        sender: string;
        stateKey: string;
        displayname?: string;
        membership: string;
        isRemote: boolean;
    }[];
    // remotes: string[];
}
