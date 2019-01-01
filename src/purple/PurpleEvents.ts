/**
 * A collection of interfaces that may be emitted by PurpleInterface
 */

import { IPurpleAccount } from "./IPurpleAccount";
import { IBasicProtocolMessage } from "../MessageFormatter";

export interface IChatJoinProperties {[key: string]: string; }

export interface IEventBody {
    eventName: string;
}

export interface IAccountMinimal {
    protocol_id: string;
    username: string;
}

export interface IConversationMinimal {
    name: string;
}

export interface IAccountEvent extends IEventBody {
    account: any|IAccountMinimal;
}

export interface IConversationEvent extends IAccountEvent {
    conv: any | IConversationMinimal;
}

// received-im-msg
export interface IReceivedImMsg extends IConversationEvent {
    sender: string;
    message: IBasicProtocolMessage;
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
    [key: string]: string|IAccountMinimal;
    who: string;
}
