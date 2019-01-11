import { IChatJoinProperties,
    IUserInfo, IConversationEvent, IChatJoined, IAccountMinimal } from "../purple/PurpleEvents";
import { XmppJsInstance, XMPP_PROTOCOL } from "./XJSInstance";
import { IPurpleAccount, IChatJoinOptions } from "../purple/IPurpleAccount";
import { IPurpleInstance } from "../purple/IPurpleInstance";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { Element, x } from "@xmpp/xml";
import { jid, JID } from "@xmpp/jid";
import { IBasicProtocolMessage } from "../MessageFormatter";
import { Metrics } from "../Metrics";
import { Logging } from "matrix-appservice-bridge";
import * as uuid from "uuid/v4";

const IDPREFIX = "pbridge";
const CONFLICT_SUFFIX = "[m]";
const log = Logging.get("XmppJsAccount");

export class XmppJsAccount implements IPurpleAccount {

    get _waitingJoinRoomProps(): IChatJoinProperties|undefined {
        return undefined;
    }

    get name(): string {
        return this.remoteId;
    }

    get protocol(): PurpleProtocol {
        return XMPP_PROTOCOL;
    }
    public readonly waitingToJoin: Set<string>;
    public readonly isEnabled = true;
    public readonly connected = true;

    public readonly roomHandles: Map<string, string>;
    constructor(public readonly remoteId: string, public readonly resource, private xmpp: XmppJsInstance) {
        this.roomHandles = new Map();
        this.waitingToJoin = new Set();
    }

    public findAccount() {
        // TODO: What do we actually need to find.
    }

    public createNew(password?: string) {
        throw Error("Xmpp.js doesn't support registering accounts");
    }

    public setEnabled(enable: boolean) {
        throw Error("Xmpp.js doesn't allow you to enable or disable accounts");
    }

    public sendIM(recipient: string, msg: IBasicProtocolMessage) {
        const id = IDPREFIX + Date.now().toString();
        const message = x(
            "message",
            {
                to: recipient,
                id,
                from: `${this.remoteId}/${this.resource}`,
                type: "chat",
            },
            x("body", undefined, msg.body),
        );
        this.xmpp.xmppAddSentMessage(id);
        this.xmpp.xmppWriteToStream(message);
        Metrics.remoteCall("xmpp.message.im");
    }

    public sendChat(chatName: string, msg: IBasicProtocolMessage) {
        const id = msg.id || IDPREFIX + Date.now().toString();
        const contents: any[] = [];
        const htmlMsg = (msg.formatted || []).find((f) => f.type === "html");
        let htmlAnchor;
        if (msg.opts && msg.opts.attachments) {
            msg.opts.attachments.forEach((a) => {
                contents.push(
                    x("x", {
                        xmlns: "jabber:x:oob",
                    }, x("url", undefined, a.uri)));
                // *some* XMPP clients expect the URL to be in the body, silly clients...
                msg.body = a.uri;
            });
        } else if (htmlMsg) {
            htmlAnchor = Buffer.from(htmlMsg.body).toString("base64").replace(/\W/g, "a");
            contents.push(x("html", {
                xmlns: "http://jabber.org/protocol/xhtml-im",
            }), htmlAnchor);
        }
        contents.push(x("body", undefined, msg.body));
        let message: string = x(
            "message",
            {
                to: chatName,
                id,
                from: `${this.remoteId}/${this.resource}`,
                type: "groupchat",
            },
            contents,
        ).toString();
        if (htmlMsg) {
            message = message.replace(htmlAnchor, htmlMsg.body);
        }
        this.xmpp.xmppAddSentMessage(id);
        this.xmpp.xmppWriteToStream(message);
        Metrics.remoteCall("xmpp.message.groupchat");
    }

    public getBuddy(user: string): any|undefined {
        // TODO: Not implemented
        return;
    }

    public getJoinPropertyForRoom(roomName: string, key: string): string|undefined {
        // TODO: Not implemented
        return;
    }

    public setJoinPropertiesForRoom(roomName: string, props: IChatJoinProperties) {
        // TODO: Not implemented
    }

    public isInRoom(roomName: string): boolean {
        const handle = this.roomHandles.get(roomName);
        if (!handle) {
            log.debug("isInRoom: no handle set for ", this.remoteId);
            return false;
        }
        const res = this.xmpp.presenceCache.getStatus(roomName + "/" + handle);
        log.debug("isInRoom: Got presence for user:", res, this.remoteId);
        if (!res) {
            return false;
        }
        return res.online;
    }

