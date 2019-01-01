//import { helper, plugins, buddy, accounts, messaging, Buddy, Account, Conversation, notify } from "node-purple";
import { IChatJoinProperties, IUserInfo, IConversationEvent, IChatJoined } from "./PurpleEvents";
import { IPurpleInstance } from "./IPurpleInstance";
import { PurpleProtocol } from "./PurpleProtocol";
import { IBasicProtocolMessage } from "../MessageFormatter";

export interface IChatJoinOptions {
    identifier: string;
    label: string;
    required: boolean;
}

export interface IPurpleAccount {
    remoteId: string;
    name: string;
    isEnabled: boolean;
    connected: boolean;
    protocol: PurpleProtocol;

    findAccount();
    createNew(password?: string);
    setEnabled(enable: boolean);
    sendIM(recipient: string, body: IBasicProtocolMessage);
    sendChat(chatName: string, body: IBasicProtocolMessage);
    getBuddy(user: string): any|undefined;
    getJoinPropertyForRoom(roomName: string, key: string): string|undefined;
    setJoinPropertiesForRoom(roomName: string, props: IChatJoinProperties);
    isInRoom(roomName: string): boolean;
    joinChat(
        components: IChatJoinProperties,
        purple?: IPurpleInstance,
        timeout?: number,
        setWaiting?: boolean)
        : Promise<IConversationEvent|void>;

    rejectChat(components: IChatJoinProperties);
    getConversation(name: string): any|undefined;
    getChatParamsForProtocol(): IChatJoinOptions[];
    getUserInfo(who: string): Promise<IUserInfo>;
}
