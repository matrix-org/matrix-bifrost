import { IChatJoinProperties, IUserInfo, IConversationEvent } from "./Events";
import { IBifrostInstance } from "./Instance";
import { BifrostProtocol } from "./Protocol";
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

export type IAccountExtraConfig = Record<string, string|number|boolean>;
export interface IBifrostAccount extends IProfileProvider {
    remoteId: string;
    name: string;
    isEnabled: boolean;
    connected: boolean;
    protocol: BifrostProtocol;

    findAccount();
    createNew(password?: string, extraConfig?: IAccountExtraConfig);
    setEnabled(enable: boolean);
    sendIM(recipient: string, body: IBasicProtocolMessage);
    sendIMTyping(recipient: string, isTyping: boolean);
    sendChat(chatName: string, body: IBasicProtocolMessage);
    getBuddy(user: string): any|undefined;
    getJoinPropertyForRoom(roomName: string, key: string): string|undefined;
    setJoinPropertiesForRoom(roomName: string, props: IChatJoinProperties);
    isInRoom(roomName: string): boolean;
    joinChat(
        components: IChatJoinProperties,
        purple?: IBifrostInstance,
        timeout?: number,
        setWaiting?: boolean)
        : Promise<IConversationEvent|void>;

    rejectChat(components: IChatJoinProperties);
    getConversation(name: string): any|undefined;
    getChatParamsForProtocol(): IChatJoinOptions[];
    setStatus(statusId: string, active: boolean);
}
