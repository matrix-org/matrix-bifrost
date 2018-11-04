import { PurpleAccount } from "./purple/PurpleAccount";

/**
 * The buddylist in purple will be reflected by a set of commands to
 * manipulate the buddylist, and a room whose members reflect a user's 
 * buddys.
 */

 class BuddyList {
    constructor(private account: PurpleAccount, private mxid: string) {
        
    }
 }