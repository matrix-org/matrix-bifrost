import { JID, jid } from "@xmpp/jid";

interface IGatewayMember {
    type: "xmpp"|"matrix";
    anonymousJid: JID;
    matrixId: string;
}

export interface IGatewayMemberXmpp extends IGatewayMember {
    type: "xmpp";
    realJid: JID;
    devices: Set<string>;
}

export interface IGatewayMemberMatrix extends IGatewayMember {
    type: "matrix";
}

const FLAT_SUPPORTED = [].flat !== undefined;

class ChatMembers {
    constructor(
        private members = new Set<IGatewayMember>(),
        private byMxid = new Map<string, IGatewayMember>(),
    ) {}

    add(member: IGatewayMember): void {
        this.members.add(member);
        this.byMxid.set(member.matrixId, member);
    }

    delete(member: IGatewayMember): boolean {
        this.byMxid.delete(member.matrixId);
        return this.members.delete(member);
    }

    getAll(): Iterable<IGatewayMember> {
        return this.members.values();
    }

    getByMxid(mxid: string): IGatewayMember|undefined {
        return this.byMxid.get(mxid);
    }
}

/**
 * Handles storage of MUC membership for matrix and xmpp users.
 */
export class GatewayMUCMembership {
    private members: Map<string, ChatMembers>; // chatName -> members

    constructor() {
        this.members = new Map();
    }

    public hasMembershipForRoom(chatName: string) {
        return this.members.has(chatName);
    }

    public getAnonJidsForXmppJid(realJid: string|JID) {
        // Strip the resource.
        const jids: {[chatName: string]: {devices: string[], jid: string}} = {};
        for (const chatName of this.members.keys()) {
            const member = this.getXmppMemberByRealJid(chatName, realJid);
            if (member) {
                jids[chatName] = {
                    devices: [...member.devices],
                    jid: member.anonymousJid.toString(),
                }
            }
        }
        return jids;
    }

    public getMemberByAnonJid<G extends IGatewayMember>(chatName: string, anonJid: string): G|undefined {
        return Array.from(this.getMembers(chatName)).find((user) => user.anonymousJid.toString() === anonJid) as G;
    }

    public getMatrixMemberByMatrixId(chatName: string, matrixId: string): IGatewayMemberMatrix|undefined {
        const member = this.members.get(chatName)?.getByMxid(matrixId);
        if (member && member.type === 'matrix') {
            return member as IGatewayMemberMatrix;
        }
    }

    public getXmppMemberByDevice(chatName: string, realJid: string|JID): IGatewayMemberXmpp|undefined {
        const j = typeof(realJid) !== "string" ? realJid.toString() : realJid;
        const member = this.getXmppMembers(chatName).find((user) => user.devices.has(j));
        return member;
    }

    public getXmppMemberByRealJid(chatName: string, realJid: string|JID): IGatewayMemberXmpp|undefined {
        // Strip the resource.
        const j = typeof(realJid) === "string" ? jid(realJid) : realJid;
        const strippedJid = `${j.local}@${j.domain}`;
        const member = this.getXmppMembers(chatName).find((user) => user.realJid.toString() === strippedJid);
        return member;
    }

    public getXmppMemberByMatrixId(chatName: string, matrixId: string): IGatewayMemberXmpp|undefined {
        const chatMembers = this.members.get(chatName);
        if (chatMembers) {
            const member = chatMembers.getByMxid(matrixId);
            if (member?.type === 'xmpp') {
                return member as IGatewayMemberXmpp;
            }
        }
    }

    public getXmppMembers(chatName: string): IGatewayMemberXmpp[] {
        return Array.from(this.getMembers(chatName)).filter((s) => s.type === "xmpp") as IGatewayMemberXmpp[];
    }

    public getXmppMembersDevices(chatName: string): Set<string> {
        if (FLAT_SUPPORTED) {
            return new Set(this.getXmppMembers(chatName).map((u) => [...u.devices]).flat());
        } else {
            return new Set(this.getXmppMembers(chatName).map((u) => [...u.devices]).reduce((acc, val) => [ ...acc, ...val ], []));
        }
    }

    public getMatrixMembers(chatName: string): IGatewayMemberMatrix[] {
        return Array.from(this.getMembers(chatName)).filter((s) => s.type === "matrix") as IGatewayMemberMatrix[];
    }

    public getMembers(chatName: string): Iterable<IGatewayMember> {
        const chatMembers = this.members.get(chatName);
        if (chatMembers) {
            return chatMembers.getAll();
        } else {
            return [];
        }
    }

    public addMatrixMember(chatName: string, matrixId: string, anonymousJid: JID): boolean {
        if (this.getMatrixMemberByMatrixId(chatName, matrixId)) {
            return false;
        }

        const chatMembers = this.members.get(chatName) || new ChatMembers();
        chatMembers.add({
            type: "matrix",
            anonymousJid,
            matrixId,
        } as IGatewayMemberMatrix);
        this.members.set(chatName, chatMembers);
        return true;
    }

    /**
     * Add an XMPP member to a MUC chat.
     *
     * @param chatName The MUC name.
     * @param realJid The real JID for the XMPP user.
     * @param anonymousJid The anonymous JID for the the user in the context of the MUC.
     * @param matrixId The assigned Matrix UserID for the user.
     * @returns True if this is the first device for a user, false otherwise.
     */
    public addXmppMember(chatName: string, realJid: JID, anonymousJid: JID, matrixId: string): boolean {
        const strippedDevice = jid(`${realJid.local}@${realJid.domain}`);
        const member = this.getXmppMemberByRealJid(chatName, strippedDevice.toString());
        if (member) {
            member.devices.add(realJid.toString());
            return false;
        }
        const chatMembers = this.members.get(chatName) || new ChatMembers();
        chatMembers.add({
            type: "xmpp",
            anonymousJid,
            realJid: strippedDevice,
            devices: new Set([realJid.toString()]),
            matrixId,
        } as IGatewayMemberXmpp);
        this.members.set(chatName, chatMembers);
        return true;
    }

    public removeMatrixMember(chatName: string, matrixId: string): boolean {
        const chatMembers = this.members.get(chatName);
        if (chatMembers) {
            const member = chatMembers.getByMxid(matrixId);
            if (member) {
                chatMembers.delete(member);
                return true;
            }
        }
        return false;
    }

    /**
     * Remove an XMPP member from the gateway membership.
     *
     * @param chatName The MUC the user is part of
     * @param realJid The real JID of the user
     * @returns True if this is the last device for this member, false otherwise.
     */
    public removeXmppMember(chatName: string, realJid: string|JID): boolean {
        realJid = typeof(realJid) === "string" ? jid(realJid) : realJid;
        const member = this.getXmppMemberByRealJid(chatName, realJid);
        if (!member) {
            return false;
        }
        if (realJid.resource) {
            member.devices.delete(realJid.toString());
            if (member.devices.size) {
                return false;
            }
        }
        const chatMembers = this.members.get(chatName);
        return chatMembers ? chatMembers.delete(member) : true;
    }
}
