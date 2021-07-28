import { IChatInvite, IChatJoined, IChatJoinProperties } from "./bifrost/Events";
import { BifrostProtocol } from "./bifrost/Protocol";
import { Intent } from "matrix-appservice-bridge";
import { Logging } from "matrix-appservice-bridge";
import { IBifrostAccount } from "./bifrost/Account";
const log = Logging.get("ProtoHacks");

export const PRPL_MATRIX = "prpl-matrix";
export const PRPL_XMPP = "prpl-jabber";
export const PRPL_S4B = "prpl-sipe";
export const XMPP_JS = "xmpp-js";

/**
 * This class hacks around issues with certain protocols when interloping with
 * Matrix. The author kindly asks you to take care and document these functions
 * carefully so that future folks can understand what is going on.
 */
export class ProtoHacks {
    public static async addJoinProps(protocolId: string, props: any, userId: string, intent: Intent|string) {
        // When joining XMPP rooms, we should set a handle so pull off one from the users
        // profile.
        if (protocolId === PRPL_XMPP || protocolId === XMPP_JS) {
            try {
                if (typeof(intent) === "string") {
                    props.handle = intent;
                } else {
                    props.handle = (await intent.getProfileInfo(userId)).displayname;
                }
            } catch (ex) {
                log.warn("Failed to get profile for", userId);
                props.handle = userId;
            }
        }
    }

    public static removeSensitiveJoinProps(protocolId: string, props: any) {
        // XXX: We *don't* currently drop passwords to groups which leaves them
        // exposed in the room-store. Please be careful.
        if (protocolId === PRPL_XMPP || protocolId === XMPP_JS) {
            // Handles are like room nicks, so obviously don't store it.
            delete props.handle;
        }
    }

    public static getRoomNameFromProps(protocolId: string, props: IChatJoinProperties): string | undefined {
        if (protocolId === XMPP_JS) {
            return `${props.room}@${props.server}`;
        }
    }

    public static getRoomNameForInvite(invite: IChatInvite|IChatJoined): string {
        // prpl-matrix sends us an invite with the room name set to the
        // matrix user's displayname, but the real room name is the room_id.
        if (invite.account.protocol_id === PRPL_MATRIX) {
            return invite.join_properties.room_id;
        }
        if ("conv" in invite) {
            return invite.conv.name;
        }
        return invite.room_name;
    }

    public static getSenderIdToLookup(protocol: BifrostProtocol, senderId: string, chatName: string) {
        // If this is an XMPP MUC, we want to append the chatname to the user.
        if (protocol.id === PRPL_XMPP && chatName) {
            return `${chatName}/${senderId}`;
        }
        return senderId;
    }

    public static getSenderId(account: IBifrostAccount, senderId: string, roomName?: string): string {
        // XXX: XMPP uses "handles" in group chats which might not be the same as
        // the username.
        if (account.protocol.id === PRPL_XMPP && roomName) {
            return account.getJoinPropertyForRoom(roomName, "handle") || senderId;
        }
        return senderId;
    }
}
