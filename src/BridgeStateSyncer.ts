
import { Bridge, Logging } from "matrix-appservice-bridge";
import { IStore } from "./store/Store";
import { BifrostProtocol } from "./bifrost/Protocol";
import { IRoomEntry } from "./store/Types";
import PQueue from "p-queue";
import { IBifrostInstance } from "./bifrost/Instance";
const log = Logging.get("BridgeStateSyncer");


const SYNC_CONCURRENCY = 3;

/**
 * This class will set bridge room state according to [MSC2346](https://github.com/matrix-org/matrix-doc/pull/2346)
 */
export class BridgeStateSyncer {
    public static readonly EventType = "uk.half-shot.bridge";

    public static createStateKey(protocol: BifrostProtocol, channel: string, network?: string) {
        network = network ? network.replace(/\//g, "%2F") : "";
        channel = channel.replace(/\//g, "%2F");
        if (network) {
            network + "/";
        }
        return `org.matrix.bifrost://${protocol.id}/${network}${channel}`;
    }

    private syncQueue: PQueue;

    constructor(private datastore: IStore, private bridge: Bridge, private bifrost: IBifrostInstance) {
        this.syncQueue = new PQueue({concurrency: SYNC_CONCURRENCY});
    }

    public async beginSync() {
        log.info("Beginning sync of bridge state events");
        const allMappings = await this.datastore.getRoomsOfType("group");
        allMappings.forEach((room) => {
            this.syncQueue.add(async () => this.syncRoom(room));
        });
    }

    public createInitialState(protocol: BifrostProtocol, channel: string, network?: string) {
        return {
            type: BridgeStateSyncer.EventType,
            content: this.createBridgeInfoContent(protocol, channel, network),
            state_key: BridgeStateSyncer.createStateKey(protocol, channel, network),
        };
    }

    public createBridgeInfoContent(protocol: BifrostProtocol, channel: string, network?: string) {
        return {
            creator: "",
            protocol: {
                id: protocol.id,
                displayname: protocol.displayname,
                avatar: protocol.getProtocolIconMXC() || undefined,
            },
            channel: {
                id: channel,
            },
            ...(network ? {network: { id: network }} : undefined),
        }
    }

    private async syncRoom(room: IRoomEntry) {
        const roomId = room.matrix.getId();
        log.info(`Syncing ${roomId}`);
        const intent = this.bridge.getIntent();
        const roomProtocol = this.bifrost.getProtocol(room.remote.get("protocol_id"));
        if (!roomProtocol) {
            log.warn(`Cannot handle ${roomId}, no protocol found`);
            return;
        }

        const channelNetwork = roomProtocol.getNetworkChannelForRoomName(room.remote.get("room_name"));
        const key = BridgeStateSyncer.createStateKey(roomProtocol, channelNetwork.channel, channelNetwork.network);
        try {
            const eventData = await this.getStateEvent(roomId, BridgeStateSyncer.EventType, key);
            if (eventData !== null) { // If found, validate.
                const expectedContent = this.createBridgeInfoContent(
                    roomProtocol, channelNetwork.channel, channelNetwork.network,
                );

                const isValid = expectedContent.channel.id === eventData.channel.id &&
                    expectedContent.protocol.id === eventData.protocol.id;

                if (isValid) {
                    log.debug(`${key} is valid`);
                    return;
                }
                log.info(`${key} is invalid`);
            }
        } catch (ex) {
            log.warn(`Encountered error when trying to sync ${roomId}:`, ex);
            return; // To be on the safe side, do not retry this room.
        }

        // Event wasn't found or was invalid, let's try setting one.
        const eventContent = this.createBridgeInfoContent(
            roomProtocol, channelNetwork.channel, channelNetwork.network,
        );
        eventContent.creator = intent.client.credentials.userId;
        try {
            await intent.sendStateEvent(roomId, BridgeStateSyncer.EventType, key, eventContent);
        } catch (ex) {
            log.error(`Failed to update room with new state content: ${ex.message}:`, ex);
        }
    }

    private async getStateEvent(roomId: string, eventType: string, key: string) {
        const intent = this.bridge.getIntent();
        try {
            return await intent.getStateEvent(roomId, eventType, key);
        } catch (ex) {
            if (ex.errcode !== "M_NOT_FOUND") {
                throw ex;
            }
        }
        return null;
    }
}
