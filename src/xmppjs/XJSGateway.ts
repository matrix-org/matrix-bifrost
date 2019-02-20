import { XmppJsInstance, XMPP_PROTOCOL } from "./XJSInstance";
import { Element, x } from "@xmpp/xml";
import { jid, JID } from "@xmpp/jid";
import { Logging, Intent } from "matrix-appservice-bridge";
import { IConfigBridge } from "../Config";
import { MessageFormatter, IBasicProtocolMessage } from "..//MessageFormatter";
import { Metrics } from "../Metrics";
import { IGatewayRoomQuery, IGatewayJoin, IUserStateChanged, IStoreRemoteUser } from "../purple/PurpleEvents";
import { IGatewayRoom } from "../GatewayHandler";
import { PresenceCache } from "./PresenceCache";
import { XHTMLIM } from "./XHTMLIM";
import { BifrostRemoteUser } from "../Store";
import { StzaPresenceItem, StzaMessage, StzaMessageSubject, StzaPresenceError } from "./Stanzas";

const log = Logging.get("XmppJsGateway");

const MAX_HISTORY = 100;
const JOIN_PRESENCE_CHUNK_DELAY_MS = 333;

/**
 * This class effectively implements a MUC that sits in between the gateway interface
 * and XMPP.
 */

export class XmppJsGateway {
    // For storing room history, should be clipped at MAX_HISTORY per room.
    private roomHistory: Map<string, [Element]>;
    // For storing requests to be responded to, like joins
    private stanzaCache: Map<string, Element>; // id -> stanza
    private presenceCache: PresenceCache;
    // Storing every XMPP user and their anonymous.
    private roomUsers: Map<string, {[realJid: string]: string}>; // "room_name" -> {realJid: anonJid}
    private matrixRoomUsers: Map<string, {[matrixId: string]: string}>; // "room_name" -> {matrixId: anonJid}
    constructor(private xmpp: XmppJsInstance, private config: IConfigBridge) {
        this.roomHistory = new Map();
        this.stanzaCache = new Map();
        this.roomUsers = new Map();
        this.matrixRoomUsers = new Map();
        this.presenceCache = new PresenceCache();
    }

    public handleStanza(stanza: Element, gatewayAlias: string) {
        const delta = this.presenceCache.add(stanza);
        if (!delta) {
            return;
        }
        const to = jid(stanza.attrs.to);
        const convName = `${to.local}@${to.domain}`;
        const isMucType = stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/muc");

        if (delta.changed.includes("online") && isMucType) {
            this.addStanzaToCache(stanza);
            // Gateways are special.
            this.xmpp.emit("gateway-joinroom", {
                join_id: stanza.attrs.id,
                roomAlias: gatewayAlias,
                sender: stanza.attrs.to,
                protocol_id: XMPP_PROTOCOL.id,
                room_name: `${to.local}@${to.domain}`,
            } as IGatewayJoin);
        }

        if (delta.changed.includes("offline")) {
            const wasKicked = delta.status!.kick;
            let kicker;
            if (wasKicked && wasKicked.kicker) {
                kicker = `${convName}/${wasKicked.kicker}`;
            }

            this.xmpp.emit("chat-user-left", {
                conv: {
                    name: convName,
                },
                account: {
                    protocol_id: XMPP_PROTOCOL.id,
                    username: "any",
                },
                sender: this.getRoomJidForRealJid(convName, stanza.attrs.from),
                state: "left",
                kicker,
                reason: wasKicked ? wasKicked.reason : delta.status!.status,
                gatewayAlias,
            } as IUserStateChanged);

            // XXX: Emit to other XMPP users.
        }
    }

    public getRoomJidForRealJid(roomName: string, j: string) {
        return (this.roomUsers.get(`${roomName}`) || {})[j];
    }

    public addStanzaToCache(stanza: Element) {
        this.stanzaCache.set(stanza.attrs.id, stanza);
        log.debug("Added cached stanza for " + stanza.attrs.id);
    }

