/**
 * A collection of interfaces that may be emitted by PurpleInterface
 */

 import { Account, Conversation} from "node-purple";

export type ChatJoinProperties = {[key: string]: string};

export interface IAccountEvent {
    account: Account;
}

 //received-im-msg
export interface IReceivedImMsg extends IAccountEvent{
    sender: string;
    message: string;
    conv: Conversation;
}

export interface IRecievedChatMsg extends IReceivedImMsg {
    
}

export interface IChatInvite extends IAccountEvent {
    sender: string;
    message: string;
    room_name: string;
    join_properties: ChatJoinProperties;
}
