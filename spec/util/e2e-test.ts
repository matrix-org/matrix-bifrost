import { MatrixClient } from "matrix-bot-sdk";

const WAIT_EVENT_TIMEOUT = parseInt(process.env.BIFROST_TEST_WAIT_TIMEOUT ?? "20000", 10);

interface RoomEvent {
    sender: string;
    type: string;
    state_key?: string;
    content: unknown;
}

/**
 * A MatrixClient with promise-based helpers for waiting on specific events,
 * for use in e2e tests that drive a real homeserver.
 */
export class E2ETestMatrixClient extends MatrixClient {

    public async waitForRoomEvent(
        opts: {eventType: string, sender: string, roomId?: string, stateKey?: string}
    ): Promise<{roomId: string, data: RoomEvent}> {
        const {eventType, sender, roomId, stateKey} = opts;
        return this.waitForEvent('room.event', (eventRoomId: string, eventData: RoomEvent) => {
            if (eventData.sender !== sender) {
                return undefined;
            }
            if (eventData.type !== eventType) {
                return undefined;
            }
            if (roomId && eventRoomId !== roomId) {
                return undefined;
            }
            if (stateKey !== undefined && eventData.state_key !== stateKey) {
                return undefined;
            }
            return {roomId: eventRoomId, data: eventData};
        }, `Timed out waiting for ${eventType} from ${sender} in ${roomId || "any room"}`);
    }

    public async waitForRoomInvite(
        opts: {sender: string, roomId?: string}
    ): Promise<{ roomId: string, data: { sender: string } }> {
        const {sender, roomId} = opts;
        return this.waitForEvent('room.invite', (eventRoomId: string, eventData: {sender: string}) => {
            console.log("Room invite", eventRoomId, eventData);
            if (eventData.sender !== sender) {
                return undefined;
            }
            if (roomId && eventRoomId !== roomId) {
                return undefined;
            }
            return {roomId: eventRoomId, data: eventData};
        }, `Timed out waiting for invite to ${roomId || "any room"} from ${sender}`);
    }

    public async waitForRoomJoin(
        opts: {roomId?: string}
    ): Promise<{roomId: string}> {
        const {roomId} = opts;
        return this.waitForEvent('room.join', (eventRoomId: string) => {
            if (roomId && eventRoomId !== roomId) {
                return undefined;
            }
            return {roomId: eventRoomId};
        }, `Timed out waiting for room join to ${roomId || "any room"}`);
    }

    public async waitForEvent<T>(
        emitterType: string, filterFn: (...args: never[]) => T|undefined, timeoutMsg: string,
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout>;
            const fn = (...args: never[]) => {
                const data = filterFn(...args);
                if (data) {
                    clearTimeout(timer);
                    this.removeListener(emitterType, fn);
                    resolve(data);
                }
            };
            timer = setTimeout(() => {
                this.removeListener(emitterType, fn);
                reject(new Error(timeoutMsg));
            }, WAIT_EVENT_TIMEOUT);
            this.on(emitterType, fn);
        });
    }
}
