import { Bridge, Logging, MatrixRoom } from "matrix-appservice-bridge";
import { IPurpleInstance } from "./purple/IPurpleInstance";
import { IAccountEvent, IChatJoinProperties } from "./purple/PurpleEvents";
import { Store } from "./Store";
import { MROOM_TYPE_GROUP, IRoomEntry } from "./StoreTypes";
import { Util } from "./Util";
import { Deduplicator } from "./Deduplicator";
import { ProtoHacks } from "./ProtoHacks";
const log = Logging.get("RoomSync");

interface IRoomMembership {
    room_name: string;
    params: IChatJoinProperties;
    membership: "join"|"leave";
}

export class RoomSync {
    private accountRoomMemberships: Map<string, IRoomMembership[]>;
    constructor(
        private purple: IPurpleInstance,
        private bridge: Bridge,
        private store: Store,
        private deduplicator: Deduplicator,
    ) {
        this.accountRoomMemberships = new Map();
        this.purple.on("account-signed-on", this.onAccountSignedin.bind(this));
    }

    public async sync(initial: boolean = true) {
        // XXX: There is no retry handling for this.
        log.info("Beginning sync");
        try {
            await this.syncAccountsToGroupRooms();
        } catch (err) {
            log.error("Caugh error while trying to sync group rooms", err);
            throw Error("Encountered error while syncing. Cannot continue");
        }
        log.info("Finished sync");

    }

    /**
     * This function will collect all the members of the group rooms and decide
     * if the libpurple side needs to "reconnect" to the rooms.
     * @return [description]
     */
    private async syncAccountsToGroupRooms() {
        const bot = this.bridge.getBot();
        const rooms = await this.store.getRoomsOfType(MROOM_TYPE_GROUP);
        log.info(`Got ${rooms.length} group rooms`);

        await Promise.all(rooms.map(async (room: IRoomEntry) => {
            const roomId = room.matrix.getId();
            if (!room.remote) {
                log.warn(`Not syncing ${roomId} because it has no remote links`);
                log.debug(roomId, "->", room);
                return;
            }
            log.debug(`Syncing members for ${roomId}`);

            const members = await bot.getJoinedMembers(roomId);
            log.debug(`${roomId} has ${Object.keys(members).length} members`);
            const userIds = Object.keys(members);
            for (const userId of userIds) {
                log.debug(`Checking ${userId}`);
                if (bot.isRemoteUser(userId)) {
                    continue;
                }
                log.debug("Checking the store for the user's account");
                const remotes = (await this.store.getRemoteUsersFromMxId(userId)).filter(
                    (ruser) => ruser &&
                        ruser.get("protocolId") === room.remote.get("protocol_id"),
                );
                if (remotes.length === 0) {
                    log.debug(`${userId} has no remote accounts matching the rooms protocol`);
                    continue;
                }
                const remoteUser = remotes[0];
                const acctMemberList = this.accountRoomMemberships.get(remoteUser.getId()) || [];
                log.info(`${remoteUser.getId()} will join ${room.remote.get("room_name")} on connection`);
                const props = ProtoHacks.desanitizeProperties(Object.assign({}, room.remote.get("properties")));
                await ProtoHacks.addJoinProps(room.remote.get("protocol_id"), props, userId, this.bridge.getIntent());
                acctMemberList.push({
                    room_name: room.remote.get("room_name"),
                    params: props,
                    membership: "join",
                });
                this.accountRoomMemberships.set(remoteUser.getId(), acctMemberList);
            }
        }));
    }

    private async onAccountSignedin(ev: IAccountEvent) {
        log.debug(`${ev.account.username} signed in, checking if we need to reconnect them to some rooms`);
        const acct = this.purple.getAccount(ev.account.username, ev.account.protocol_id);
        const matrixUser = await this.store.getMatrixUserForAccount(ev.account);
        if (matrixUser === null) {
            log.warn(`${ev.account.username} isn't bound to a matrix account. Disabling`);
            if (acct !== null) {
                acct.setEnabled(false);
                return;
            }
            log.error(`Tried to get ${ev.account.username} but libpurple found nothing. This shouldn't happen!`);
            return;
        }
        const remoteId = Util.createRemoteId(ev.account.protocol_id, ev.account.username);
        const reconnectStack = this.accountRoomMemberships.get(remoteId) || [];
        log.debug(`Found ${reconnectStack.length} reconnections to be made for ${remoteId}`);
        let membership: IRoomMembership|undefined;
        membership = reconnectStack.pop();
        while (membership) {
            if (membership.membership === "join") {
                log.info(`${remoteId} is joining ${membership.room_name}`);
                log.debug("with", membership.params);
                acct!.joinChat(membership.params);
                acct!.setJoinPropertiesForRoom(membership.room_name, membership.params);
            } else {
                log.info(`${remoteId} is leaving ${membership.room_name}`);
                acct!.rejectChat(membership.params);
                this.deduplicator.decrementRoomUsers(membership.room_name);
            }
            membership = reconnectStack.pop();
        }
        this.accountRoomMemberships.delete(remoteId);
    }
}
