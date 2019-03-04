import { IBasicProtocolMessage } from "../MessageFormatter";
import { IGatewayRoom } from "../GatewayHandler";
import { BifrostRemoteUser } from "../Store";
import { IProfileProvider } from "./IPurpleAccount";

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
    onRemoteJoin(err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined
    ): Promise<void>;
    reconnectRemoteUser(user: BifrostRemoteUser, room: IGatewayRoom): void;
}
