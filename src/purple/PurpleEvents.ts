/**
 * A collection of interfaces that may be emitted by PurpleInterface
 */

 import { Account } from "node-purple";


 //received-im-msg
 export interface IReceivedImMsg {
    sender: string;
    message: string;
    account: Account;
 }
