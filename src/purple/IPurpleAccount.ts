import { IChatJoinProperties, IUserInfo, IConversationEvent, IChatJoined } from "./PurpleEvents";
import { IPurpleInstance } from "./IPurpleInstance";
import { PurpleProtocol } from "./PurpleProtocol";
import { IBasicProtocolMessage } from "../MessageFormatter";

export interface IChatJoinOptions {
    identifier: string;
    label: string;
    required: boolean;
}

export interface IProfileProvider {
    getUserInfo(who: string): Promise<IUserInfo>;
    getAvatarBuffer(uri: string, senderId: string): Promise<{type: string, data: Buffer}>;
}

export interface IPurpleAccount extends IProfileProvider {
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
}
