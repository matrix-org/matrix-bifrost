import { IAccountErrorEvent, IAccountEvent } from "./bifrost/Events";
import { IBifrostInstance } from "./bifrost/Instance";
import { Bridge, Logging } from "matrix-appservice-bridge";
import { IStore } from "./store/Store";
import { Config } from "./Config";

const log = Logging.get("AccountHandler");
/**
 * Class to manage account settings, including commands sent from Matrix users
 */
export class AccountHandler {

    constructor(private instance: IBifrostInstance,
        private store: IStore,
        private bridge: Bridge,
        private config: Config) {
        instance.on("account-signed-on", (ev: IAccountEvent) => {
            this.onAccountSignedOn(ev);
        });
        instance.on("account-connection-error", (ev: IAccountErrorEvent) => {
            this.onAccountConnectionError(ev);
        });
        instance.on("account-signed-off", (ev: IAccountEvent) => {
            this.onAccountSignedOff(ev);
        });
    }

    private async getInstanceEventContext(ev: IAccountEvent)  {
        const account = this.instance.getAccount(ev.account.username, ev.account.protocol_id);
        const user = await this.store.getMatrixUserForAccount(ev.account);
        const protocol = this.instance.getProtocol(ev.account.protocol_id);
        if (!account) {
            log.warn("Account not registered with Bifrost, ignoring");
            return;
        }
        if (!user) {
            log.warn(`Account registered with Bifrost, but not assigned to a user!!`);
            return;
        }
        const adminRoom = await this.store.getAdminRoom(user.getId());
        return {
            account,
            user,
            protocol,
            adminRoom,
        }
    }

    private async onAccountSignedOn(ev: IAccountEvent) {
        log.info(`${ev.account.protocol_id}://${ev.account.username} signed on`);
        const {account, adminRoom, protocol} = await this.getInstanceEventContext(ev);
        account.setStatus('available', true);
        if (!this.config.purple.sendConnectionNotices) {
            return;
        }
        await this.bridge.getIntent().sendMessage(adminRoom.roomId, {
            msgtype: "m.notice",
            body: `🟢 ${ev.account.username} (${protocol.name}) has signed on`
        });
    }

    private async onAccountConnectionError(ev: IAccountErrorEvent) {
        log.warn(`${ev.account.protocol_id}://${ev.account.username} had a connection error`, ev);
        if (!this.config.purple.sendConnectionNotices) {
            return;
        }
        const {protocol, adminRoom} = await this.getInstanceEventContext(ev);
        await this.bridge.getIntent().sendMessage(adminRoom.roomId, {
            msgtype: "m.notice",
            body: `⚠️ ${ev.account.username} (${protocol.name}) had a connection error: ${ev.description}`
        });
    }

    private async onAccountSignedOff(ev: IAccountEvent) {
        log.info(`${ev.account.protocol_id}://${ev.account.username} signed off.`);
        const {protocol, adminRoom} = await this.getInstanceEventContext(ev);
        if (!this.config.purple.sendConnectionNotices) {
            return;
        }
        await this.bridge.getIntent().sendMessage(adminRoom.roomId, {
            msgtype: "m.notice",
            body: `🔴 ${ev.account.username} (${protocol.name}) has signed off `
        });
    }
}