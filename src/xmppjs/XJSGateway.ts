import { XmppJsInstance, XMPP_PROTOCOL } from "./XJSInstance";
import { Element, x } from "@xmpp/xml";
import { jid, JID } from "@xmpp/jid";
import { Logging } from "matrix-appservice-bridge";
import { IConfigBridge } from "../Config";
import { IBasicProtocolMessage } from "..//MessageFormatter";
import { IGatewayJoin, IUserStateChanged, IStoreRemoteUser, IUserInfo } from "../bifrost/Events";
import { IGatewayRoom } from "../bifrost/Gateway";
import { PresenceCache } from "./PresenceCache";
import { XHTMLIM } from "./XHTMLIM";
import { BifrostRemoteUser } from "../store/BifrostRemoteUser";
import { StzaPresenceItem, StzaMessage, StzaMessageSubject,
    StzaPresenceError, StzaBase, StzaPresenceKick, PresenceAffiliation, PresenceRole } from "./Stanzas";
import { IGateway } from "../bifrost/Gateway";
import { GatewayMUCMembership, IGatewayMemberXmpp, IGatewayMemberMatrix } from "./GatewayMUCMembership";
import { XMPPStatusCode } from "./XMPPConstants";
import { AutoRegistration } from "../AutoRegistration";
import { GatewayStateResolve } from "./GatewayStateResolve";
import { MatrixMembershipEvent } from "../MatrixTypes";

const log = Logging.get("XmppJsGateway");

/**
 * This class effectively implements a MUC that sits in between the gateway interface
 * and XMPP.
 */

export class XmppJsGateway implements IGateway {
    // For storing room history, should be clipped at MAX_HISTORY per room.
    private roomHistory: Map<string, [Element]>;
    // For storing requests to be responded to, like joins
    private stanzaCache: Map<string, Element>; // id -> stanza
    private presenceCache: PresenceCache;
    // Storing every XMPP user and their anonymous.
    private members: GatewayMUCMembership;
    constructor(private xmpp: XmppJsInstance, private registration: AutoRegistration, private config: IConfigBridge) {
        this.roomHistory = new Map();
        this.stanzaCache = new Map();
        this.members = new GatewayMUCMembership();
        this.presenceCache = new PresenceCache(true);
    }

