import { PurpleProtocol } from "./PurpleInstance";
import { PurpleAccount } from "./PurpleAccount";
import { Event } from "node-purple";

export interface IConfigArgs {
    enableDebug: boolean;
}

export interface IPurpleInstance {
    start(config: IConfigArgs): Promise<void>;
    getAccount(username: string, protocolId: string): PurpleAccount|null;
    getProtocol(id: string);
    getProtocols(): PurpleProtocol[];
    findProtocol(nameOrId: string): PurpleProtocol|undefined;
    on(name: string, cb: (ev: Event) => void);
}
