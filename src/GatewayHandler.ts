import { IGatewayJoin, IGatewayRoomQuery, IGatewayPublicRoomsQuery, IChatJoinProperties } from "./bifrost/Events";
import { IBifrostInstance } from "./bifrost/Instance";
import { Bridge, Logging, Intent, RoomBridgeStoreEntry, WeakEvent } from "matrix-appservice-bridge";
import { Config } from "./Config";
import { IStore } from "./store/Store";
import { MROOM_TYPE_GROUP, IRemoteGroupData } from "./store/Types";
import { IBasicProtocolMessage } from "./MessageFormatter";
import { ProfileSync } from "./ProfileSync";
import { IGatewayRoom } from "./bifrost/Gateway";
import { MatrixMembershipEvent } from "./MatrixTypes";
import { BifrostRemoteUser } from "./store/BifrostRemoteUser";

const log = Logging.get("GatewayHandler");

const HISTORY_SAFE_ENUMS = ['shared', 'world_readable'];

/**
 * Responsible for handling querys & events on behalf of a gateway style bridge.
 * The gateway system in the bridge is complex, so pull up a a pew and let's dig in.
 *
 * Backends may query whether a room exists by emitting "gateway-queryroom", which
 * has a callback that this handler must fulfil. The backend is expected to translate
 * whatever string they are handling into an alias (or room id).
 *
 * The backend may also get a join request, which should be sent to "gateway-joinroom".
 * This should NOT be handled by "chat-user-joined". The handler will verify that the
 * remote user can join the room (is public/invited), and will call onRemoteJoin
 * with IGatewayRoom (containing bridge state).
 *
 * Messages from Matrix will avoid IAccount entirely and use sendMatrixMessage
 * (which in turn calls IGateway).
 *
 * Messages from a remote should be handled inside MatrixRoomHandler as-is, although
 * be careful to handle things like echoes in your backend (for example, this is required
 * for XMPP.js).
 */
export class GatewayHandler {
    private aliasCache: Map<string, IGatewayRoom> = new Map();
    private roomIdCache: Map<string, Promise<IGatewayRoom>> = new Map();

    constructor(
        private purple: IBifrostInstance,
        private bridge: Bridge,
        private config: Config,
        private store: IStore,
        private profileSync: ProfileSync,
    ) {
        if (!config.portals.enableGateway) {
            return;
        }
        purple.on("gateway-queryroom", this.handleRoomQuery.bind(this));
        purple.on("gateway-joinroom", this.handleRoomJoin.bind(this));
        purple.on("gateway-publicrooms", this.handlePublicRooms.bind(this));
    }

    public async getVirtualRoom(roomId: string, intent: Intent): Promise<IGatewayRoom> {
        const existingRoom = this.roomIdCache.get(roomId);
        if (existingRoom) {
            return existingRoom;
        }
        const promise = (async () => {
            log.debug(`Getting state for ${roomId}`);
            const state = await intent.roomState(roomId);
            log.debug(`Got state for ${roomId}`);
            const nameEv = state.find((e) => e.type === "m.room.name");
            const topicEv = state.find((e) => e.type === "m.room.topic");
            const historyVis = state.find((e) => e.type === "m.room.history_visibility");
            const bot = this.bridge.getBot();
            const membership = state.filter((e) => e.type === "m.room.member").map((e: WeakEvent) => (
                {
                    isRemote: bot.isRemoteUser(e.sender),
                    stateKey: e.state_key,
                    displayname: e.content.displayname,
                    sender: e.sender,
                    membership: e.content.membership,
                }
            ))
            const room: IGatewayRoom = {
                // Default to private
                allowHistory: HISTORY_SAFE_ENUMS.includes(historyVis?.content?.history_visibility || 'joined'),
                name: nameEv ? nameEv.content.name : "",
                topic: topicEv ? topicEv.content.topic : "",
                roomId,
                membership,
            };
            log.debug(`Hydrated room ${roomId} '${room.name}' '${room.topic}' ${room.membership.length} `);
            return room;
        })();
        this.roomIdCache.set(roomId, promise);
        return promise;
    }

