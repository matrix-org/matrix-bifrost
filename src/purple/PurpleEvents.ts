/**
 * A collection of interfaces that may be emitted by PurpleInterface
 */

import { Account, Conversation} from "node-purple";

export interface IChatJoinProperties {[key: string]: string; }

export interface IEventBody {
    eventName: string;
}

export interface IAccountEvent extends IEventBody {
    account: Account;
}


export interface IConversationEvent extends IAccountEvent {
    conv: Conversation;
}

 // received-im-msg
export interface IReceivedImMsg extends IConversationEvent {
    sender: string;
    message: string;
}

export interface IChatInvite extends IAccountEvent {
    sender: string;
    message: string;
    room_name: string;
    join_properties: IChatJoinProperties;
}

export interface IChatJoined extends IConversationEvent {
    purpleAccount: PurpleAccount;
    join_properties: IChatJoinProperties;
}

export interface IUserInfo extends IAccountEvent {
    [key: string]: string|Account;
    account: Account;
    who: string;
}
