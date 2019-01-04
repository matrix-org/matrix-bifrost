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