    public getMatrixIDForJID(j: JID) {
        const chatName = `${j.local}@${j.domain}`;
        const xmppMembers = this.roomUsers.get(chatName);
        if (xmppMembers && Object.keys(xmppMembers).find((m) => xmppMembers[m] === j.toString())) {
            // XMPP user exists for this anon jid, return false
            return false;
        }
        const members = this.matrixRoomUsers.get(chatName);
        if (!members) {
            throw Error("This room doesn't have a memberlist");
        }
        const userId = Object.keys(members).find((m) => members[m] === j.toString());
        log.debug(`Got ${userId} for ${chatName}`);
        if (userId) {
            return userId;
        }
        return false;
    }

    public getAnonIDForJID(chatName: string, j: JID) {
        return this.roomUsers.get(chatName)![j.toString()];
    }

    public sendMatrixMessage(
        chatName: string, sender: string, msg: IBasicProtocolMessage, room: IGatewayRoom, roomname: string) {
        log.info(`Sending ${msg.id} to ${chatName}`);
        const xMembers = this.getMemberJidSet(room, chatName);
        const from = xMembers[sender];
        if (!from) {
            log.error(`Cannot send ${msg.id}: No member cached.`);
            return;
        }
        const users = (this.roomUsers.get(chatName) || {});
        this.xmpp.xmppAddSentMessage(msg.id!);

        // Ensure that the html portion is XHTMLIM
        if (msg.formatted) {
            msg.formatted!.forEach((fmt) => {
                if (fmt.type === "html") {
                    fmt.body = XHTMLIM.HTMLToXHTML(fmt.body);
                }
            });
        }

        Object.keys(users).forEach((remoteJid) => {
            this.xmpp.xmppSend(new StzaMessage(from, remoteJid, msg, "groupchat"));
        });
    }

    public reflectXMPPMessage(stanza: Element) {
        Object.keys(this.roomUsers.get(stanza.attrs.to) || {}).forEach((to) => {
            stanza.attrs.to = to;
            this.xmpp.xmppWriteToStream(stanza);
        });
    }

    public reflectPM(stanza: Element) {
        const to = jid(stanza.attrs.to);
        const memberList = this.roomUsers.get(`${to.local}@${to.domain}`);
        if (!memberList) {
            throw Error("No memberlist for MUC");
        }
        stanza.attrs.from = memberList[stanza.attrs.from];
        stanza.attrs.to = Object.keys(memberList).find((m) => memberList[m] === stanza.attrs.to);
        log.info(`Reflecting PM message ${stanza.attrs.from} -> ${stanza.attrs.to}`);
        this.xmpp.xmppWriteToStream(stanza);
    }

    public sendMatrixMembership(
        chatName: string, sender: string, displayname: string, membership: "join"|"leave",
    ) {
        log.info(`Got new ${membership} for ${sender} in ${chatName}`);
        // Iterate around each joined member and add the new presence step.
        const from = `${chatName}/` + (displayname || sender);
        const users = Object.keys(this.roomUsers.get(chatName) || {});
        if (users.length === 0) {
            log.warn("No users found for gateway room!");
        }
        const memberList = this.matrixRoomUsers.get(chatName)!;
        if (membership === "join") {
            memberList[sender] = from;
        } else {
            delete memberList[sender];
        }
        this.matrixRoomUsers.set(chatName, memberList);
        let affiliation = "";
        let role = "";
        let type = "";
        if (membership === "join") {
            affiliation = "member";
            role = "participant";
        } else if (membership === "leave") {
            affiliation = "member";
            role = "none";
            type = "unavailable";
        }
        users.forEach((remoteJid) => {
            this.xmpp.xmppSend(
                new StzaPresenceItem(
                    from, remoteJid, undefined, affiliation,
                    role, false, undefined, type,
                ),
            );
        });
    }

    public sendStateChange(
        chatName: string, sender: string, type: "topic"|"name"|"avatar", room: IGatewayRoom,
    ) {
        log.info(`Got new ${type} for ${sender} in ${chatName}`);
        // Iterate around each joined member and add the new presence step.
        const users = Object.keys(this.roomUsers.get(chatName) || {});
        if (users.length === 0) {
            log.warn("No users found for gateway room!");
        }
        users.forEach((remoteJid) => {
            if (type === "topic" || type === "name") {
                this.xmpp.xmppSend(new StzaMessageSubject(chatName, remoteJid, undefined,
                    `${room.name || ""} ${room.topic ? "| " + room.topic : ""}`,
                ));
            }
        });
    }

