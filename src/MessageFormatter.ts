import { PurpleProtocol } from "./purple/PurpleProtocol";
import { PRPL_XMPP } from "./ProtoHacks";
import { Parser } from "htmlparser2";
import { Logging } from "matrix-appservice-bridge";
const log = Logging.get("MessageFormatter");

export interface IMatrixMsgContents {
    msgtype: "m.text";
    body: string;
}

export interface IMatrixMsgContentsFormatted extends IMatrixMsgContents {
    formatted_body: string;
    format: string;
}


export class MessageFormatter {
    public static messageToMatrixEvent(msg: string, protocol: PurpleProtocol): IMatrixMsgContents {
        if (protocol.id === PRPL_XMPP) {
            msg = msg.trim();
            if (msg.startsWith("<")) {
                // It *might* be HTML so go for it.
                try {
                    const md = MessageFormatter.parseHTMLIntoMatrixFormat(msg);
                    return {
                        msgtype: "m.text",
                        body: md.markdown,
                        formatted_body: md.html,
                        format: "org.matrix.custom.html",
                    } as IMatrixMsgContentsFormatted;
                } catch (ex) {
                    log.error("Error while parsing HTML", ex);
                    // Not html, or bad formatting.
                    return {
                        msgtype: "m.text",
                        body: msg
                    };
                }
            }
            return {msgtype: "m.text", body: msg};
        }
        return {msgtype: "m.text", body: msg};
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
