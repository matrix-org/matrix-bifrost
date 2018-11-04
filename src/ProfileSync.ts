import { MatrixUser, RemoteUser, Bridge, Intent} from "matrix-appservice-bridge";
import { PurpleAccount } from "./purple/PurpleAccount";
import * as _fs from "fs";
import * as path from "path";


const log = require("matrix-appservice-bridge").Logging.get("ProfileSync");

const fs = _fs.promises;

if (fs === undefined) {
    log.error(
`Warning: Your version of node doesn't support fs.promises.
(See: https://nodejs.org/api/fs.html#fs_fs_promises_api)

We don't yet support non-fs-promise versions of node.`
);
    process.exit(1);
}


const CHECK_PROFILE_INTERVAL_MS = 60 * 1000 * 15;

export class ProfileSync {
    constructor(private bridge: Bridge) {

    }

    private handlePurpleProfileChange() {

    }

    public async getOrCreateStoreUsers() : Promise<[MatrixUser, RemoteUser]> {
        const store = this.bridge.getUserStore();
        cons 
    }

    public async updateProfile(localpart: string, account: PurpleAccount, force: boolean = false) {
        const store = this.bridge.getUserStore();
        const [matrixUser, remoteUser] = await this.getOrCreateStoreUsers();

        const lastUpdate = matrixUser.get("last_update");
        if (!force && 
            lastUpdate != null && (Date.now() - lastUpdate) < CHECK_PROFILE_INTERVAL_MS)
            {
                return; // Don't need to check.
        }
        const buddy = account.getBuddy(remoteUser.getId());
        if (buddy === undefined) {
            log.warn(`${remoteUser.getId()} was not found in ${account.name}'s buddy list`);
            return;
        }

        const intent = this.bridge.getIntent(matrixUser.getId());
        
        if (buddy.nick && matrixUser.get("displayname") !== buddy.nick)
        {
            await intent.setDisplayName(buddy.nick);
            matrixUser.set("displayname", buddy.nick);
        } else if (matrixUser.get("displayname") === null) {
            // Don't ever set the name (ugly) over the nick unless we have never set it.
            // Nicks come and go depending on the libpurple cache and whether the user
            // is online (in XMPPs case at least).
            await intent.setDisplayName(buddy.name);
            matrixUser.set("displayname", buddy.name);
        }

        if (buddy.icon_path && matrixUser.get("avatar_url") !== buddy.icon_path) {
            try {
                const file = await fs.readFile(buddy.icon_path);
                const mxcUrl = await intent.getClient().uploadContent(file, {
                    name: path.basename(buddy.icon_path),
                    type: "image/jpeg", // XXX: This is what pidgin usually outputs
                    rawResponse: false,
                    onlyContentUri: true
                });
                await intent.setAvatarUrl(mxcUrl);
                matrixUser.set("avatar_url", buddy.icon_path);
            } catch (e) {
                log.error("Failed to update avatar_url for user:",e);
            }
        }
    
        matrixUser.set("last_update", Date.now());
        await store.setMatrixUser(matrixUser);
    }
}