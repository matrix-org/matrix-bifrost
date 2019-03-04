/**
 * This should really live in matrix-appservice-bridge but that would be a lot of faff
 * and timing is of the essence.
 * - Half-Shot
 */
import { MatrixUser, RemoteUser, MatrixRoom, RemoteRoom } from "matrix-appservice-bridge";

export interface IEventRequest {
    getData(): IEventRequestData;
    getDuration(): number;
    getId(): string;
    getPromise(): Promise<void>;
    outcomeFrom(p: Promise<any>);
}

 /**
  * This is actually just a matrix event, as far as we care.
  */
export interface IEventRequestData {
    event_id: string;
    origin_server_ts: number;
    sender: string;
    type: string;
    // tslint:disable-next-line:no-any
    content: any;
    // tslint:disable-next-line:no-any
    unsigned?: any;
    room_id: string;
    state_key?: string;
}

export interface IBridgeContext {
    senders: {
        matrix: MatrixUser|null,
        remote: RemoteUser|null,
        remotes: RemoteUser[],
    };
    targets: {
        matrix: MatrixUser|null,
        remote: RemoteUser|null,
        remotes: RemoteUser[],
    };
    rooms: {
        matrix: MatrixRoom|null,
        remote: RemoteRoom|null,
        remotes: RemoteRoom[],
    };
}

export interface IPublicRoomsResponse {
    total_room_count_estimate: number;
    chunk: IPublicRoom[];
}

export interface IPublicRoom {
    aliases: string[]; // Aliases of the room. May be empty.
    canonical_alias: string|undefined; // The canonical alias of the room, if any.
    name: string|undefined; 	// The name of the room, if any.
    num_joined_members: number; // The number of members joined to the room.
    room_id: string; //  The ID of the room.
    topic: string|undefined; // The topic of the room, if any.
    world_readable: boolean; // Whether the room may be viewed by guest users without joining.
    guest_can_join: boolean; // Whether guest users may join the room and participate in it.
                             // If they can, they will be subject to ordinary power level rules like any other user.
    avatar_url: string|undefined; // The URL for the room's avatar, if one is set.
}
