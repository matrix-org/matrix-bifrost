import { Element, x } from "@xmpp/xml";
import { XmppJsInstance } from "./XJSInstance";
import { jid, JID } from "@xmpp/jid";
import { Logging } from "matrix-appservice-bridge";
import * as request from "request-promise-native";
import { IGatewayRoom } from "../bifrost/Gateway";
import { IGatewayRoomQuery, IGatewayPublicRoomsQuery } from "../bifrost/Events";
import { StzaIqDiscoInfo, StzaIqPing, StzaIqDiscoItems, StzaIqSearchFields, SztaIqError, StzaIqPingError } from "./Stanzas";
import { IPublicRoomsResponse } from "../MatrixTypes";
import { IConfigBridge } from "../Config";
import { XMPPFeatures } from "./XMPPConstants";

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
    constructor(private xmpp: XmppJsInstance, private bridgeConfig: IConfigBridge) {
        this.avatarCache = new Map();
        this.existingAliases = new Map();
        this.discoInfo = new StzaIqDiscoInfo("", "", "");
        this.discoInfo.identity.add({category: "conference", type: "text", name: "Bifrost Matrix Gateway"});
        this.discoInfo.identity.add({category: "gateway", type: "matrix", name: "Bifrost Matrix Gateway"});
        this.discoInfo.feature.add(XMPPFeatures.DiscoInfo);
        this.discoInfo.feature.add(XMPPFeatures.DiscoItems);
        this.discoInfo.feature.add(XMPPFeatures.Muc);
        this.discoInfo.feature.add(XMPPFeatures.IqVersion);
        this.discoInfo.feature.add(XMPPFeatures.IqSearch);
    }

    public parseAliasFromJID(to: JID): string|null {
        const aliasRaw = /#(.+)#(.+)/g.exec(to.local);
        if (!aliasRaw || aliasRaw.length < 3) {
            return null;
        }
        return `#${aliasRaw[1]}:${aliasRaw[2]}`;
    }

    public createJIDFromAlias(alias: string): string|null {
        const aliasRaw = /#(.+):(.+)/g.exec(alias);
        if (!aliasRaw || aliasRaw.length < 3) {
            return null;
        }
        return `#${aliasRaw[1]}#${aliasRaw[2]}@${this.xmpp.xmppAddress.domain}`;
    }

    public async handleIq(stanza: Element, intent: any): Promise<void> {
        const id = stanza.getAttr("id");
        const from = stanza.getAttr("from");
        const to = stanza.getAttr("to");
        const type = stanza.getAttr("type");

        log.info("Handling iq request");

        if (stanza.getChildByAttr("xmlns", "jabber:iq:version")) {
            return this.handleVersionRequest(from, to, id);
        }

        // Only respond to this if it has no local part.
        const local = jid(to).local;
        if (stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/disco#info") && !local) {
            return this.handleDiscoInfo(from, to, id);
        }

        if (stanza.getChildByAttr("xmlns", "vcard-temp") && type === "get") {
            return this.handleVcard(from, to, id, intent);
        }

        if (stanza.getChildByAttr("xmlns", "urn:xmpp:ping") && type === "get") {
            return this.handlePing(from, to, id);
        }

        if (this.xmpp.gateway) {
            const searchQuery = stanza.getChildByAttr("xmlns", "jabber:iq:search");
            if (stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/disco#items") &&
                this.xmpp.xmppAddress.domain === jid(to).domain) {
                return this.handleDiscoItems(from, to, id, "", undefined);
            }

            if (searchQuery && !local) {
                // XXX: Typescript is a being a bit funny about Element, so doing an any here.
                return this.handleDiscoItems(from, to, id, stanza.attrs.type, searchQuery as any);
            }

            if (stanza.getChildByAttr("xmlns", "http://jabber.org/protocol/disco#info") && local) {
                 return this.handleRoomDiscovery(to, from, id);
            }
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

    private async handleDiscoInfo(to: string, from: string, id: string) {
        this.discoInfo.to = to;
        this.discoInfo.from = from;
        this.discoInfo.id = id;
        await this.xmpp.xmppSend(this.discoInfo);
    }

    private async handleDiscoItems(to: string, from: string, id: string, type: string,
                                   searchElement?: Element): Promise<void> {
        log.info("Got disco items request, looking up public rooms");
        let searchString = "";
        let homeserver: string|null = null;
        if (searchElement) {
            log.debug("Request was a search");
            if (type === "get") {
                log.debug("Responding with search fields");
                // Getting search fields.
                await this.xmpp.xmppSend(
                    new StzaIqSearchFields(
                        from,
                        to,
                        id,
                        "Please enter a searh term to find Matrix rooms:",
                        {
                            Term: "",
                            Homeserver: this.bridgeConfig.domain,
                        },
                    ),
                );
            } else if (type === "set") {
                // Searching via a term.
                const term = searchElement.getChild("Term");
                if (term) {
                    searchString = term.text();
                }
                const hServer = searchElement.getChild("Homeserver");
                if (hServer) {
                    homeserver = hServer.text();
                }
            } else {
                // Not sure what to do with this.
                return;
            }
        }

        const response = new StzaIqDiscoItems(
            from, to, id,
            searchElement ? "jabber:iq:search" : "http://jabber.org/protocol/disco#items",
        );
        let rooms: IPublicRoomsResponse;
        try {
            rooms = await new Promise((resolve, reject) => {
                this.xmpp.emit("gateway-publicrooms", {
                    searchString,
                    homeserver,
                    result: (err, res) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(res);
                    },
                } as IGatewayPublicRoomsQuery);
            });
        } catch (ex) {
            log.warn(`Failed to search rooms: ${ex}`);
            // XXX: There isn't a very good way to explain why it failed,
            // so we use service unavailable.
            await this.xmpp.xmppSend(new SztaIqError(from, to, id, "cancel", 503, "service-unavailable", undefined,
                `Failure fetching public rooms from ${homeserver}`));
            return;
        }

        rooms.chunk.forEach((room) => {
            if (room.canonical_alias == null) {
                return;
            }
            const j = this.createJIDFromAlias(room.canonical_alias);
            if (!j) {
                return;
            }
            response.addItem(j, room.name || room.canonical_alias);
        });
        await this.xmpp.xmppSend(response);
    }

    private queryRoom(roomAlias: string): Promise<string|IGatewayRoom> {
        return new Promise((resolve, reject) => {
            this.xmpp.emit("gateway-queryroom", {
                roomAlias,
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
                roomId = await this.queryRoom(alias) as string;
                this.existingAliases.set(alias, roomId);
            }
            log.info(`Response for alias request ${toStr} (${alias}) -> ${roomId}`);
            const discoInfo = new StzaIqDiscoInfo(toStr, from, id);
            discoInfo.feature.add(XMPPFeatures.DiscoInfo);
            discoInfo.feature.add(XMPPFeatures.Muc);
            discoInfo.feature.add(XMPPFeatures.MessageCorrection);
            discoInfo.feature.add(XMPPFeatures.XHTMLIM);
            discoInfo.identity.add({
                category: "conference",
                name: alias,
                type: "text",
            });
            discoInfo.identity.add({
                category: "gateway",
                name: alias,
                type: "matrix",
            });
            await this.xmpp.xmppSend(discoInfo);
        } catch (ex) {
            await this.xmpp.xmppSend(new SztaIqError(toStr, from, id, "cancel", 404, "item-not-found", undefined, "Room could not be found"));
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

    private async handlePing(from: string, to: string, id: string) {
        const toJid = jid(to);
        log.debug(`Got ping from=${from} to=${to} id=${id}`);
        // https://xmpp.org/extensions/xep-0199.html
        if (to === this.xmpp.xmppAddress.domain) {
            // Server-To-Server pings
            if (jid(from).domain === from) {
                log.debug(`S2S ping result sent to ${from}`);
                await this.xmpp.xmppSend(new StzaIqPing(to, from, id, "result"));
                return;
            }
            // If the 'from' part is not a domain, this is not a S2S ping.
        }

        // https://xmpp.org/extensions/xep-0410.html
        if (toJid.local && toJid.resource) {
            // Self ping
            if (!this.xmpp.gateway) {
                // No gateways configured, not pinging.
                return;
            }
            const chatName = `${toJid.local}@${toJid.domain}`;
            const result = !!this.xmpp.gateway.isAnonJIDInMuc(toJid);
            if (result) {
                await this.xmpp.xmppSend(new StzaIqPing(to, from, id, "result"));
            } else {
                await this.xmpp.xmppSend(new StzaIqPingError(to, from, id, "not-acceptable", chatName));
            }
            log.debug(`Self ping result sent to ${from} (result=${result})`);
            return;
        }

        // All other pings are invalid in this context and will be ignored.
        await this.xmpp.xmppSend(new StzaIqPingError(to, from, id, "service-unavailable"));
    }
}
