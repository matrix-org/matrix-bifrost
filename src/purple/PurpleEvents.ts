/**
 * A collection of interfaces that may be emitted by PurpleInterface
 */

 //received-im-msg
 export interface IReceivedImMsg {
    sender: string;
    message: string;
    account: any;
 }