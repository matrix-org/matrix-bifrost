import { IChatInvite } from "./purple/PurpleEvents";
import { PurpleProtocol } from "./purple/PurpleInstance";
import { Intent } from "matrix-appservice-bridge";
import { Logging } from "matrix-appservice-bridge";
const log = Logging.get("ProtoHacks");

const PRPL_MATRIX = "prpl-matrix";
const PRPL_XMPP = "prpl-jabber";

/**
 * This class hacks around issues with certain protocols when interloping with
 * Matrix. The author kindly asks you to take care and document these functions
 * carefully so that future folks can understand what is going on.
 */
export class ProtoHacks {

    public static async addJoinProps(protocolId: string, props: any, userId: string, intent: Intent) {
        // When joining XMPP rooms, we should set a handle so pull off one from the users
        // profile.
        if (protocolId === PRPL_XMPP) {
            try {
                props.handle = (await intent.getProfileInfo(userId)).displayname;
                log.debug("HANDLE", props);
            } catch (ex) {
                log.warn("Failed to get profile for", userId, ex);
                props.handle = userId;
            }
        }
    }

    public static removeSensitiveJoinProps(protocolId: string, props: any) {
        // XXX: We *don't* currently drop passwords to groups which leaves them
        // exposed in the room-store. Please be careful.
        if (protocolId === PRPL_XMPP) {
            // Handles are like room nicks, so obviously don't store it.
            delete props.handle;
        }
    }
    public static getRoomNameForInvite(invite: IChatInvite): string {
        // prpl-matrix sends us an invite with the room name set to the
        // matrix user's displayname, but the real room name is the room_id.
        if (invite.account.protocol_id === PRPL_MATRIX) {
            return invite.join_properties.room_id;
        }
        return invite.room_name;
    }

    public static getSenderIdToLookup(protocol: PurpleProtocol, senderId: string, chatName: string) {
        // If this is an XMPP MUC, we want to append the chatname to the user.
        if (protocol.id === PRPL_XMPP && chatName) {
            return `${chatName}/${senderId}`;
        }
        return senderId;
    }

    public static getSenderId(protocol: PurpleProtocol, senderId: string, isGroupChat: boolean): string {
        // if (protocol.id === PRPL_XMPP && !isGroupChat) {
        //     // XXX: XMPP senders have a / host appended to them. if it's a group
        //     // chat then we want the whole thing since it's a MUC style id:
        //     //     myconferenceroom@myconference.server/Username
        //     // wheras group chats have a jabber ID in the form of:
        //     //     testuser1@localhost/somehost
        //     // We want to keep the MUC id intact, but do not include the host
        //     // for PMs.
        //     if (senderId.includes("/")) {
        //         senderId = senderId.split("/")[0];
        //     }
        // }
        return senderId;
    }
}
