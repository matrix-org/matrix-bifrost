import { PurpleProtocol } from "./PurpleInstance";
import { PurpleAccount } from "./PurpleAccount";
import { Event, Conversation } from "node-purple";
import { IEventBody, IAccountEvent } from "./PurpleEvents";

export interface IConfigArgs {
    pluginDir: string;
    enableDebug: boolean;
}

export interface IPurpleInstance {
    getBuddyFromChat(conv: Conversation, buddy: string): any;
    start(config: IConfigArgs): Promise<void>;
    getAccount(username: string, protocolId: string): PurpleAccount|null;
    getProtocol(id: string);
    getProtocols(): PurpleProtocol[];
    findProtocol(nameOrId: string): PurpleProtocol|undefined;
    getNickForChat(conv: Conversation): string;
    on(name: string, cb: (ev: IEventBody) => void);
    on(name: "account-connection-error"|"account-signed-on", cb: (ev: IAccountEvent) => void);
}
