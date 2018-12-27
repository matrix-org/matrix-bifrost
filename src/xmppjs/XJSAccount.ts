import { IChatJoinProperties, IUserInfo, IConversationEvent, IChatJoined } from "../purple/PurpleEvents";
import { XmppJsInstance, XMPP_PROTOCOL } from "./XJSInstance";
import { IPurpleAccount, IChatJoinOptions } from "../purple/IPurpleAccount";
import { IPurpleInstance } from "../purple/IPurpleInstance";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { xml, jid } from "@xmpp/component";

const IDPREFIX = "pbridge";

export class XmppJsAccount implements IPurpleAccount {
    private rooms: Set<string>;
    public readonly waitingToJoin: Set<string>;
    // remoteId == jid
    constructor(public readonly remoteId: string, private xmpp: XmppJsInstance) {
        this.rooms = new Set();
        this.waitingToJoin = new Set();
    }

    get _waitingJoinRoomProps(): IChatJoinProperties|undefined {
        return undefined;
    }
    
    get name(): string {
        return this.remoteId;
    }

    get protocol(): PurpleProtocol {
        return XMPP_PROTOCOL;
    }

    public readonly isEnabled = true;

    public readonly connected = true;

    public findAccount() {
        // TODO: What do we actually need to find.
    }

    public createNew(password?: string) {
        throw Error("Xmpp.js doesn't support registering accounts");
    }

    public setEnabled(enable: boolean) {
        throw Error("Xmpp.js doesn't allow you to enable or disable accounts")
    }

    public sendIM(recipient: string, body: string) {
        const id = IDPREFIX + Date.now().toString();
        const message = xml(
            'message',
            {
                to: recipient,
                id,
                from: this.remoteId,
            },
            xml('body', null, body),
        );
        this.xmpp.xmppAddSentMessage(id);
        this.xmpp.xmppWriteToStream(message);
    }

    public sendChat(chatName: string, body: string) {
        const id = IDPREFIX + Date.now().toString();
        const message = xml(
            'message',
            {
                to: chatName,
                id,
                from: this.remoteId,
                type: 'groupchat',
            },
            xml('body', null, body),
        );
        this.xmpp.xmppAddSentMessage(id);
        this.xmpp.xmppWriteToStream(message);
    }

    public getBuddy(user: string): any|undefined {
        //TODO: Not implemented
        return;
    }

    public getJoinPropertyForRoom(roomName: string, key: string): string|undefined {
        //TODO: Not implemented
        return;
    }

    public setJoinPropertiesForRoom(roomName: string, props: IChatJoinProperties) {
        //TODO: Not implemented
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
                'presence',
                {
                    to: `${components.room}@${components.server}/${components.handle}`,
                    from: this.remoteId
                },
            );
            if (setWaiting) {
                this.waitingToJoin.add(`${components.room}@${components.server}`);
            }
            let p: Promise<IChatJoined>|undefined = undefined;
            if (instance) {
                p = new Promise(() => (resolve, reject) => {
                    const timer = setTimeout(reject, timeout);
                    const cb = (data: IChatJoined) => {
                        if (data.conv.name === `${components.room}@${components.server}`) {
                            clearTimeout(timer);
                            this.xmpp.removeListener("chat-joined", cb);
                            resolve(data);
                        }
                    };
                    this.xmpp.addListener("chat-joined", cb);
                });
            }
            await this.xmpp.xmppWriteToStream(message);
            return p;
        }

    public rejectChat(components: IChatJoinProperties) {
        throw Error("Rejecting not implemented");
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
            }
        ];
    }

    public async getUserInfo(who: string): Promise<IUserInfo> {
        const split = who.split("/");
        return {
            Nickname: split.length > 1 ? split[1]: split[0],
            eventName: "meh",
            who,
            account: {
                protocol_id: this.protocol.id,
                username: this.remoteId
            }
        }
    }
}
