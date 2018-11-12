/**
 * An interface for storing account data inside the userstore.
 */

import { helper, plugins, buddy, accounts, messaging, Buddy, Account } from "node-purple";
import { PurpleProtocol } from "./PurpleInstance";

export class PurpleAccount {
    private acctData: Account | undefined;
    private enabled: boolean;
    constructor(private username: string, private _protocol: PurpleProtocol) {
        this.enabled = false;
    }
    get name(): string { return this.acctData!.username };

    get protocol() : PurpleProtocol { return this._protocol };

    get isEnabled(): boolean { return this.enabled };

    get connected(): boolean {
        if (!this.acctData) {
            return false;
        }
        return accounts.is_connected(this.acctData.handle);
    }

    findAccount() {
        const data = accounts.find(this.username, this._protocol.id);
        if (!data) {
            throw new Error("Account not found");
        }
        this.acctData = data;
        this.enabled = accounts.get_enabled(this.acctData.handle);
    }

    createNew() {
        accounts.new(this.username, this._protocol.id);
    }

    setEnabled(enable: boolean) {
        if (!this.acctData!.handle) {
            throw Error("No account is binded to this instance. Call findAccount()");
        }
        accounts.set_enabled(this.acctData!.handle, enable);
    }

    sendIM(recipient: string, body: string) {
        if (!this.acctData!.handle) {
            throw Error("No account is binded to this instance. Call findAccount()");
        }
        messaging.sendIM(this.acctData!.handle, recipient, body);
    }

    getBuddy(user: string): Buddy {
        if (!this.acctData!.handle) {
            throw Error("No account is binded to this instance. Call findAccount()");
        }
        return buddy.find(this.acctData!.handle, user);
    }

    joinChat(components: ChatJoinProperties) {
        messaging.joinChat(this.handle, components);
    }

    rejectChat(components: ChatJoinProperties) {
        messaging.rejectChat(this.handle, components);
    }


    // connect() {
    //     accounts.connect(this.username, this.protocol.id);
    // }
}
