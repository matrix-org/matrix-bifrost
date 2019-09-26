import { IBasicProtocolMessage } from "../MessageFormatter";
import { BifrostRemoteUser } from "../store/BifrostRemoteUser";
import { IProfileProvider } from "./Account";

export interface IGateway extends IProfileProvider {
    sendMatrixMessage(
        chatName: string,
        sender: string, body: IBasicProtocolMessage, room: IGatewayRoom,
    ): void;
    sendMatrixMembership(
        chatName: string, sender: string, displayname: string, membership: string, room: IGatewayRoom,
    ): void;
    sendStateChange(
        chatName: string, sender: string, type: "topic"|"name"|"avatar", room: IGatewayRoom,
    ): void;
    onRemoteJoin(err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined,
    ): Promise<void>;
    reconnectRemoteUser(user: BifrostRemoteUser, room: IGatewayRoom): void;
}

export interface IGatewayRoom {
    name: string;
    topic: string;
    avatar?: string;
    roomId: string;
    membership: any[];
    // remotes: string[];
}
