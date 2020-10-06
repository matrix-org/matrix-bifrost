import { JID, jid } from "@xmpp/jid";

interface IGatewayMember {
    type: "xmpp"|"matrix";
    anonymousJid: JID;
}

export interface IGatewayMemberXmpp extends IGatewayMember {
    type: "xmpp";
    realJid: JID;
    devices: Set<string>;
}

export interface IGatewayMemberMatrix extends IGatewayMember {
    type: "matrix";
    matrixId: string;
}

/**
 * Handles storage of MUC membership for matrix and xmpp users.
 */
export class GatewayMUCMembership {
    private members: Map<string, Set<IGatewayMember>>; // chatName -> member

    constructor() {
        this.members = new Map();
    }

    public getMemberByAnonJid<G extends IGatewayMember>(chatName: string, anonJid: string): G|undefined {
        return this.getMembers(chatName).find((user) => user.anonymousJid.toString() === anonJid) as G;
    }

    public getMatrixMemberByMatrixId(chatName: string, matrixId: string): IGatewayMemberMatrix|undefined {
        return this.getMatrixMembers(chatName).find((user) => user.matrixId === matrixId);
    }

    public getXmppMemberByRealJid(chatName: string, realJid: string): IGatewayMemberXmpp|undefined {
        // Strip the resource.
        const j = jid(realJid);
        const strippedJid = `${j.local}@${j.domain}`;
        const member = this.getXmppMembers(chatName).find((user) => user.realJid!.toString() === strippedJid);
        return member;
    }

    public getXmppMembers(chatName: string): IGatewayMemberXmpp[] {
        return this.getMembers(chatName).filter((s) => s.type === "xmpp") as IGatewayMemberXmpp[];
    }

    public getMatrixMembers(chatName: string): IGatewayMemberMatrix[] {
        return this.getMembers(chatName).filter((s) => s.type === "matrix") as IGatewayMemberMatrix[];
    }

    public getMembers(chatName: string): IGatewayMember[] {
        const set = this.members.get(chatName) || new Set();
        return [...set];
    }

    public addMatrixMember(chatName: string, matrixId: string, anonymousJid: JID): boolean {
        if (this.getMatrixMemberByMatrixId(chatName, matrixId)) {
            return false;
        }

        const set = this.members.get(chatName) || new Set();
        set.add({
            type: "matrix",
            anonymousJid,
            matrixId,
        } as IGatewayMemberMatrix);
        this.members.set(chatName, set);
        return true;
    }

    public addXmppMember(chatName: string, realJid: JID, anonymousJid: JID): boolean {
        const member = this.getXmppMemberByRealJid(chatName, realJid.toString());
        if (member) {
            member.devices.add(realJid.toString());
            return false;
        }
        const set = this.members.get(chatName) || new Set();
        set.add({
            type: "xmpp",
            anonymousJid,
            realJid: jid(`${realJid.local}@${realJid.domain}`),
            devices: new Set([realJid.toString()]),
        } as IGatewayMemberXmpp);
        this.members.set(chatName, set);
        return true;
    }

    public removeMatrixMember(chatName: string, matrixId: string): boolean {
        const member = this.getMatrixMemberByMatrixId(chatName, matrixId);
        if (!member) {
            return false;
        }
        const set = this.members.get(chatName) || new Set();
        return set.delete(member);
    }

    /**
     * Remove an XMPP member from the gateway membership.
     * @param chatName The MUC the user is part of
     * @param realJid The real JID of the user
     * @returns True if this is the last device for this member, false otherwise.
     */
    public removeXmppMember(chatName: string, realJid: string): boolean {
        const member = this.getXmppMemberByRealJid(chatName, realJid);
        if (!member) {
            return false;
        }
        member.devices.delete(realJid.toString());
        if (member.devices.size) {
            return false;
        }
        const set = this.members.get(chatName)!;
        return set.delete(member);
    }
}
