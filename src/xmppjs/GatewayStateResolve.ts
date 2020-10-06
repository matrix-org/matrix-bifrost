import jid from "@xmpp/jid";
import { Logging } from "matrix-appservice-bridge";
import { MatrixMembershipEvent } from "../MatrixTypes";
import { GatewayMUCMembership } from "./GatewayMUCMembership";
import { IStza, PresenceAffiliation, PresenceRole, StzaBase, StzaPresenceItem } from "./Stanzas";
import { XMPPStatusCode } from "./StatusCodes";

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
        )
    )

}

export class GatewayStateResolve {
    static async resolveMatrixStateToXMPP(chatName: string, members: GatewayMUCMembership, event: MatrixMembershipEvent): Promise<IStza[]> {
        const membership = event.content.membership;
        let stanzas: IStza[] = [];
        const allDevices = members.getXmppMembersDevices(chatName);
        const from = `${chatName}/` + (event.content.displayname || event.state_key);
        if (allDevices.size === 0) {
            log.warn("No users found for gateway room!");
            return stanzas;
        }
        const existingMember = members.getMatrixMemberByMatrixId(chatName, event.state_key);
        if (membership === "join") {
            if (existingMember) {
                // Do not handle if we already have them
                return [];
            }
            // Matrix Join
            const from = `${chatName}/` + (event.content.displayname || event.state_key);
            members.addMatrixMember(chatName, event.state_key, jid(from));
            // Reflect to all
            stanzas = sendToAllDevices(
                new StzaPresenceItem(
                    from,
                    "",
                    undefined,
                    PresenceAffiliation.Member,
                    PresenceRole.Participant
                ), allDevices,
            );
        } else if (membership === "leave" && event.state_key === event.sender) {
            if (!existingMember) {
                // Do not handle if we don't have them
                return [];
            }
            // Matrix leave
            members.removeMatrixMember(chatName, event.state_key);
                // Reflect to all
            stanzas = sendToAllDevices(
                new StzaPresenceItem(
                    from,
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
            const xmppKickee = members.getXmppMemberByMatrixId(chatName, event.state_key);
            if (existingMember) {
                // This is Matrix -> Matrix
                members.removeMatrixMember(chatName, event.state_key);
                // Reflect to all
                const presence = new StzaPresenceItem(
                    from,
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
            } else if (xmppKickee) {
                // This is Matrix -> XMPP
                members.removeXmppMember(chatName, xmppKickee.realJid.toString());
                // TODO: Tell the XMPP memeber that it got kicked.
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