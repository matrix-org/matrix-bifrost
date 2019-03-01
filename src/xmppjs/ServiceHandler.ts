import { Element, x } from "@xmpp/xml";
import { XmppJsInstance } from "./XJSInstance";
import { jid, JID } from "@xmpp/jid";
import { Logging } from "matrix-appservice-bridge";
import * as request from "request-promise-native";
import { IGatewayRoom } from "../GatewayHandler";
import { IGatewayRoomQuery, IGatewayPublicRoomsQuery } from "../purple/PurpleEvents";
import { StzaIqDiscoInfo } from "./Stanzas";
import { IPublicRoom } from "../MatrixTypes";

const log = Logging.get("ServiceHandler");

let version = "Unknown";
try {
    // tslint:disable-next-line: no-var-requires
    version = require("../../../package.json").version;
} catch (ex) {
    // This might not exist.
}

const MAX_AVATARS = 1024;

export class ServiceHandler {
    private avatarCache: Map<string, {data: Buffer, type: string}>;
    private existingAliases: Map<string, string>; /* alias -> room_id */
    private discoInfo: StzaIqDiscoInfo;
    constructor(private xmpp: XmppJsInstance) {
        this.avatarCache = new Map();
        this.existingAliases = new Map();
        this.discoInfo = new StzaIqDiscoInfo("", "", "");
        this.discoInfo.feature.add("http://jabber.org/protocol/disco#info");
        // this.discoInfo.feature.add("http://jabber.org/protocol/disco#items");
        this.discoInfo.feature.add("http://jabber.org/protocol/protocol/muc");
        this.discoInfo.feature.add("jabber:iq:version");
        this.discoInfo.feature.add("jabber:iq:search");
    }

    public parseAliasFromJID(to: JID): string|null {
        const aliasRaw = /#(.+)#(.+)/g.exec(to.local);
        if (!aliasRaw || aliasRaw.length < 3) {
            return null;
        }
        return `#${aliasRaw[1]}:${aliasRaw[2]}`;
    }

    public async handleIq(stanza: Element, intent: any): Promise<void> {
        const id = stanza.getAttr("id");
        const from = stanza.getAttr("from");
        const to = stanza.getAttr("to");

        log.info("Handling iq request");

        if (stanza.getChildByAttr("xmlns", "jabber:iq:version")) {
            return this.handleVersionRequest(from, to, id);
        }

        // Only respond to this if it has no local part.
        const local = jid(to).local;
        if (stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/disco#info") && !local) {
            return this.handleDiscoInfo(from, to, id);
        }

        if (stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/disco#items")) {
            // return this.handleDiscoItems(from, to, id);
        }

        if (stanza.getChildByAttr("xmlns", "vcard-temp")) {
            return this.handleVcard(from, to, id, intent);
        }

        if (stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/disco#info") && this.xmpp.gateway && local) {
             return this.handleRoomDiscovery(to, from, id);
        }

        return this.xmpp.xmppWriteToStream(x("iq", {
            type: "error",
            from: to,
            to: from,
            id,
        }, x("error", {
                    type: "cancel",
                    code: "503",
                },
                x("service-unavailable", {
                    xmlns: "urn:ietf:params:xml:ns:xmpp-stanzas",
                }),
            ),
        ));
    }

    private notFound(to: string, from: string, id: string, type: string, xmlns: string) {
        this.xmpp.xmppWriteToStream(
            x("iq", {
                type: "error",
                to,
                from,
                id,
            }, x(type, {
                    xmlns,
                },
                x("error", {
                        type: "cancel",
                        code: "404",
                    },
                    x("item-not-found", {
                        xmlns: "urn:ietf:params:xml:ns:xmpp-stanzas",
                    }),
                ),
            )));
    }

