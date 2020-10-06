import { MatrixUser, RemoteUser, MatrixRoom, RemoteRoom, WeakEvent, UserMembership } from "matrix-appservice-bridge";

 /**
  * This is actually just a matrix event, as far as we care.
  */
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


export interface MatrixMembershipEvent extends WeakEvent {
    content: {
        membership: "join"|"invite"|"leave"|"ban";
        displayname?: string;
        avatar_url?: string;
        reason?: string;
    }
    state_key: string;
}

export interface MatrixMessageEvent extends WeakEvent {
    content: {
        body: string;
        formatted_body?: string;
        format?: string;
        msgtype: string;
        info?: {
            mimetype?: string;
            size?: number
        };
        url?: string;
    };
}
