import { IBasicProtocolMessage } from "../MessageFormatter";
import { IGatewayRoom } from "../GatewayHandler";
import { IBridgeContext } from "../MatrixTypes";

export interface IGateway {
    sendMatrixMessage(
        chatName: string,
        sender: string, body: IBasicProtocolMessage, room: IGatewayRoom,
        roomname: string,
    );
    sendMatrixMembership(
        chatName: string, sender: string, displayname: string, membership: string, room: IGatewayRoom,
        roomname: string,
    );
    onRemoteJoin(err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined);
}
