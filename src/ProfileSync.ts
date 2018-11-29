import { MatrixUser, RemoteUser, Bridge, Intent} from "matrix-appservice-bridge";
import { PurpleAccount } from "./purple/PurpleAccount";
import * as _fs from "fs";
import * as path from "path";
import { PurpleProtocol } from "./purple/PurpleInstance";
import { Util } from "./Util";
import { Logging } from "matrix-appservice-bridge";
import { Config } from "./Config";
const log = Logging.get("ProfileSync");

const fs = _fs.promises;

if (fs === undefined) {
    log.error(
`Warning: Your version of node doesn't support fs.promises.
(See: https://nodejs.org/api/fs.html#fs_fs_promises_api)

We don't yet support non-fs-promise versions of node.`,
);
    process.exit(1);
}

export class ProfileSync {
    constructor(private bridge: Bridge, private config: Config) {

    }

    public async updateProfile(
        protocol: PurpleProtocol,
        senderId: string,
        account: PurpleAccount,
        force: boolean = false,
        senderIdToLookup?: string
    ) {
        senderIdToLookup = senderIdToLookup ? senderIdToLookup : senderId;
        const store = this.bridge.getUserStore();
        const [matrixUser, remoteUser] = await this.getOrCreateStoreUsers(protocol, senderId);
        const lastCheck = matrixUser.get("last_check");
        matrixUser.set("last_check", Date.now());
        if (!force &&
            lastCheck != null && (Date.now() - lastCheck) < this.config.profile.updateInterval) {
                return; // Don't need to check.
        }
        const remoteProfileSet:
        {
            nick: string|undefined,
            name: string,
            icon_path: string|undefined
        } = {
            nick: undefined,
            name: senderId,
            icon_path: undefined,
        };
        const buddy = account.getBuddy(remoteUser.get("username"));
        if (buddy === undefined) {
            try {
                log.info("Fetching user info for", senderIdToLookup);
                const uinfo = await account.getUserInfo(senderIdToLookup);
                log.debug("getUserInfo got:", uinfo);
                remoteProfileSet.nick = uinfo.Nickname as string;
                remoteProfileSet.name = uinfo["Full Name"] as string;
            } catch (ex) {
                log.info("Couldn't fetch user info for ", remoteUser.get("username"));
            }
        } else {
            remoteProfileSet.name = buddy.name;
            remoteProfileSet.nick = buddy.nick;
            remoteProfileSet.icon_path = buddy.icon_path;
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

        if (remoteProfileSet.icon_path && matrixUser.get("avatar_url") !== remoteProfileSet.icon_path) {
            log.debug(`Got an avatar, setting`);
            try {
                const file = await fs.readFile(remoteProfileSet.icon_path);
                const mxcUrl = await intent.getClient().uploadContent(file, {
                    name: path.basename(remoteProfileSet.icon_path),
                    type: "image/jpeg", // XXX: This is what pidgin usually outputs
                    rawResponse: false,
                    onlyContentUri: true,
                });
                await intent.setAvatarUrl(mxcUrl);
                matrixUser.set("avatar_url", remoteProfileSet.icon_path);
            } catch (e) {
                log.error("Failed to update avatar_url for user:", e);
            }
        }
        await store.setMatrixUser(matrixUser);
    }

    private handlePurpleProfileChange() {

    }

    private async getOrCreateStoreUsers(protocol: PurpleProtocol, senderId: string): Promise<[MatrixUser, RemoteUser]> {
        const store = this.bridge.getUserStore();
        const tempMxUser = Util.getMxIdForProtocol(
            protocol, senderId,
            this.config.bridge.domain,
            this.config.bridge.userPrefix,
        );
        let mxUser = await store.getMatrixUser(tempMxUser.getId());
        if (!mxUser) {
            mxUser = tempMxUser;
            store.setMatrixUser(mxUser);
        }
        const remoteUsers = await store.getRemoteUsersFromMatrixId(tempMxUser.getId());
        let rmUser;
        if (remoteUsers.length === 0) {
            rmUser = new RemoteUser(Util.createRemoteId(protocol.id, senderId));
            rmUser.set("protocolId", protocol.id);
            rmUser.set("username", senderId);
            await store.linkUsers(mxUser, rmUser);
        } else {
            rmUser = remoteUsers[0];
        }
        return [mxUser, rmUser];
    }
}
