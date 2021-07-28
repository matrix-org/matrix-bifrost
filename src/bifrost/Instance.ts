import { BifrostProtocol } from "./Protocol";
import { IBifrostAccount } from "./Account";
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
    IGatewayPublicRoomsQuery,
    IChatJoinProperties,
} from "./Events";
import { EventEmitter } from "events";
import { IGateway } from "./Gateway";

export interface IBifrostInstance extends EventEmitter {
    gateway: IGateway|null;
    createBifrostAccount(username, protocol: BifrostProtocol): IBifrostAccount;
    getBuddyFromChat(conv: any, buddy: string): any;
    start(): Promise<void>;
    close(): Promise<void>;
    getAccount(username: string, protocolId: string, mxid?: string): IBifrostAccount|null;
    getProtocol(id: string): BifrostProtocol|undefined;
    getProtocols(): BifrostProtocol[];
    findProtocol(nameOrId: string): BifrostProtocol|undefined;
    getNickForChat(conv: any): string;
    getUsernameFromMxid(mxid: string, prefix: string): {username: string, protocol: BifrostProtocol};
    checkGroupExists(properties: IChatJoinProperties, protocol: BifrostProtocol): Promise<boolean>;
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
    on(name: "gateway-publicrooms", cb: (ev: IGatewayPublicRoomsQuery) => void);
    on(name: "chat-typing"|"im-typing", cb: (ev: IChatTyping) => void);
    on(name: "received-im-msg"|"received-chat-msg", cb: (ev: IReceivedImMsg) => void);
    on(name: "store-remote-user", cb: (ev: IStoreRemoteUser) => void);
    on(name: "read-receipt", cb: (ev: IChatReadReceipt) => void);
    eventAck(eventName: string, data: IEventBody);

    needsDedupe(): boolean;
    needsAccountLock(): boolean;
    usingSingleProtocol(): string|undefined;
    // getMXIDForSender(sender: string, domain: string, prefix: string, protocol: Protocol);
    // parseMxIdForSender(mxid: string): {protocol: BifrostProtocol, sender: string};
}