    public handleStanza(stanza: Element, gatewayAlias: string) {
        const delta = this.presenceCache.add(stanza);
        if (!delta) {
            log.debug("No delta");
            return;
        }
        const to = jid(stanza.attrs.to);
        const convName = `${to.local}@${to.domain}`;
        const isMucType = stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/muc");
        log.info(`Handling ${stanza.name} from=${stanza.attrs.from} to=${stanza.attrs.to} for ${gatewayAlias}`);
        if ((delta.changed.includes("online") || delta.changed.includes("newdevice")) && isMucType) {
            this.addStanzaToCache(stanza);
            // Gateways are special.
            // We also want to drop the resource from the sender.
            const from = jid(stanza.attrs.from);
            const sender = `${from.local}@${from.domain}`;
            this.xmpp.emit("gateway-joinroom", {
                join_id: stanza.attrs.id,
                roomAlias: gatewayAlias,
                sender,
                nick: to.resource,
                protocol_id: XMPP_PROTOCOL.id,
                room_name: `${to.local}@${to.domain}`,
            } as IGatewayJoin);
        } else if (delta.changed.includes("offline")) {
            const wasKicked = delta.status!.kick;
            let kicker: string|undefined;

            if (wasKicked && wasKicked.kicker) {
                kicker = `${convName}/${wasKicked.kicker}`;
            }
            const member = this.members.getXmppMemberByRealJid(convName, stanza.attrs.from);
            this.remoteLeft(stanza);
            if (!member) {
                log.warn("User has gone offline, but we don't have a member for them");
                return;
            }
            if (member.devices.size) {
                // User still has other devices, not leaving.
                log.info(`User has ${member.devices.size} other devices, not leaving.`);
                return;
            }
            this.xmpp.emit("chat-user-left", {
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: convName,
                },
                sender: member.realJid.toString(),
                state: "left",
                kicker,
                reason: wasKicked ? wasKicked.reason : delta.status!.status,
                gatewayAlias,
            } as IUserStateChanged);
        } else {
            log.debug("Nothing to do");
        }
    }

    public addStanzaToCache(stanza: Element) {
        this.stanzaCache.set(stanza.attrs.id, stanza);
        log.debug("Added cached stanza for " + stanza.attrs.id);
    }

    public isJIDInMuc(chatName: string, j: JID) {
        return !!this.members.getXmppMemberByRealJid(chatName, j);
    }

    public getMatrixIDForJID(chatName: string, j: JID) {
        const user = this.members.getMemberByAnonJid<IGatewayMemberMatrix>(chatName, j.toString());
        if (!user) {
            return false;
        }
        log.debug(`Got ${user.matrixId} for ${chatName}`);
        return user.matrixId;
    }

    public getAnonIDForJID(chatName: string, j: JID): string|null {
        const member = this.members.getXmppMemberByRealJid(chatName, j.toString());
        if (member) {
            return member.anonymousJid.toString();
        }
        return null;
    }

    public sendMatrixMessage(
        chatName: string, sender: string, msg: IBasicProtocolMessage, room: IGatewayRoom) {
        this.updateMatrixMemberListForRoom(chatName, room);
        log.info(`Sending ${msg.id} to ${chatName}`);
        const from = this.members.getMatrixMemberByMatrixId(chatName, sender);
        if (!from) {
            log.error(`Cannot send ${msg.id}: No member cached.`);
            return;
        }
        this.xmpp.xmppAddSentMessage(msg.id!);

        // Ensure that the html portion is XHTMLIM
        if (msg.formatted) {
            msg.formatted!.forEach((fmt) => {
                if (fmt.type === "html") {
                    fmt.body = XHTMLIM.HTMLToXHTML(fmt.body);
                }
            });
        }
        const msgs = [...this.members.getXmppMembersDevices(chatName)].map((device) =>
            new StzaMessage(
                from.anonymousJid.toString(),
                device,
                msg,
                "groupchat",
            )
        );
        return this.xmpp.xmppSendBulk(msgs);
    }

    /**
     * Send a XMPP message to the occupants of a gateway.
     * @param chatName The XMPP MUC name
     * @param stanza The XMPP stanza message
     * @returns If the message was sent successfully.
     */
    public async reflectXMPPMessage(chatName: string, stanza: Element, kickNonMember=true): Promise<boolean> {
        const member = this.members.getXmppMemberByRealJid(chatName, stanza.attrs.from);
        if (!member && kickNonMember) {
            log.warn(`${stanza.attrs.from} is not part of this room.`);
            // Send the sender an error.
            const kick = new StzaPresenceKick(
                stanza.attrs.to,
                stanza.attrs.from,
            );
            kick.statusCodes.add(XMPPStatusCode.SelfPresence);
            kick.statusCodes.add(XMPPStatusCode.SelfKicked);
            kick.statusCodes.add(XMPPStatusCode.SelfKickedTechnical);
            await this.xmpp.xmppSend(kick);
            return false;
        } else if (!member) {
            return false;
        }
        const preserveFrom = stanza.attrs.from;
        try {
            stanza.attrs.from = member!.anonymousJid;
            const xmppMembers = this.members.getXmppMembers(chatName);
            await Promise.all(xmppMembers.map((xmppUser) => {
                [...xmppUser.devices!].map((device) => {
                    stanza.attrs.to = device;
                    this.xmpp.xmppWriteToStream(stanza);
                });
            }).flat());
        } catch (err) {
            log.warn("Failed to reflect XMPP message:", err);
            stanza.attrs.from = preserveFrom;
            return false;
        }
        stanza.attrs.from = preserveFrom;
        return true;
    }

    public reflectXMPPStanza(chatName: string, stanza: StzaBase) {
        const xmppDevices = [...this.members.getXmppMembersDevices(chatName)];
        xmppDevices.forEach((device) => {
            stanza.to = device;
            this.xmpp.xmppSend(stanza);
        });
    }

    public reflectPM(stanza: Element) {
        const to = jid(stanza.attrs.to);
        const convName = `${to.local}@${to.domain}`;
        // This is quite easy..
        const sender = this.members.getXmppMemberByRealJid(convName, stanza.attrs.from);
        if (!sender) {
            log.error("Cannot find sender in memberlist for PM");
            return;
        }
        const recipient = this.members.getMemberByAnonJid<IGatewayMemberXmpp>(convName, stanza.attrs.to);
        if (!recipient) {
            log.error("Cannot find recipient in memberlist for PM");
            return;
        }
        stanza.attrs.from = sender.anonymousJid.toString();
        for (const device of recipient.devices) {
            stanza.attrs.to = device;
            log.info(`Reflecting PM message ${stanza.attrs.from} -> ${stanza.attrs.to}`);
            this.xmpp.xmppWriteToStream(stanza);
        }
    }

    public async sendMatrixMembership(
        chatName: string, event: MatrixMembershipEvent,
    ) {
        log.info(`Got new ${event.content.membership} for ${event.state_key} (from: ${event.sender}) in ${chatName}`);
        // Iterate around each joined member and add the new presence step.
        const presenceEvents = GatewayStateResolve.resolveMatrixStateToXMPP(chatName, this.members, event);
        if (presenceEvents.length === 0) {
            log.info(`Nothing to do for ${event.event_id}`);
            return;
        }
        await this.xmpp.xmppSendBulk(presenceEvents);
    }

    public sendStateChange(
        chatName: string, sender: string, type: "topic"|"name"|"avatar", room: IGatewayRoom,
    ) {
        log.info(`Got new ${type} for ${sender} in ${chatName}`);
        // Iterate around each joined member and add the new presence step.
        const users = this.members.getXmppMembers(chatName);
        if (users.length === 0) {
            log.warn("No users found for gateway room!");
        }
        if (type !== "topic" && type !== "name") {
            return;
        }
        this.reflectXMPPStanza(chatName,
            new StzaMessageSubject(chatName, "", undefined,
            `${room.name || ""} ${room.topic ? "| " + room.topic : ""}`,
        ));
    }

    public getMxidForRemote(sender: string) {
        const j = jid(sender);
        const username = `${j.local}@${j.domain}`;
        return XMPP_PROTOCOL.getMxIdForProtocol(username, this.config.domain, this.config.userPrefix).getId();
    }

    public async onRemoteJoin(
        err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined,
    ) {
        log.debug("Handling remote join for " + joinId);
        const stanza = this.stanzaCache.get(joinId);
        this.stanzaCache.delete(joinId);
        if (!stanza) {
            log.error("Could not find stanza in cache for remoteJoin. Cannot handle");
            throw Error("Stanza for join not in cache, cannot handle");
        }
        const from = jid(stanza.attrs.from);
        const to = jid(stanza.attrs.to);
        const chatName = `${to.local}@${to.domain}`;

        if (err || !room) {
            const presenceStatus = this.presenceCache.getStatus(stanza.attrs.from);
            if (presenceStatus) {
                presenceStatus.online = false;
                this.presenceCache.modifyStatus(stanza.attrs.from, presenceStatus);
            }
            log.warn("Responding with an error to remote join:", err);
            // XXX: Specify the actual failure reason.
            this.xmpp.xmppSend(new StzaPresenceError(
                stanza.attrs.to, stanza.attrs.from, stanza.attrs.id,
                chatName, "cancel", "service-unavailable",
            ));
            return;
        }
        room = room!;

        if (!ownMxid) {
            throw Error('ownMxid is not defined');
        }

        // Ensure our membership is accurate.
        this.updateMatrixMemberListForRoom(chatName, room, true); // HACK: Always update members for joiners
        const members = this.members.getMembers(chatName);

        // Check if the nick conflicts.
        const existingMember = this.members.getMemberByAnonJid(chatName, stanza.attrs.to);
        if (existingMember) {
            if (existingMember.type === "matrix") {
                log.error("Conflicting nickname, not joining");
                this.xmpp.xmppSend(new StzaPresenceError(
                    stanza.attrs.to, stanza.attrs.from, stanza.attrs.id,
                    chatName, "cancel", "conflict",
                ));
                throw Error("Conflicting nickname, not joining");
            }
            const existingXmppMember = existingMember as IGatewayMemberXmpp;
            const existingUserId = `${existingXmppMember.realJid!.local}@${existingXmppMember.realJid!.domain}`;
            const currentUserId = `${from.local}@${from.domain}`;
            if (existingXmppMember.devices.has(stanza.attrs.from)) {
                log.debug("Existing device has requested a join");
                // An existing device has reconnected, so fall through here.
            } else if (existingUserId === currentUserId) {
                log.debug(`${currentUserId} is joining from a new device ${from.resource}`);
            } else {
                // Different user after the same nick, heck them.
                log.error("Conflicting nickname, not joining");
                this.xmpp.xmppSend(new StzaPresenceError(
                    stanza.attrs.to, stanza.attrs.from, stanza.attrs.id,
                    chatName, "cancel", "conflict",
                ));
                throw Error("Conflicting nickname, not joining");
            }
        }

        /* Critical section - We need to emit membership to the user, but
           we can't store they are joined yet.
           https://github.com/matrix-org/matrix-bifrost/issues/132
         */

        // https://xmpp.org/extensions/xep-0045.html#order
        // 1. membership of others.
        log.debug(`Emitting membership of other users (${members.length})`);
        // Ensure we chunk this
        let sent = 0;
        const allMembershipPromises: Promise<unknown>[] = [];
        for (const member of members) {
            sent++;
            if (member.anonymousJid.toString() === stanza.attrs.to) {
                continue;
            }
            if (sent % 100 === 0) {
                try {
                    await this.xmpp.xmppWaitForDrain(250);
                } catch (ex) {
                    log.warn("Drain didn't arrive, oh well");
                }
            }
            let realJid;
            if ((member as IGatewayMemberXmpp).realJid) {
                realJid = (member as IGatewayMemberXmpp).realJid.toString();
            } else {
                realJid = this.registration.generateParametersFor(
                    XMPP_PROTOCOL.id, (member as IGatewayMemberMatrix).matrixId,
                ).username;
            }
            allMembershipPromises.push(this.xmpp.xmppSend(
                new StzaPresenceItem(
                    member.anonymousJid.toString(),
                    stanza.attrs.from,
                    undefined,
                    PresenceAffiliation.Member,
                    PresenceRole.Participant,
                    false,
                    realJid,
                ),
            ));
        }

        // Wait for all presence to be sent first.
        await Promise.all(allMembershipPromises);

        log.debug("Emitting membership of self");
        // 2. self presence
        const selfPresence = new StzaPresenceItem(
            stanza.attrs.to,
            stanza.attrs.from,
            undefined,
            PresenceAffiliation.Member,
            PresenceRole.Participant,
            true,
        );

        // Matrix is non-anon, and Matrix logs.
        selfPresence.statusCodes.add(XMPPStatusCode.RoomNonAnonymous);
        selfPresence.statusCodes.add(XMPPStatusCode.RoomLoggingEnabled);
        await this.xmpp.xmppSend(selfPresence);
        // Send everyone else the users new presence.
        await this.reflectXMPPMessage(chatName, x("presence", {
                from: stanza.attrs.from,
                to: null,
                id: stanza.attrs.id,
            }, x("x", {
                    xmlns: "http://jabber.org/protocol/muc#user",
                }, [
                    x("item", {affiliation: "member", role: "participant"}),
                ]),
        ), false);

        // FROM THIS POINT ON, WE CONSIDER THE USER JOINED.

        this.members.addXmppMember(
            `${to.local}@${to.domain}`,
            jid(stanza.attrs.from),
            jid(stanza.attrs.to),
            ownMxid,
        );

        // 3. Room history
        log.debug("Emitting history");
        const history: Element[] = this.roomHistory.get(room.roomId) || [];
        history.forEach((e) => {
            e.attrs.to = stanza.attrs.from;
            // TODO: Add delay info to this.
            this.xmpp.xmppWriteToStream(e);
        });
        log.debug("Emitting subject");
        // 4. The room subject
        this.xmpp.xmppSend(new StzaMessageSubject(chatName, stanza.attrs.from, undefined,
            `${room.name || ""} ${room.topic ? "| " + room.topic : ""}`,
        ));


        // All done, now for some house cleaning.
        // Store this user so we can reconnect them on restart.
        this.xmpp.emit("store-remote-user", {
            mxId: ownMxid,
            remoteId: stanza.attrs.to,
            protocol_id: XMPP_PROTOCOL.id,
            data: {
                handle: stanza.attrs.to,
                real_jid: stanza.attrs.from,
                room_name: `${to.local}@${to.domain}`,
            },
        } as IStoreRemoteUser);
        log.debug(`Join complete for ${to}`);
    }

    public reconnectRemoteUser(user: BifrostRemoteUser, mxUserId: string, room: IGatewayRoom) {
        if (!user.extraData.real_jid) {
            return;
        }
        log.info("I have been called upon to resurrect " + user.id);
        this.updateMatrixMemberListForRoom(user.extraData.room_name, room);
        // Make sure we cache this
        this.members.addXmppMember(
            user.extraData.room_name,
            jid(user.extraData.real_jid),
            jid(`${user.extraData.handle}`),
            mxUserId,
        );
    }

    public async getUserInfo(who: string): Promise<IUserInfo> {
        const j = jid(who);
        let nickname = j.resource || j.local;
        let photo: string|undefined;
        try {
            const res = await this.xmpp.getVCard(who);
            nickname = res.getChild("NICKNAME")?.getText() || nickname;
            const photoElement = res.getChild("PHOTO");
            if (photoElement) {
                photo = `${photoElement.getChildText("TYPE")}|${photoElement.getChildText("BINVAL")}`;
            }
        } catch (ex) {
            log.warn("Failed to fetch VCard", ex);
        }
        const ui: IUserInfo = {
            Nickname: j.resource || j.local,
            Avatar: photo,
            eventName: "meh",
            who,
            account: {
                protocol_id: "",
                username: "",
            },
        };
        return ui;
    }

    public async getAvatarBuffer(uri: string, senderId: string): Promise<{ type: string; data: Buffer; }> {
        // The URI is the base64 value of the data prefixed by the type.
        const [type, dataBase64] = uri.split("|");
        if (!type || !type.includes("/") || !dataBase64) {
            throw Error("Avatar uri was malformed");
        }
        const data = Buffer.from(dataBase64, "base64");
        return { type, data };
    }

    public maskPMSenderRecipient(senderMxid: string, recipientJid: string)
        : {recipient: string, sender: string}|undefined {
        const j = jid(recipientJid);
        const convName = `${j.local}@${j.domain}`;
        log.info("Looking up possible gateway:", senderMxid, recipientJid, convName);
        const recipient = this.members.getMemberByAnonJid<IGatewayMemberXmpp>(convName, recipientJid);
        if (!recipient) {
            return undefined;
        }
        const sender = this.members.getMatrixMemberByMatrixId(convName, senderMxid);
        if (!sender) {
            log.warn("Couldn't get sender's mxid");
            throw Error("Couldn't find the senders anonymous jid for a MUC PM over the gateway");
        }
        return {
            recipient: recipient.devices[recipient.devices.size - 1].toString(),
            sender: sender.anonymousJid.toString(),
        };
    }

    private updateMatrixMemberListForRoom(chatName: string, room: IGatewayRoom, allowForJoin = false) {
        if (!allowForJoin && this.members.getMatrixMembers(chatName)) {
            return;
        }
        const joined = room.membership.filter((member) => member.membership === "join" && !member.isRemote);
        joined.forEach((member) => {
            this.members.addMatrixMember(
                chatName,
                member.stateKey,
                jid(`${chatName}/${member.displayname || member.stateKey}`),
            );
        });
        const left = room.membership.filter((member) => member.membership === "leave" && !member.isRemote);
        left.forEach((member) => {
            this.members.removeMatrixMember(
                chatName,
                member.stateKey,
            );
        });
        log.info(`Updating membership for ${chatName} ${room.roomId} j:${joined.length} l:${left.length}`);
    }

    private remoteLeft(stanza: Element) {
        log.info(`${stanza.attrs.from} left ${stanza.attrs.to}`);
        const to = jid(stanza.attrs.to);
        const chatName = `${to.local}@${to.domain}`;
        const user = this.members.getXmppMemberByRealJid(chatName, stanza.attrs.from);
        if (!user) {
            log.error(`User tried to leave room, but they aren't in the member list`);
            return;
        }
        const lastDevice = this.members.removeXmppMember(chatName, stanza.attrs.from);
        const leaveStza = new StzaPresenceItem(
            user.anonymousJid.toString(),
            stanza.attrs.from,
            undefined,
            PresenceAffiliation.Member,
            PresenceRole.None,
            true,
            stanza.attrs.from,
        );
        leaveStza.presenceType = "unavailable";
        this.xmpp.xmppWriteToStream(leaveStza);
        // If this is the last device for that member, reflect
        // that change to everyone.
        if (lastDevice) {
            leaveStza.self = false;
            this.reflectXMPPStanza(chatName, leaveStza);
        }
    }
}
