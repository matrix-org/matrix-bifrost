import { AppServiceBot, Intent, Logger, RemoteRoom } from "matrix-appservice-bridge";
import { IBifrostInstance } from "./bifrost/Instance";
import { IAccountEvent, IChatJoinProperties } from "./bifrost/Events";
import { IStore } from "./store/Store";
import { MROOM_TYPE_GROUP } from "./store/Types";
import { Util } from "./Util";
import { Deduplicator } from "./Deduplicator";
import { ProtoHacks } from "./ProtoHacks";
import { GatewayHandler } from "./GatewayHandler";

interface IRoomMembership {
    room_name: string;
    params: IChatJoinProperties;
    membership: "join"|"leave";
}

const SYNC_RETRY_MS = 100;
const MAX_SYNCS = 8;
const JOINLEAVE_TIMEOUT = 60000;
const log = new Logger("RoomSync");

export class RoomSync {
    private accountRoomMemberships: Map<string, IRoomMembership[]>;
    private ongoingSyncs = 0;
    constructor(
        private bifrost: IBifrostInstance,
        private store: IStore,
        private deduplicator: Deduplicator,
        private gateway: GatewayHandler,
        private intent: Intent,
    ) {
        this.accountRoomMemberships = new Map();
        this.bifrost.on("account-signed-on", this.onAccountSignedin.bind(this));
    }

    public getMembershipForUser(user: string): IRoomMembership[]|undefined {
        return this.accountRoomMemberships.get(user);
    }

    public async sync(bot: AppServiceBot) {
        log.info("Beginning sync");
        try {
            await this.syncAccountsToGroupRooms(bot);
        } catch (err) {
            log.error("Caugh error while trying to sync group rooms", err);
            throw Error("Encountered error while syncing. Cannot continue");
        }
        log.info("Finished sync");
    }