    private handleVersionRequest(to: string, from: string, id: string): Promise<void> {
        return this.xmpp.xmppWriteToStream(
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

    private handleDiscoInfo(to: string, from: string, id: string): Promise<void> {
        this.discoInfo.to = to;
        this.discoInfo.from = from;
        this.discoInfo.id = id;
        return this.xmpp.xmppSend(this.discoInfo);
    }

    private async handleDiscoItems(to: string, from: string, id: string): Promise<void> {
        this.discoInfo.to = to;
        this.discoInfo.from = from;
        this.discoInfo.id = id;
        const rooms: IPublicRoom[] = await new Promise((resolve, reject) => {
            this.xmpp.emit("gateway-publicrooms", {
                searchString: "",
                result: (err, res) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(res);
                },
            } as IGatewayPublicRoomsQuery);
        });
        if (rooms.length) {

        } else {

        }
        return this.xmpp.xmppSend(this.discoInfo);
    }

    private queryRoom(roomAlias: string, onlyCheck: boolean = false): Promise<string|IGatewayRoom> {
        return new Promise((resolve, reject) => {
            this.xmpp.emit("gateway-queryroom", {
                roomAlias,
                onlyCheck,
                result: (err, res) => {
                    if (err) {
                        reject(err);
                    }
                    resolve(res);
                },
            } as IGatewayRoomQuery);
        });
    }

    private async handleRoomDiscovery(toStr: string, from: string, id: string) {
        const to = jid(toStr);
        const alias = this.parseAliasFromJID(to);
        try {
            if (!alias) {
                throw Error("Not a valid alias");
            }
            log.debug(`Running room discovery for ${toStr}`);
            let roomId = this.existingAliases.get(alias);
            if (!roomId) {
                roomId = await this.queryRoom(alias, true) as string;
                this.existingAliases.set(alias, roomId);
            }
            log.info(`Response for alias request ${toStr} (${alias}) -> ${roomId}`);
            await this.xmpp.xmppWriteToStream(
                x("iq", {
                    type: "result",
                    to: from,
                    from: toStr,
                    id,
                },
                    x("query", {
                        xmlns: "http://jabber.org/protocol/disco#info",
                    }, [
                        x("identity", {
                            category: "conference",
                            name: alias,
                            type: "text",
                        }),
                        x("feature", {
                            var: "http://jabber.org/protocol/muc",
                        }),
                    ]),
                ),
            );
        } catch (ex) {
            await this.xmpp.xmppWriteToStream(
                x("iq", {
                    type: "error",
                    to: from,
                    from: toStr,
                    id,
                }, x("query", {
                        xmlns: "http://jabber.org/protocol/disco#info",
                    },
                    x("error", {
                            type: "cancel",
                            code: "404",
                        },
                        x("item-not-found", {
                            xmlns: "urn:ietf:params:xml:ns:xmpp-stanzas",
                        }),
                    ),
                )));
        }
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

        const file = (await request.get({
            uri: thumbUrl,
            encoding: null, // make response body to Buffer.
            resolveWithFullResponse: true,
        }).promise())!;
        avatar = {
            data: Buffer.from(file.body),
            type: file.headers["content-type"],
        };
        this.avatarCache.set(avatarUrl, avatar);
        if (this.avatarCache.size > MAX_AVATARS) {
            this.avatarCache.delete(this.avatarCache.keys()[0]);
        }
        return avatar;
    }

    private async handleVcard(from: string, to: string, id: string, intent: any) {
        // Fetch mxid.
        const account = this.xmpp.getAccountForJid(jid(to));
        if (!account) {
            log.warn("Account fetch failed for", to);
            this.notFound(from, to, id, "vCard", "vcard-temp");
            return;
        }
        let profile: {displayname?: string, avatar_url?: string};
        try {
            // TODO: Move this to a gateway-profilelookup or something.
            profile = await intent.getProfileInfo(account.mxId, null);
        } catch (ex) {
            log.warn("Profile fetch failed for ", account.mxId, ex);
            this.notFound(from, to, id, "vCard", "vcard-temp");
            return;
        }

        const vCard: Element[] = [
            x("URL", undefined, `https://matrix.to/#/${account.mxId}`),
        ];

        if (profile.displayname) {
            vCard.push(x("FN", undefined, profile.displayname));
            vCard.push(x("NICKNAME", undefined, profile.displayname));
        }

        if (profile.avatar_url) {
            try {
                const res = await this.getThumbnailBuffer(profile.avatar_url, intent);
                if (res) {
                    const b64 = res.data.toString("base64");
                    vCard.push(
                        x("PHOTO", undefined, [
                            x("BINVAL", undefined, b64),
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
                to: from,
                from: to,
                id,
            }, x("vCard", {
                    xmlns: "vcard-temp",
                },
                vCard,
            ),
        ));
    }
}
