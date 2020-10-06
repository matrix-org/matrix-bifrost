import { BifrostProtocol } from "./bifrost/Protocol";
import { PRPL_XMPP } from "./ProtoHacks";
import { Parser } from "htmlparser2";
import { Logging, WeakEvent } from "matrix-appservice-bridge";
import { IConfigBridge } from "./Config";
import * as request from "request-promise-native";
import { MatrixMessageEvent } from "./MatrixTypes";
const log = Logging.get("MessageFormatter");

export interface IMatrixMsgContents {
    msgtype: string;
    body: string;
    remote_id?: string;
    info?: {mimetype: string, size: number};
    "m.relates_to"?: {
        "event_id": string,
        rel_type: "m.replace",
    };
    "m.new_content"?: IMatrixMsgContents;
    formatted_body?: string;
    format?: "org.matrix.custom.html";
    [key: string]: any|undefined;
}

export interface IBasicProtocolMessage {
    body: string;
    formatted?: {type: string, body: string}[];
    id?: string;
    original_message?: string;
    opts?: {
        attachments?: IMessageAttachment[];
    };
}

export interface IMessageAttachment {
    uri: string;
    mimetype?: string;
    size?: number;
}

export class MessageFormatter {

    public static matrixEventToBody(event: MatrixMessageEvent, config: IConfigBridge): IBasicProtocolMessage {
        const body = event.content.body;
        const formatted: {type: string, body: string}[] = [];
        if (event.content.formatted_body) {
            formatted.push({
                body: event.content.formatted_body,
                type: event.content.format === "org.matrix.custom.html" ? "html" : "unknown",
            });
        }
        if (event.content.msgtype === "m.emote") {
            return {body: `/me ${body}`, formatted, id: event.event_id};
        }
        if (["m.file", "m.image", "m.video"].includes(event.content.msgtype) && event.content.url) {
            const uriBits = event.content.url.substr("mxc://".length).split("/");
            const url = (config.mediaserverUrl ? config.mediaserverUrl : config.homeserverUrl).replace(/\/$/, "");
            event.content.info = event.content.info || {};
            return {
                body,
                id: event.event_id,
                opts: {
                    attachments: [
                        {
                            uri: `${url}/_matrix/media/v1/download/${uriBits[0]}/${uriBits[1]}`,
                            mimetype: event.content.info.mimetype,
                            size: event.content.info.size,
                        },
                    ],
                },
            };
        }
        return {body, formatted, id: event.event_id};
    }

    public static async messageToMatrixEvent(msg: IBasicProtocolMessage, protocol: BifrostProtocol, intent?: any):
        Promise<IMatrixMsgContents> {
        log.debug("Got message:", msg);
        const matrixMsg: IMatrixMsgContents = {
            msgtype: "m.text",
            body: msg.body.trim(),
        };
        if (msg.id) {
            matrixMsg.remote_id = msg.id;
        }
        if (msg.original_message) {
            matrixMsg["m.relates_to"] = {
                event_id: msg.original_message,
                rel_type: "m.replace",
            };
        }
        const hasAttachment = msg.opts && msg.opts.attachments && msg.opts.attachments.length;
        if (protocol.id === PRPL_XMPP) {
            if (matrixMsg.body.startsWith("<")) {
                // It *might* be HTML so go for it.
                try {
                    const md = MessageFormatter.parseHTMLIntoMatrixFormat(matrixMsg.body);
                    if (md.markdown.length === 0 || md.html.length === 0) {
                        throw new Error("Markdown/HTML was zero length, which probably means it didn't parse well");
                    }
                    matrixMsg.body = md.markdown;
                    matrixMsg.formatted_body = md.html;
                    matrixMsg.format = "org.matrix.custom.html";
                    return matrixMsg;
                } catch (ex) {
                    log.warn("Error while parsing HTML", ex);
                    // Not html, or bad formatting.
                }
            }
        }

        if (msg.formatted) {
            const html = msg.formatted.find((t) => t.type === "html");
            if (html) {
                matrixMsg.formatted_body = html.body;
                matrixMsg.format = "org.matrix.custom.html";
            }
        }

        if (matrixMsg.body.startsWith("/me ")) {
            matrixMsg.msgtype = "m.emote";
            matrixMsg.body = matrixMsg.body.substr("/me ".length);
        }

        // XXX: This currently only handles one attachment
        if (hasAttachment) {
            try {
                if (!intent) {
                    throw new Error("No intent given");
                }
                const attachment = msg.opts!.attachments![0];
                if (!attachment.uri.startsWith("http")) {
                    log.warn("Don't know how to handle attachment for message, not a http format uri");
                    return matrixMsg;
                }
                const file = (await request.get(attachment.uri, {resolveWithFullResponse: true}).promise())!;
                // Use the headers if a type isn't given.
                if (!attachment.mimetype) {
                    attachment.mimetype = file.headers["content-type"];
                }
                if (!attachment.size) {
                    attachment.size = parseInt(file.headers["content-length"] || "0", 10);
                }
                const client = intent.getClient();
                const maxSize = client.getMediaConfig ?
                    (await client.getMediaConfig().then((cfg) => cfg.m.upload.size).catch(() => -1)) : -1;

                if (attachment.size && maxSize > -1 && maxSize < attachment.size!) {
                    log.info("File is too large, linking instead");
                    matrixMsg.body = attachment.uri;
                    return matrixMsg;
                }

                log.info(`Uploading ${attachment.uri}...`);
                const mxcurl = await intent.getClient().uploadContent(file.body, {
                    onlyContentUri: true,
                    includeFilename: false,
                    rawResponse: false,
                    type: attachment.mimetype || "application/octect-stream",
                });
                matrixMsg.url = mxcurl;
                matrixMsg.body = msg.body;
                matrixMsg.filename = attachment.uri.split("/").reverse()[0];
                matrixMsg.info = {
                    mimetype: attachment.mimetype!,
                    size: attachment.size || 0,
                };
                if (!attachment.mimetype) {
                    matrixMsg.msgtype = "m.file";
                } else if (attachment.mimetype.startsWith("image")) {
                    matrixMsg.msgtype = "m.image";
                } else if (attachment.mimetype.startsWith("video")) {
                    matrixMsg.msgtype = "m.video";
                } else if (attachment.mimetype.startsWith("audio")) {
                    matrixMsg.msgtype = "m.audio";
                }
            } catch (ex) {
                log.warn("Failed to handle attachment:", ex);
            }
        }
        let finalMsg;
        if (msg.original_message) {
            finalMsg = {
                "m.new_content": matrixMsg,
                "body": ` * ${matrixMsg.body}`,
                "msgtype": matrixMsg.msgtype,
                "formatted_body": matrixMsg.formatted_body ? ` * ${matrixMsg.formatted_body}` : undefined,
                "format": matrixMsg.format,
            };
        } else {
            finalMsg = matrixMsg;
        }

        log.debug("Resulting matrix event :", finalMsg);
        return finalMsg;
    }