    private async getJoinedMembers(bot: AppServiceBot, roomId: string) {
        while (this.ongoingSyncs >= MAX_SYNCS) {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        this.ongoingSyncs++;
        log.debug(`Syncing members for ${roomId} (${this.ongoingSyncs}/${MAX_SYNCS})`);
        while (true) {
            try {
                const result = await bot.getJoinedMembers(roomId);
                this.ongoingSyncs--;
                return result;
            } catch (ex) {
                if (ex.errcode === "M_FORBIDDEN") {
                    throw Error("Got M_FORBIDDEN while trying to sync members for room.");
                }
                log.warn(`Failed to get joined members for ${roomId}, retrying in ${SYNC_RETRY_MS}`, ex);
                await new Promise((resolve) => setTimeout(resolve, SYNC_RETRY_MS));
            }
        }
    }

    /**
     * This function will collect all the members of the group rooms and decide
     * if the backend side needs to "reconnect" to the rooms.
     *
     * @return [description]
     */
    private async syncAccountsToGroupRooms(bot: AppServiceBot): Promise<void> {
        const rooms = await this.store.getRoomsOfType(MROOM_TYPE_GROUP);
        log.info(`Got ${rooms.length} group rooms`);
        await Promise.all(rooms.map(async (room) => {
            if (!room.matrix) {
                log.warn(`Not syncing entry because it has no matrix component`);
                return;
            }
            const roomId = room.matrix.getId();
            if (!room.remote) {
                log.warn(`Not syncing ${roomId} because it has no remote links`);
                return;
            }
            const protocolId = room.remote.get<string>("protocol_id");
            if (!this.bifrost.getProtocol(protocolId)) {
                log.debug(`Not syncing ${roomId} because the purple backend doesn't support this protocol`);
                return;
            }
            const isGateway = room.remote.get<boolean>("gateway");
            if (isGateway) {
                // The gateway handler syncs via roomState.
                this.gateway.initialMembershipSync(room);
                return;
            }
            let members: {[userId: string]: {display_name?: string}};
            try {
                members = await this.getJoinedMembers(bot, roomId);
            } catch (ex) {
                log.warn(`Not syncing ${roomId} because we could not get room members: ${ex}`);
                return;
            }
            const userIds = Object.keys(members);
            for (const userId of userIds) {
                // Never sync the bot user.
                if (bot.getUserId() === userId) {
                    continue;
                }
                if (!bot.isRemoteUser(userId)) {
                    await this.syncMatrixUser(userId, roomId, room.remote, members[userId].display_name);
                }
            }
        }));
    }

    private async syncMatrixUser(userId: string, roomId: string, remoteRoom: RemoteRoom,
        displayName: string) {
        log.debug(`Syncing matrix ${userId} -> ${roomId}`);

        // First get an account for this matrix user.
        const protocolId = remoteRoom.get<string>("protocol_id");
        const remotes = await this.store.getAccountsForMatrixUser(userId, protocolId);
        if (remotes.length === 0) {
            log.warn(`${userId} has no remote accounts matching the rooms protocol`);
            return;
        }
        const remoteUser = remotes[0];
        log.info(`${remoteUser.id} will join ${remoteRoom.get("room_name")} on connection`);

        // Get properties needed to join the room
        const props = Util.desanitizeProperties(Object.assign({}, remoteRoom.get("properties")));
        // Set some extra information about the user that is dynamic, e.g. handle.
        await ProtoHacks.addJoinProps(
            protocolId, props, userId, displayName || this.intent,
        );
        const acctMemberList = this.accountRoomMemberships.get(remoteUser.id) || [];
        acctMemberList.push({
            room_name: remoteRoom.get("room_name"),
            params: props,
            membership: "join",
        });
        this.accountRoomMemberships.set(remoteUser.id, acctMemberList);
    }

    private async onAccountSignedin(ev: IAccountEvent) {
        log.info(`${ev.account.username} signed in, checking if we need to reconnect them to some rooms`);
        const matrixUser = await this.store.getMatrixUserForAccount(ev.account);
        const acct = this.bifrost.getAccount(
            ev.account.username,
            ev.account.protocol_id,
            matrixUser ? matrixUser.getId() : undefined,
        );
        if (matrixUser === null) {
            log.warn(`${ev.account.username} isn't bound to a matrix account. Disabling`);
            try {
                if (acct !== null) {
                    acct.setEnabled(false);
                    return;
                }
            } catch (ex) {
                // This can fail.
            }

            log.error(`Tried to get ${ev.account.username} but the backend found nothing. This shouldn't happen!`);
            return;
        }
        const remoteId = Util.createRemoteId(ev.account.protocol_id, ev.account.username);
        const reconnectStack = this.accountRoomMemberships.get(remoteId) || [];
        const reconsToMake = reconnectStack.length;
        log.debug(`Found ${reconsToMake} reconnections to be made for ${remoteId} (${matrixUser.getId()})`);
        let membership: IRoomMembership|undefined;
        membership = reconnectStack.pop();
        let i = 0;
        while (membership) {
            i++;
            try {
                if (membership.membership === "join") {
                    log.info(`${i}/${reconsToMake} JOIN ${remoteId} -> ${membership.room_name}`);
                    await acct.joinChat(membership.params, this.bifrost, JOINLEAVE_TIMEOUT, false);
                    acct.setJoinPropertiesForRoom && acct.setJoinPropertiesForRoom(membership.room_name, membership.params);
                } else {
                    log.info(`${i}/${reconsToMake} LEAVE ${remoteId} -> ${membership.room_name}`);
                    await acct!.rejectChat(membership.params);
                    this.deduplicator.decrementRoomUsers(membership.room_name);
                }
            } catch (ex) {
                log.warn(`Failed to ${membership.membership} ${remoteId} to ${membership.room_name}:`, ex);
                // XXX: Retry behaviour?
            }
            membership = reconnectStack.pop();
        }
        this.accountRoomMemberships.delete(remoteId);
    }
}
