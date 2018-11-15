import { IChatInvite } from "./purple/PurpleEvents";
import { PurpleProtocol } from "./purple/PurpleInstance";

const PRPL_MATRIX = "prpl-matrix";
const PRPL_XMPP = "prpl-jabber";

/**
 * This class hacks around issues with certain protocols when interloping with
 * Matrix. The author kindly asks you to take care and document these functions
 * carefully so that future folks can understand what is going on.
 */
export class ProtoHacks {
    public static getRoomNameForInvite(invite: IChatInvite): string {
        // prpl-matrix sends us an invite with the room name set to the
        // matrix user's displayname, but the real room name is the room_id.
        if (invite.account.protocol_id === PRPL_MATRIX) {
            return invite.join_properties.room_id;
        }
        return invite.room_name;
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