    private static parseHTMLIntoMatrixFormat(msg: string): {html: string, markdown: string} {
        let isError: Error|null = null;
        let html = "";
        let markdown = "";

        const tagToMarkdown = (name, open, attribs?) => {
            switch (name) {
                case "h1":
                    if (!open) { break; }
                    markdown += "# ";
                    break;
                case "h2":
                    if (!open) { break; }
                    markdown += "## ";
                    break;
                case "h3":
                    if (!open) { break; }
                    markdown += "### ";
                    break;
                case "h4":
                    if (!open) { break; }
                    markdown += "#### ";
                    break;
                case "h5":
                    if (!open) { break; }
                    markdown += "##### ";
                    break;
                case "h6":
                    if (!open) { break; }
                    markdown += "###### ";
                    break;
                case "code":
                    markdown += "`";
                    break;
                case "pre":
                    markdown += "```";
                    break;
                case "b":
                case "strong":
                    markdown += "**";
                    break;
                case "i":
                case "em":
                    markdown += "*";
                    break;
                case "span": // These get used for formatting
                    if (!open) { break; }
                    if (!attribs.style) { break; }
                    const styleSplit = attribs.style.split(";");
                    const styling = {};
                    styleSplit.forEach((set) => {
                        const sp = set.split(":");
                        if (sp.length < 2) { return; }
                        styling[sp[0].trim()] = sp[1].trim();
                    });
                    const fontSize = styling["font-size"];
                    if (fontSize === "xx-large") {
                        tagToMarkdown("h1", true, attribs);
                    } else if (fontSize === "x-large") {
                        tagToMarkdown("h2", true, attribs);
                    } else if (fontSize === "large") {
                        tagToMarkdown("h3", true, attribs);
                    }
                    break;
            }
        };

        const parser = new Parser({
            ontext: (text) => {
                if (text.replace(/\s/g, "").length === 0) {
                    return;
                }
                html += text;
                markdown += text + "\n";
            },
            onopentag: (name, attribs) => {
                if (["body", "html"].includes(name)) {
                    return; // We don't need these.
                }
                let htmlAttribs = "";
                Object.keys(attribs).forEach((key) => {
                    htmlAttribs += ` ${key}='${attribs[key]}'`;
                });
                html += `<${name}${htmlAttribs}>`;
                tagToMarkdown(name, true, attribs);
            },
            onclosetag: (name) => {
                if (["body", "html"].includes(name)) {
                    return; // We don't need these.
                }
                html += `<\\${name}>`;
                tagToMarkdown(name, false);
            },
            onerror: (error: Error) => {
                isError = error;
            },
        }, {decodeEntities: true});
        parser.write(msg);
        parser.end();
        if (isError !== null) {
            throw isError;
        }
        markdown = markdown.trim();
        return {html, markdown};
    }
}
