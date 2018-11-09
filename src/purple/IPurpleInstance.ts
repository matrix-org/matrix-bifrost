import { PurpleProtocol } from "./PurpleInstance";
import { PurpleAccount } from "./PurpleAccount";

export interface IPurpleInstance {
    start(config: any): Promise<void>
    getAccount(username: string, protocolId: string): PurpleAccount|null;
    getProtocol(id: string);
    getProtocols(): PurpleProtocol[];
    on(name: string, cb : (ev: any) =>void);
}
