/**
 * A collection of interfaces that may be emitted by PurpleInterface
 */

import { Account, Conversation} from "node-purple";
import { IPurpleAccount } from "./IPurpleAccount";

export interface IChatJoinProperties {[key: string]: string; }

export interface IEventBody {
    eventName: string;
}

export interface IAccountMinimal {
    protocol_id: string,
    username: string,
}

export interface IConversationMinimal {
    name: string;
}

export interface IAccountEvent extends IEventBody {
    account: Account|IAccountMinimal;
}


export interface IConversationEvent extends IAccountEvent {
    conv: Conversation | IConversationMinimal;
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
    purpleAccount: IPurpleAccount;
    join_properties: IChatJoinProperties;
}

export interface IUserInfo extends IAccountEvent {
    [key: string]: string|Account;
    account: Account;
    who: string;
}
