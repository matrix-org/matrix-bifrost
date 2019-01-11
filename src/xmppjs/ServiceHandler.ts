import { Element, x } from "@xmpp/xml";
import { XmppJsInstance } from "./XJSInstance";
import { jid } from "@xmpp/jid";
import { Logging } from "matrix-appservice-bridge";
import * as request from "request-promise-native";

const log = Logging.get("ServiceHandler");

let version = "Unknown";
try {
    // tslint:disable-next-line: no-var-requires
    version = require("../../package.json").version;
} catch (ex) {
    // This might not exist.
}

const MAX_AVATARS = 1024;

export class ServiceHandler {
    private avatarCache: Map<string, {data: Buffer, type: string}>;
    constructor(private xmpp: XmppJsInstance) {
        this.avatarCache = new Map();
    }

    public handleIq(stanza: Element, intent: any) {
        if (!stanza.getAttr("get")) {
            return;
        }
        const id = stanza.getAttr("id");
        const from = stanza.getAttr("from");
        const to = stanza.getAttr("to");

        if (stanza.getChildByAttr("xmlns", "jabber:iq:version")) {
            this.handleVersionRequest(from, to, id);
            return;
        }

        if (stanza.getChildByAttr("xmlns", "vcard-temp")) {
            this.handleVcard(from, id, intent);
            return;
        }

    }

    private handleVersionRequest(to: string, from: string, id: string) {
        this.xmpp.xmppWriteToStream(
            x("iq", {
                type: "result",
                to,
                from,
                id,
            }, x("query", {
                    xmlns: "jabber:iq:version",
                },
                [
                    x("name", undefined, "matrix-bifrost"),
                    x("version", undefined, version),
                ],
            ),
        ));
    }

    private async getThumbnailBuffer(avatarUrl: string, intent: any): Promise<{data: Buffer, type: string}|undefined> {
        let avatar = this.avatarCache.get(avatarUrl);
        if (avatar) {
            return avatar;
        }
        const thumbUrl = intent.getClient().mxcUrlToHttp(
            avatarUrl, 256, 256, "scale", false,
        );
        if (!thumbUrl) {
            return undefined;
        }

        const file = (await request.get(thumbUrl, {resolveWithFullResponse: true}).promise())!;
        avatar = {
            data: file.buffer,
            type: file.headers["content-type"],
        };
        this.avatarCache.set(avatarUrl, avatar);
        if (this.avatarCache.size > MAX_AVATARS) {
            this.avatarCache.delete(this.avatarCache.keys()[0]);
        }
        return avatar;
    }

    private async handleVcard(to: string, id: string, intent: any) {
        // Fetch mxid.
        const account = this.xmpp.getAccountForJid(jid(to));
        if (!account) {
            log.warn("Account fetch failed for ", to);
            return;
        }
        let profile: {displayname?: string, avatar_url?: string};
        try {
            profile = await intent.getProfileInfo(account.mxId, null);
        } catch (ex) {
            log.warn("Profile fetch failed for ", account.mxId, ex);
            return;
        }

        const vCard: Element[] = [
            x("URL", undefined, `https://matrix.to/${account.mxId}`),
        ];

        if (profile.displayname) {
            vCard.push(x("FN", undefined, profile.displayname));
        }

        if (profile.avatar_url) {
            try {
                const res = await this.getThumbnailBuffer(profile.avatar_url, intent);
                if (res) {
                    vCard.push(
                        x("PHOTO", undefined, [
                            x("BINVAL", undefined, res.data.toString("base64")),
                            x("TYPE", undefined, res.type),
                        ]),
                    );
                }
            } catch (ex) {
                log.warn("Could not fetch avatar for ", account.mxId, ex);
            }
        }

        this.xmpp.xmppWriteToStream(
            x("iq", {
                type: "result",
                to,
                id,
            }, x("vCard", {
                    xmlns: "vcard-temp",
                },
                vCard,
            ),
        ));
    }
}