    public getMemberJidSet(room: IGatewayRoom, chatName: string) {
        if (this.matrixRoomUsers.has(chatName)) {
            return this.matrixRoomUsers.get(chatName)!;
        }
        const set = {};
        room.membership.forEach((ev) => {
            if (ev.membership !== "join") { return; }
            set[ev.sender] = `${chatName}/` + (ev.content.displayname || ev.sender);
        });
        this.matrixRoomUsers.set(chatName, set);
        return set;
    }

    public async onRemoteJoin(
        err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined,
    ) {
        log.debug("Handling remote join for " + joinId);
        const stanza = this.stanzaCache.get(joinId);
        this.stanzaCache.delete(joinId);
        if (!stanza) {
            log.error("Could not find stanza in cache for remoteJoin. Cannot handle");
            return;
        }
        const to = jid(stanza.attrs.to);
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
                `${to.local}@${to.domain}`, "cancel", "service-unavailable",
            ));
        }
        room = room!;

        // https://xmpp.org/extensions/xep-0045.html#order

        // 1. membership of others.
        log.debug("Emitting membership of other users");
        const xMembers = this.getMemberJidSet(room, `${to.local}@${to.domain}`);
        // Ensure we chunk this
        let sent = 0;
        for (const sender of Object.keys(xMembers)) {
            sent++;
            log.debug(`Emitting ${sender} ${sent}/${Object.keys(xMembers).length}`);
            if (sender === ownMxid) {
                continue;
            }
            const from = xMembers[sender];
            this.xmpp.xmppSend(
                new StzaPresenceItem(from, stanza.attrs.from, undefined, "member", "participant"),
            );
            if (sent % 20 === 0) {
                log.debug(`Sent 20 presence statuses, waiting ${JOIN_PRESENCE_CHUNK_DELAY_MS}ms before sending more`);
                await new Promise((resolve) => setTimeout(resolve, JOIN_PRESENCE_CHUNK_DELAY_MS));
            }
        }

        log.debug("Emitting membership of self");
        // 2. self presence
        this.xmpp.xmppSend(
            new StzaPresenceItem(stanza.attrs.to, stanza.attrs.from, undefined, undefined, undefined, true));
        this.reflectXMPPMessage(x("presence", {
                from: stanza.attrs.to,
                to: null,
                id: stanza.attrs.id,
            }, x("x", {
                    xmlns: "http://jabber.org/protocol/muc#user",
                }, [
                    x("item", {affiliation: "member", role: "participant"}),
                ]),
        ));
        // 3. Room history
        log.debug("Emitting history");
        const history = this.roomHistory.get(room.roomId) || [];
        history.forEach((e) => {
            e.attrs.to = stanza.attrs.from;
            // TODO: Add delay info to this.
            this.xmpp.xmppWriteToStream(e);
        });
        // 4. The room subject
        this.xmpp.xmppSend(new StzaMessageSubject(stanza.attrs.to, stanza.attrs.from, undefined,
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
        this.addUserToRoomUsers(`${to.local}@${to.domain}`, stanza.attrs.to, stanza.attrs.from);
    }

    public reconnectRemoteUser(user: BifrostRemoteUser, room: IGatewayRoom) {
        log.info("I have been called upon to resurrect " + user.id);
        // Make sure we cache this
        this.getMemberJidSet(room, user.extraData.room_name);
        this.addUserToRoomUsers(
            user.extraData.room_name,
            user.extraData.handle,
            user.extraData.real_jid,
        );
    }

    private addUserToRoomUsers(roomName: string, roomJid: string, realJid: string) {
        const rUsers = (this.roomUsers.get(roomName) || {});
        rUsers[realJid] = roomJid;
        this.roomUsers.set(roomName, rUsers);
    }
}
