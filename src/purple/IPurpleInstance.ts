import { PurpleProtocol } from "./PurpleInstance";
import { PurpleAccount } from "./PurpleAccount";

export interface IPurpleInstance {
    start(config: any): Promise<void>
    getAccount(username: string, protocolId: string): PurpleAccount;
    getProtocol(id: string);
    getProtocols(): PurpleProtocol[];
    on(name: string, cb : () =>void);
}