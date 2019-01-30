import { XmppJsInstance, XMPP_PROTOCOL } from "./XJSInstance";
import { Element, x } from "@xmpp/xml";
import { jid, JID } from "@xmpp/jid";
import { Logging, Intent } from "matrix-appservice-bridge";
import { IEventRequestData, IBridgeContext } from "../MatrixTypes";
import { IConfigBridge } from "../Config";
import { MessageFormatter, IBasicProtocolMessage } from "..//MessageFormatter";
import { Metrics } from "../Metrics";
import { IGatewayRoomQuery, IGatewayJoin, IUserStateChanged, IStoreRemoteUser } from "../purple/PurpleEvents";
import { IGatewayRoom } from "../GatewayHandler";
import { PresenceCache } from "./PresenceCache";
import { IRemoteGroupData } from "../StoreTypes";
import { XHTMLIM } from "./XHTMLIM";
import { BifrostRemoteUser } from "../Store";
import { StzaPresenceItem, StzaMessage, StzaMessageSubject, StzaPresenceError } from "./Stanzas";

const log = Logging.get("XmppJsGateway");

const MAX_HISTORY = 100;

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
    constructor(private xmpp: XmppJsInstance, private config: IConfigBridge) {
        this.roomHistory = new Map();
        this.stanzaCache = new Map();
        this.roomUsers = new Map();
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

    public sendMatrixMessage(
        chatName: string, sender: string, msg: IBasicProtocolMessage, room: IGatewayRoom, roomname: string) {
        log.info(`Sending ${msg.id} to ${chatName}`);
        const id = msg.id!;
        const htmlMsg = (msg.formatted || []).find((f) => f.type === "html");
        let attachments: string[];
        if (msg.opts && msg.opts.attachments) {
            attachments = msg.opts.attachments.map((a) => a.uri );
        }
        const xMembers = this.getMemberJidSet(room, chatName);
        const from = xMembers[sender];
        if (!from) {
            log.error(`Cannot send ${msg.id}: No member cached.`);
            return;
        }
        const users = (this.roomUsers.get(chatName) || {});
        this.xmpp.xmppAddSentMessage(id);
        Object.keys(users).forEach((remoteJid) => {
            const stanza = new StzaMessage(from, remoteJid, id, "groupchat");
            stanza.html = htmlMsg ? XHTMLIM.HTMLToXHTML(htmlMsg.body) : "";
            stanza.body = msg.body;
            stanza.attachments = attachments;
            this.xmpp.xmppSend(stanza);
        });
    }

    public reflectXMPPMessage(stanza: Element) {
        Object.keys(this.roomUsers.get(stanza.attrs.to) || {}).forEach((to) => {
            stanza.attrs.to = to;
            this.xmpp.xmppWriteToStream(stanza);
        });
    }

    public sendMatrixMembership(
        chatName: string, sender: string, displayname: string, membership: "join"|"leave", room: IGatewayRoom,
        roomname: string,
    ) {
        // Iterate around each joined member and add the new presence step.
        const from = `${chatName}/` + (displayname || sender);
        const users = Object.keys(this.roomUsers.get(room.roomId) || {});
        users.forEach((remoteJid) => {
            const role = membership === "join" ? "participant" : "none";
            const type = membership === "join" ? "" : "unavailable";
            this.xmpp.xmppSend(new StzaPresenceItem(from, remoteJid, undefined, role, "none", false, from, type));
        });
    }

    public getMemberJidSet(room: IGatewayRoom, chatName: string) {
        const set = {};
        room.membership.forEach((ev) => {
            if (ev.membership !== "join") { return; }
            set[ev.sender] = `${chatName}/` + (ev.content.displayname || ev.sender);
        });
        return set;
    }

    public onRemoteJoin(err: string|null, joinId: string, room: IGatewayRoom|undefined, ownMxid: string|undefined) {
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
        Object.keys(xMembers).forEach((sender) => {
            if (sender === ownMxid) {
                return;
            }
            const from = xMembers[sender];
            this.xmpp.xmppSend(
                new StzaPresenceItem(from, stanza.attrs.from),
            );
        });
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

    public reconnectRemoteUser(user: BifrostRemoteUser) {
        log.info("I have been called upon to resurrect " + user.id);
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
