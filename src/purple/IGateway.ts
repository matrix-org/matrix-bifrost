import { IBasicProtocolMessage } from "../MessageFormatter";
import { IGatewayRoom } from "../GatewayHandler";
import { IBridgeContext } from "../MatrixTypes";
import { BifrostRemoteUser } from "../Store";

export interface IGateway {
    sendMatrixMessage(
        chatName: string,
        sender: string, body: IBasicProtocolMessage, room: IGatewayRoom,
        roomname: string,
    ): void;
    sendMatrixMembership(
        chatName: string, sender: string, displayname: string, membership: string, room: IGatewayRoom,
    ): void;
    sendStateChange(
        chatName: string, sender: string, type: "topic"|"name"|"avatar", room: IGatewayRoom,
    ): void;
    onRemoteJoin(err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined
    ): Promise<void>;
    reconnectRemoteUser(user: BifrostRemoteUser, room: IGatewayRoom): void;
}
