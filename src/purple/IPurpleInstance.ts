import { PurpleProtocol } from "./PurpleProtocol";
import { IPurpleAccount } from "./IPurpleAccount";
import { IEventBody,
    IAccountEvent,
    IChatJoined,
    IConversationEvent,
    IUserStateChanged,
    IChatStringState,
    IChatInvite,
    IReceivedImMsg,
    IChatTyping,
    IGatewayJoin,
    IGatewayRoomQuery,
    IStoreRemoteUser,
    IChatReadReceipt,
} from "./PurpleEvents";
import { EventEmitter } from "events";
import { IGateway } from "./IGateway";

export interface IPurpleInstance extends EventEmitter {
    gateway: IGateway|null;
    createPurpleAccount(username, protocol: PurpleProtocol): IPurpleAccount;
    getBuddyFromChat(conv: any, buddy: string): any;
    start(): Promise<void>;
    getAccount(username: string, protocolId: string, mxid?: string): IPurpleAccount|null;
    getProtocol(id: string): PurpleProtocol|undefined;
    getProtocols(): PurpleProtocol[];
    findProtocol(nameOrId: string): PurpleProtocol|undefined;
    getNickForChat(conv: any): string;
    getUsernameFromMxid(mxid: string, prefix: string): {username: string, protocol: PurpleProtocol};
    on(name: string, cb: (ev: IEventBody) => void);
    on(
        name: "account-connection-error"|"account-signed-on"|"account-signed-off",
        cb: (ev: IAccountEvent) => void,
    );
    on(name: "chat-joined", cb: (ev: IConversationEvent) => void);
    on(name: "chat-joined-new", cb: (ev: IChatJoined) => void);
    on(name: "chat-user-joined"|"chat-user-left"|"chat-user-kick"|"chat-kick", cb: (ev: IUserStateChanged) => void);
    on(name: "chat-topic", cb: (ev: IChatStringState) => void);
    on(name: "chat-invite", cb: (ev: IChatInvite) => void);
    on(name: "gateway-queryroom", cb: (ev: IGatewayRoomQuery) => void);
    on(name: "gateway-joinroom", cb: (ev: IGatewayJoin) => void);
    on(name: "chat-typing"|"im-typing", cb: (ev: IChatTyping) => void);
    on(name: "received-im-msg"|"received-chat-msg", cb: (ev: IReceivedImMsg) => void);
    on(name: "store-remote-user", cb: (ev: IStoreRemoteUser) => void);
    on(name: "read-receipt", cb: (ev: IChatReadReceipt) => void);
    eventAck(eventName: string, data: IEventBody);

    needsDedupe(): boolean;
    needsAccountLock(): boolean;
    // getMXIDForSender(sender: string, domain: string, prefix: string, protocol: Protocol);
    // parseMxIdForSender(mxid: string): {protocol: PurpleProtocol, sender: string};
}
