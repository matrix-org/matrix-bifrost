import { IPurpleAccount } from "../purple/IPurpleAccount";
import { PurpleProtocol } from "../purple/PurpleProtocol";
import { FBProtocol } from "./FBInstance";

export class FBAccount implements IPurpleAccount {
    public readonly isEnabled: boolean = true;
    public connected: boolean = false;
    public protocol: PurpleProtocol = new FBProtocol();

    get name(): string { return this.remoteId; }

    constructor(
        public readonly remoteId: string,
        public readonly mxId: string) {

    }

    public findAccount() {

    }
    public createNew(password?: string);
    public setEnabled(enable: boolean);
    public sendIM(recipient: string, body: IBasicProtocolMessage);
    public sendChat(chatName: string, body: IBasicProtocolMessage);
    public getBuddy(user: string): any|undefined;
    public getJoinPropertyForRoom(roomName: string, key: string): string|undefined;
    public setJoinPropertiesForRoom(roomName: string, props: IChatJoinProperties);
    public isInRoom(roomName: string): boolean;
    public joinChat(
        components: IChatJoinProperties,
        purple?: IPurpleInstance,
        timeout?: number,
        setWaiting?: boolean)
        : Promise<IConversationEvent|void>;

    public rejectChat(components: IChatJoinProperties);
    public getConversation(name: string): any|undefined;
    public getChatParamsForProtocol(): IChatJoinOptions[];
}
