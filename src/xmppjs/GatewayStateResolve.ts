import jid from "@xmpp/jid";
import { Logging } from "matrix-appservice-bridge";
import { MatrixMembershipEvent } from "../MatrixTypes";
import { GatewayMUCMembership } from "./GatewayMUCMembership";
import { IStza, PresenceAffiliation, PresenceRole, StzaBase, StzaPresenceItem } from "./Stanzas";
import { IGatewayRoom } from "../bifrost/Gateway";
import { XMPPStatusCode } from "./XMPPConstants";

const log = Logging.get("GatewayStateResolve");

function sendToAllDevices(presence: StzaPresenceItem, devices: Set<string>) {
    return [...devices].map((deviceJid) =>
        new StzaPresenceItem(
            presence.from,
            deviceJid,
            undefined,
            presence.affiliation,
            presence.role,
            false,
            undefined,
            presence.presenceType,
            presence.avatarHash,
        )
    )

}

export class GatewayStateResolve {
    static resolveMatrixStateToXMPP(chatName: string, members: GatewayMUCMembership, event: MatrixMembershipEvent, room: IGatewayRoom): IStza[] {
        const membership = event.content.membership;
        let stanzas: IStza[] = [];
        const allDevices = members.getXmppMembersDevices(chatName);
        const from = `${chatName}/` + (event.content.displayname || event.state_key);
        if (allDevices.size === 0) {
            log.warn("No users found for gateway room!");
            return stanzas;
        }
        const existingMember = members.getMatrixMemberByMatrixId(chatName, event.state_key);
        const xmppMember = members.getXmppMemberByMatrixId(chatName, event.state_key);
        if (membership === "join") {
            log.info(`Joining a Matrix user ${event.state_key}`);
            if (existingMember) {
                // Do not handle if we already have them
                return [];
            }
            if (xmppMember) {
                // Catch to avoid double bridging.
                return [];
            }
            // Get room membership to fetch the avatar hash
            const roomMembership = room.membership.find((e) => e.stateKey === event.state_key);
            // Matrix Join
            members.addMatrixMember(chatName, event.state_key, jid(from), roomMembership.avatar_hash);
            // Reflect to all
            stanzas = sendToAllDevices(
                new StzaPresenceItem(
                    from,
                    "",
                    undefined,
                    PresenceAffiliation.Member,
                    PresenceRole.Participant,
                    null,
                    null,
                    null,
                    roomMembership.avatar_hash,
                ), allDevices,
            );
        } else if (membership === "leave" && event.state_key === event.sender) {
            log.info(`Leaving a Matrix user ${event.state_key}`);
            if (!existingMember) {
                // Do not handle if we don't have them
                return [];
            }
            // Matrix leave
            members.removeMatrixMember(chatName, event.state_key);
            // Reflect to all
            stanzas = sendToAllDevices(
                new StzaPresenceItem(
                    existingMember.anonymousJid.toString(),
                    "",
                    undefined,
                    PresenceAffiliation.Member,
                    PresenceRole.None,
                    false,
                    undefined,
                    "unavailable",
                ), allDevices,
            );
        } else if ((membership === "leave" || membership === "ban") && event.state_key !== event.sender) {
            const kicker = members.getMatrixMemberByMatrixId(chatName, event.sender);
            if (existingMember) {
                log.info(`Kicking a Matrix user ${event.state_key}`);
                // This is Matrix -> Matrix
                members.removeMatrixMember(chatName, event.state_key);
                // Reflect to all
                const presence = new StzaPresenceItem(
                    existingMember.anonymousJid.toString(),
                    "",
                    undefined,
                    PresenceAffiliation.None,
                    PresenceRole.None,
                    false,
                    undefined,
                    "unavailable",
                );
                presence.actor = kicker?.anonymousJid.getResource();
                presence.reason = event.content.reason;
                presence.statusCodes.add(XMPPStatusCode.SelfKicked);
                stanzas = sendToAllDevices(presence, allDevices);
            } else if (xmppMember) {
                log.info(`Kicking a XMPP user ${event.state_key}`);
                // This is Matrix -> XMPP
                members.removeXmppMember(chatName, xmppMember.realJid.toString());

                const presenceSelf = new StzaPresenceItem(
                    xmppMember.anonymousJid.toString(),
                    "",
                    undefined,
                    membership === "leave" ? PresenceAffiliation.None : PresenceAffiliation.Outcast,
                    PresenceRole.None,
                    true,
                    undefined,
                    "unavailable",
                );
                presenceSelf.actor = kicker?.anonymousJid.getResource();
                presenceSelf.reason = event.content.reason;
                presenceSelf.statusCodes.add( membership === "leave" ? XMPPStatusCode.SelfKicked : XMPPStatusCode.SelfBanned);

                // Tell the XMPP user's devices.
                stanzas.push(...sendToAllDevices(presenceSelf, xmppMember.devices));

                const presence = new StzaPresenceItem(
                    xmppMember.anonymousJid.toString(),
                    "",
                    undefined,
                    membership === "leave" ? PresenceAffiliation.None : PresenceAffiliation.Outcast,
                    PresenceRole.None,
                    false,
                    undefined,
                    "unavailable",
                );
                presence.statusCodes.add( membership === "leave" ? XMPPStatusCode.SelfKicked : XMPPStatusCode.SelfBanned);
                // Tell the others
                stanzas = sendToAllDevices(presence, allDevices);
            } else {
                // We're not sure what this is, nope out to play it safe.
                return [];
            }
        } else if (membership === "invite") {
            // TODO: Invites
        }
        return stanzas;
    }
}