    public async sendMatrixMessage(
        chatName: string, sender: string, body: IBasicProtocolMessage, context: RoomBridgeStoreEntry) {
        if (!this.purple.gateway) {
            return;
        }
        if (!context.matrix) {
            return;
        }
        const room = await this.getVirtualRoom(context.matrix.getId(), this.bridge.getIntent());
        this.purple.gateway.sendMatrixMessage(chatName, sender, body, room);
    }

    public async sendStateEvent(chatName: string, sender: string, ev: any , context: RoomBridgeStoreEntry) {
        if (!this.purple.gateway) {
            return;
        }
        if (!context.matrix) {
            return;
        }
        const room = await this.getVirtualRoom(context.matrix.getId(), this.bridge.getIntent());
        if (ev.type === "m.room.name") {
            log.info("Handing room name change for gateway");
            room.name = ev.content.name;
            this.purple.gateway.sendStateChange(chatName, sender, "name", room);
        } else if (ev.type === "m.room.topic") {
            log.info("Handing room topic change for gateway");
            room.topic = ev.content.topic;
            this.purple.gateway.sendStateChange(chatName, sender, "topic", room);
        } else if (ev.type === "m.room.avatar") {
            log.info("Handing room avatar change for gateway");
            log.debug("Room avatar changes aren't supported yet.");
        //    this.purple.gateway.sendStateChange(chatName, sender, "topic", ev.content.topic);
        }
    }

    public async sendMatrixMembership(
        chatName: string, context: RoomBridgeStoreEntry, event: MatrixMembershipEvent,
    ) {
        if (!this.purple.gateway) {
            return;
        }
        if (!context.matrix) {
            return;
        }
        const room = await this.getVirtualRoom(context.matrix.getId(), this.bridge.getIntent());
        if (this.bridge.getBot().isRemoteUser(event.state_key)) {
            // This might be a kick or ban.
            log.info(`Forwarding remote membership for ${event.state_key} in ${chatName}`);
            this.purple.gateway.sendMatrixMembership(chatName, event, room);
            return;
        }
        const existingMembership = room.membership.find((ev) => ev.stateKey === event.state_key);
        if (existingMembership) {
            if (existingMembership.membership === event.content.membership) {
                // No-op
                return;
            }
            existingMembership.membership = event.content.membership;
            existingMembership.displayname = event.content.displayname;
        } else {
            room.membership.push({
                membership: event.content.membership,
                sender: event.sender,
                displayname: event.content.displayname,
                stateKey: event.state_key,
                isRemote: false,
            });
        }
        log.info(`Updating membership for ${event.state_key} in ${chatName} ${room.roomId}`);
        this.purple.gateway.sendMatrixMembership(chatName, event, room);
    }

    public async initialMembershipSync(roomEntry: RoomBridgeStoreEntry) {
        if (!this.purple.gateway) {
            log.debug("Not rejoining remote user, gateway not enabled");
            return;
        }
        const roomName = roomEntry.remote.get<string>("room_name");
        const room = await this.getVirtualRoom(roomEntry.matrix.getId(), this.bridge.getIntent());
        const remoteGhosts: BifrostRemoteUser[] = [];
        for (const ghost of room.membership.filter((m) => m.isRemote && m.membership === "join")) {
            const user = (await this.store.getRemoteUsersFromMxId(ghost.stateKey))[0];
            if (user && user.extraData) {
                remoteGhosts.push(user);
            }
        }
        this.purple.gateway.initialMembershipSync(roomName, room, remoteGhosts);
    }