    public async selfPing(to: string): Promise<boolean> {
        const id = uuid();
        await this.xmpp.xmppWriteToStream(x("iq", {
            xmlns: "jabber:client",
            type: "get",
            from: `${this.remoteId}/${this.resource}`,
            to,
            id,
        }, x("ping", {
            xmlns: "urn:xmpp:ping",
        })));
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => resolve(false), 1000);
            this.xmpp.on("iq." + id, (stanza: Element) => {
                clearTimeout(timeout);
                const error = stanza.getChild("error");
                if (error) {
                    log.warn("Self ping returned: ", error.toString());
                    resolve(false);
                }
                resolve(true);
            });
        });
        Metrics.remoteCall("xmpp.iq.ping");
    }

    public async joinChat(
        components: IChatJoinProperties,
        instance?: IPurpleInstance,
        timeout: number = 5000,
        setWaiting: boolean = true)
        : Promise<IConversationEvent|void> {
            const roomName = `${components.room}@${components.server}`;
            const to = `${roomName}/${components.handle}`;
            if (this.isInRoom(roomName)) {
                return {
                    eventName: "already-joined",
                    account: {
                        username: this.remoteId,
                        protocol_id: XMPP_PROTOCOL.id,
                    } as IAccountMinimal,
                    conv: {
                        name: roomName,
                    },
                };
            }
            if (await this.selfPing(to)) {
                this.roomHandles.set(roomName, components.handle);
                return {
                    eventName: "already-joined",
                    account: {
                        username: this.remoteId,
                        protocol_id: XMPP_PROTOCOL.id,
                    } as IAccountMinimal,
                    conv: {
                        name: roomName,
                    },
                };
            }
            const from = `${this.remoteId}/${this.resource}`;
            const id = uuid();
            log.info(`Joining to=${to} from=${from}`);
            const message = x(
                "presence",
                {
                    to,
                    from,
                    id,
                },
                x ("x", {
                    xmlns: "http://jabber.org/protocol/muc",
                }, x ("history", {
                    maxchars: "0", // No history
                })),
            );
            if (setWaiting) {
                this.waitingToJoin.add(roomName);
            }
            let p: Promise<IChatJoined>|undefined;
            if (instance) {
                p = new Promise((resolve, reject) => {
                    const timer = setTimeout(reject, timeout);
                    const cb = (data: IChatJoined) => {
                        if (data.conv.name === roomName &&
                            data.account.username === this.remoteId) {
                            this.roomHandles.set(roomName, components.handle);
                            clearTimeout(timer);
                            this.xmpp.removeListener("chat-joined", cb);
                            resolve(data);
                        }
                    };
                    this.xmpp.on("chat-joined", cb);
                });
            }
            await this.xmpp.xmppWriteToStream(message);
            Metrics.remoteCall("xmpp.presence.join");
            return p;
    }

    public async xmppRetryJoin(from: JID) {
        log.info("Retrying join for ", from.toString());
        if (from.resource.endsWith(CONFLICT_SUFFIX)) {
            // Kick from the room.
            throw new Error(`A user with the prefix '${CONFLICT_SUFFIX}' already exists, cannot join to room.`);
        }
        return this.joinChat({
            room: from.local,
            server: from.domain,
            handle: `${from.resource}${CONFLICT_SUFFIX}`,
        });
    }

    public async rejectChat(components: IChatJoinProperties) {
        const message = x(
            "presence",
            {
                to: `${components.room}@${components.server}/${components.handle}`,
                from: `${this.remoteId}/${this.resource}`,
                type: "unavailable",
            },
        );
        await this.xmpp.xmppWriteToStream(message);
        Metrics.remoteCall("xmpp.presence.left");
    }

    public getConversation(name: string): any {
        throw Error("getConversation not implemented");
    }

    public getChatParamsForProtocol(): IChatJoinOptions[] {
        return [
            {
                identifier: "server",
                label: "server",
                required: true,
            },
            {
                identifier: "room",
                label: "room",
                required: true,
            },
            {
                identifier: "handle",
                label: "handle",
                required: false,
            },
        ];
    }

    public async getUserInfo(who: string): Promise<IUserInfo> {
        const j = jid(who);
        const status = this.xmpp.presenceCache.getStatus(who);
        const ui: IUserInfo = {
            Nickname: j.resource || j.local,
            eventName: "meh",
            who,
            account: {
                protocol_id: this.protocol.id,
                username: this.remoteId,
            },
        };
        if (status && status.photoId) {
            ui.Avatar = status.photoId;
        }
        return ui;
    }

    public getAvatarBuffer(iconPath: string, senderId: string): Promise<{type: string, data: Buffer}> {
        const id = uuid();
        log.info(`Fetching avatar for ${senderId} (hash: ${iconPath})`);
        this.xmpp.xmppWriteToStream(
            x("iq", {
                from: `${this.remoteId}/${this.resource}`,
                to: senderId,
                type: "get",
                id,
            }, x("vCard", {xmlns: "vcard-temp"}),
        ));
        Metrics.remoteCall("xmpp.iq.vc2");
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(Error("Timeout")), 5000);
            this.xmpp.once("iq." + id, (stanza: Element) => {
                clearTimeout(timeout);
                const vCard = stanza.getChild("vCard");
                if (vCard) {
                    const photo = vCard.getChild("PHOTO");
                    if (!photo) {
                        reject("No PHOTO in vCard given");
                        return;
                    }
                    resolve(
                        {
                            data: Buffer.from(
                                photo.getChildText("BINVAL")!,
                                "base64",
                            ),
                            type: photo!.getChildText("TYPE") || "image/jpeg",
                        }
                    );
                }
                reject("No vCard given");
            });
        });
    }

}
