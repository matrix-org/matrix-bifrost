import { IChatInvite } from "./purple/PurpleEvents";

const PRPL_MATRIX = "prpl-matrix";

/**
 * This class hacks around issues with  certain protocols, it's not pretty
 * but it allows us to work around issues with certain protocols.
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
}
