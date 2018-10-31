/**
 * An interface for storing account data inside the userstore.
 */

import { helper, plugins, accounts } from "node-purple";
import { PurpleProtocol } from "./PurpleInstance";

export class PurpleAccount {
    constructor(private username: string,private protocol: PurpleProtocol) {

    }

    createNew() {
        accounts.new(this.username, this.protocol.id)
    }
}
