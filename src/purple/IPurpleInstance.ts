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
} from "./PurpleEvents";
import { IConfigPurple } from "../Config";
import { EventEmitter } from "events";

export interface IPCMessageIncoming {
    i: number;
    module: string;
    function: string;
    args: any[];
}

export interface IPCMessageResult {
    i: number;
    module: string;
    function: string;
    thrown: string|null;
    result: any;
}

export interface IPurpleInstance extends EventEmitter {
    createPurpleAccount(username, protocol: PurpleProtocol): IPurpleAccount;
    getBuddyFromChat(conv: any, buddy: string): any;
    start(config: IConfigPurple): Promise<void>;
    getAccount(username: string, protocolId: string): IPurpleAccount|null;
    getProtocol(id: string): PurpleProtocol|undefined;
    getProtocols(): PurpleProtocol[];
    findProtocol(nameOrId: string): PurpleProtocol|undefined;
    getNickForChat(conv: any): string;
    on(name: string, cb: (ev: IEventBody) => void);
    on(name: "account-connection-error"|"account-signed-on"|"account-signed-off", cb: (ev: IAccountEvent) => void);
    on(name: "chat-joined", cb: (ev: IConversationEvent) => void);
    on(name: "chat-joined-new", cb: (ev: IChatJoined) => void);
    on(name: "chat-user-joined"|"chat-user-left", cb: (ev: IUserStateChanged) => void);
    on(name: "chat-topic", cb: (ev: IChatStringState) => void);
    on(name: "chat-invite", cb: (ev: IChatInvite) => void);
    on(name: "received-im-msg"|"received-chat-msg", cb: (ev: IReceivedImMsg) => void);
    on(name: "chat-typing"|"im-typing", cb: (ev: IChatTyping) => void);

    needsDedupe(): boolean;
    needsAccountLock(): boolean;
    // getMXIDForSender(sender: string, domain: string, prefix: string, protocol: Protocol);
    // parseMxIdForSender(mxid: string): {protocol: PurpleProtocol, sender: string};
}