    private async handleRoomJoin(data: IGatewayJoin) {
        // Attempt to join the user, and create the room mapping if successful.
        if (!this.purple.gateway) {
            throw Error("Cannot handle gateway join because gateway is not setup");
        }
        const protocol = this.purple.getProtocol(data.protocol_id)!;
        const intentUser = this.purple.gateway.getMxidForRemote(data.sender);
        log.info(`${intentUser} is attempting to join ${data.roomAlias}`);
        const intent = this.bridge.getIntent(intentUser);
        let roomId: string|null = null;
        let room: RoomBridgeStoreEntry|undefined;
        try {
            if (this.config.getRoomRule(data.roomAlias) === "deny") {
                throw Error("This room has been denied");
            }
            await intent.ensureRegistered();
            if (this.config.tuning.waitOnProfileBeforeSend) {
                await this.profileSync.updateProfile(protocol, data.sender, this.purple.gateway);
            }
            log.info(`Attempting to join ${data.roomAlias}`)
            roomId = await intent.join(data.roomAlias);
            if (this.config.getRoomRule(roomId) === "deny") {
                throw Error("This room has been denied");
            }
            if (!this.config.tuning.waitOnProfileBeforeSend) {
                await this.profileSync.updateProfile(protocol, data.sender, this.purple.gateway);
            }
            if (data.nick) {
                // Set the user's displayname in the room to their nickname.
                // Do this after a short delay, so that we don't have a race on
                // the server setting the global displayname.
                setTimeout(
                    async () => {
                        await intent.setRoomUserProfile(roomId, {displayname: data.nick});
                    },
                    1000,
                );
            }
            room = await this.getOrCreateGatewayRoom(data, roomId);
            const canonAlias = room.remote?.get<IChatJoinProperties>("properties").room_alias;
            if (canonAlias !== data.roomAlias) {
                throw Error(
                    "We do not support multiple room aliases, try " + canonAlias,
                );
            }
            const vroom = await this.getVirtualRoom(roomId, intent);
            await this.purple.gateway.onRemoteJoin(null, data.join_id, vroom, intentUser);
        } catch (ex) {
            const roomName = room?.remote?.get<string>("room_name");
            // If the user is already in the room (e.g. XMPP member with a second device), don't part them.
            const alreadyInRoom = roomName && this.purple.gateway.memberInRoom(roomName, intentUser);
            if (roomId && !alreadyInRoom) {
                intent.leave(roomId);
            }
            log.warn("Failed to join room:", ex.message);
            await this.purple.gateway.onRemoteJoin(ex.message, data.join_id, undefined, undefined);
        }
    }

    private async handleRoomQuery(ev: IGatewayRoomQuery) {
        log.info(`Trying to discover ${ev.roomAlias}`);
        try {
            const res = await this.bridge.getIntent().getClient().resolveRoomAlias(ev.roomAlias);
            log.info(`Found ${res.room_id}`);
            ev.result(null, res.room_id);
        } catch (ex) {
            log.warn("Room not found:", ex);
            ev.result(Error("Room not found"));
        }
    }

    private async handlePublicRooms(ev: IGatewayPublicRoomsQuery) {
        log.info(`Trying to discover public rooms search=${ev.searchString} homeserver=${ev.homeserver}`);
        try {
            // XXX: We should check to see if the room exists in our cache.
            // We have to join the room, as doing a lookup would not prompt a bridge like freenode
            // to intervene.
            let res = await this.bridge.getIntent().getClient().publicRooms({
                server: ev.homeserver || undefined,
                filter: {
                    generic_search_term: ev.searchString,
                },
            });
            if (res === null) {
                // Synapse apparently does this.
                res = {chunk: []};
            }
            ev.result(null, res);
        } catch (ex) {
            log.warn("Room not found:", ex);
            ev.result(Error("Room not found"));
        }
    }

    private async getOrCreateGatewayRoom(data: IGatewayJoin, roomId: string): Promise<RoomBridgeStoreEntry> {
        const remoteId = Buffer.from(
            `${data.protocol_id}:${data.room_name}`,
        ).toString("base64");
        // Check if we have bridged this already.
        const exists = (await this.store.getRoomEntryByMatrixId(roomId));
        if (exists && !exists.remote?.get<boolean>("gateway")) {
            const roomName = exists.remote?.get<string>("room_name");
            throw Error(`This room is already bridged to ${roomName}`);
        }

        const existingRoom = await this.store.getRoomByRemoteData({
            protocol_id: data.protocol_id,
            room_name: data.room_name,
        });

        if (existingRoom) {
            return existingRoom;
        }

        const newRoom = this.store.storeRoom(roomId, MROOM_TYPE_GROUP, remoteId, {
            protocol_id: data.protocol_id,
            type: MROOM_TYPE_GROUP,
            room_name: data.room_name,
            gateway: true,
            properties: {
                room_id: roomId,
                room_alias: data.roomAlias,
            },
        } as IRemoteGroupData);
        return newRoom;
    }
}
