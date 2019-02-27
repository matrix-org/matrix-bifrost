import { IPurpleAccount, IProfileProvider } from "./purple/IPurpleAccount";
import * as _fs from "fs";
import * as path from "path";
import { PurpleProtocol } from "./purple/PurpleProtocol";
import { Logging, MatrixUser, Bridge, Intent } from "matrix-appservice-bridge";
import { Config } from "./Config";
import { Store, BifrostRemoteUser } from "./Store";
const log = Logging.get("ProfileSync");

export class ProfileSync {
    constructor(private bridge: Bridge, private config: Config, private store: Store) {

    }

    public async updateProfile(
        protocol: PurpleProtocol,
        senderId: string,
        account: IProfileProvider,
        force: boolean = false,
        senderIdToLookup?: string,
    ) {
        senderIdToLookup = senderIdToLookup ? senderIdToLookup : senderId;
        const {matrixUser, remoteUser} = await this.getOrCreateStoreUsers(protocol, senderId);
        const lastCheck = matrixUser.get("last_check");
        matrixUser.set("last_check", Date.now());
        if (!force &&
            lastCheck != null && (Date.now() - lastCheck) < this.config.profile.updateInterval) {
                return; // Don't need to check.
        }
        log.debug(
`Checking for profile updates for ${matrixUser.getId()} since their last_check time expired ${lastCheck}`);
        const remoteProfileSet:
        {
            nick: string|undefined,
            name: string,
            avatar_uri: string|undefined,
        } = {
            nick: undefined,
            name: senderId,
            avatar_uri: undefined,
        };
        let buddy;
        if ((account as IPurpleAccount).getBuddy !== undefined) {
            buddy = (account as IPurpleAccount).getBuddy(remoteUser.username);
        }
        if (buddy === undefined) {
            try {
                log.info("Fetching user info for", senderIdToLookup);
                const uinfo = await account.getUserInfo(senderIdToLookup);
                log.debug("getUserInfo got:", uinfo);
                remoteProfileSet.nick = uinfo.Nickname as string;
                if (uinfo.Avatar) {
                    remoteProfileSet.avatar_uri = uinfo.Avatar as string;
                }
                // XXX: This is dependant on the protocol.
                remoteProfileSet.name = (uinfo["Full Name"] || uinfo["User ID"] || senderId) as string;
            } catch (ex) {
                log.info("Couldn't fetch user info for ", remoteUser.username);
            }
        } else {
            remoteProfileSet.name = buddy.name;
            remoteProfileSet.nick = buddy.nick;
            remoteProfileSet.avatar_uri = buddy.icon_path;
        }

        const intent = this.bridge.getIntent(matrixUser.getId());

        if (remoteProfileSet.nick && matrixUser.get("displayname") !== remoteProfileSet.nick) {
            log.debug(`Got a nick "${remoteProfileSet.nick}", setting`);
            await intent.setDisplayName(remoteProfileSet.nick);
            matrixUser.set("displayname", remoteProfileSet.nick);
        } else if (!matrixUser.get("displayname") && remoteProfileSet.name) {
            log.debug(`Got a name "${remoteProfileSet.name}", setting`);
            // Don't ever set the name (ugly) over the nick unless we have never set it.
            // Nicks come and go depending on the libpurple cache and whether the user
            // is online (in XMPPs case at least).
            await intent.setDisplayName(remoteProfileSet.name);
            matrixUser.set("displayname", remoteProfileSet.name);
        }

        if (remoteProfileSet.avatar_uri && matrixUser.get("avatar_url") !== remoteProfileSet.avatar_uri) {
            log.debug(`Got an avatar, setting`);
            try {
                const {type, data} = await account.getAvatarBuffer(remoteProfileSet.avatar_uri, senderId);
                const mxcUrl = await intent.getClient().uploadContent(data, {
                    name: path.basename(remoteProfileSet.avatar_uri),
                    type,
                    rawResponse: false,
                    onlyContentUri: true,
                });
                await intent.setAvatarUrl(mxcUrl);
                matrixUser.set("avatar_url", remoteProfileSet.avatar_uri);
            } catch (e) {
                log.error("Failed to update avatar_url for user:", e);
            }
        }
        await this.store.setMatrixUser(matrixUser);
    }

    private async getOrCreateStoreUsers(protocol: PurpleProtocol, senderId: string)
    : Promise<{matrixUser: MatrixUser, remoteUser: BifrostRemoteUser}> {
        const userId: string = protocol.getMxIdForProtocol(
            senderId,
            this.config.bridge.domain,
            this.config.bridge.userPrefix,
        ).getId();
        let mxUser = await this.store.getMatrixUser(userId);

        let remoteUsers: BifrostRemoteUser[] | never[];
        if (mxUser != null) {
            remoteUsers = await this.store.getRemoteUsersFromMxId(userId);
        } else {
            remoteUsers = [];
            mxUser = new MatrixUser(userId);
        }

        if (remoteUsers.length === 0) {
            const {remote, matrix} = await this.store.storeUser(mxUser.getId(), protocol, senderId, "ghost");
            return {matrixUser: matrix, remoteUser: remote};
        }
        return {matrixUser: mxUser, remoteUser: remoteUsers[0]};
    }
}
