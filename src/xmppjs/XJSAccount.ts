import { IChatJoinProperties, IUserInfo, IConversationEvent, IChatJoined } from "../purple/PurpleEvents";
import { XmppJsInstance, XMPP_PROTOCOL } from "./XJSInstance";
import { IPurpleAccount, IChatJoinOptions } from "../purple/IPurpleAccount";
import { IPurpleInstance } from "../purple/IPurpleInstance";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { xml, jid } from "@xmpp/component";
import { IBasicProtocolMessage } from "../MessageFormatter";
import { Metrics } from "../Metrics";
import { JID } from "@xmpp/jid";
import { PurpleInstance } from "src/purple/PurpleInstance";

const IDPREFIX = "pbridge";
const CONFLICT_SUFFIX = "[m]";


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
    private rooms: Set<string>;
    // remoteId == jid
    constructor(public readonly remoteId: string, public readonly resource, private xmpp: XmppJsInstance) {
        this.rooms = new Set();
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
        const message = xml(
            "message",
            {
                to: recipient,
                id,
                from: `${this.remoteId}/${this.resource}`,
            },
            xml("body", null, msg.body),
        );
        this.xmpp.xmppAddSentMessage(id);
        this.xmpp.xmppWriteToStream(message);
        Metrics.remoteCall("xmpp.message.im");
    }

    public sendChat(chatName: string, msg: IBasicProtocolMessage) {
        const id = msg.id || IDPREFIX + Date.now().toString();
        const contents: any[] = [];
        contents.push(xml("body", null, msg.body));
        if (msg.opts && msg.opts.attachments) {
            msg.opts.attachments.forEach((a) => {
                contents.push(
                    xml("x", {
                        xmlns: "jabber:x:oob",
                    }, xml("url", null, a.uri)));
            });
        }
        const htmlMsg = (msg.formatted || []).find((f) => f.type === "html");
        if (htmlMsg) {
            contents.push(xml("html", {
                xmlns: "http://jabber.org/protocol/xhtml-im",
            }), htmlMsg.body);
        }
        const message = xml(
            "message",
            {
                to: chatName,
                id,
                from: `${this.remoteId}/${this.resource}`,
                type: "groupchat",
            },
            contents,
        );
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
        return false;
    }

    public async joinChat(
        components: IChatJoinProperties,
        instance?: IPurpleInstance,
        timeout: number = 5000,
        setWaiting: boolean = true)
        : Promise<IConversationEvent|void> {
            const message = xml(
                "presence",
                {
                    to: `${components.room}@${components.server}/${components.handle}`,
                    from: `${this.remoteId}/${this.resource}`,
                },
                xml ("x", {
                    xmlns: "http://jabber.org/protocol/muc",
                }, xml ("history", {
                    maxchars: "0", // No history
                })),
            );
            if (setWaiting) {
                this.waitingToJoin.add(`${components.room}@${components.server}`);
            }
            let p: Promise<IChatJoined>|undefined;
            if (instance) {
                p = new Promise((resolve, reject) => {
                    const timer = setTimeout(reject, timeout);
                    const cb = (data: IChatJoined) => {
                        if (data.conv.name === `${components.room}@${components.server}` &&
                            data.account.username === this.remoteId) {
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

    public async xmppRetryJoin(from: JID, instance: PurpleInstance) {
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

    public rejectChat(components: IChatJoinProperties) {
        const message = xml(
            "presence",
            {
                to: `${components.room}@${components.server}/${components.handle}`,
                from: `${this.remoteId}/${this.resource}`,
                type: "unavailable",
            },
        );
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
        const split = who.split("/");

        return {
            Nickname: split.length > 1 ? split[1] : split[0],
            eventName: "meh",
            who,
            account: {
                protocol_id: this.protocol.id,
                username: this.remoteId,
            },
        };
    }
}
