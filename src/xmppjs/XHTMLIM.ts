import { Parser } from "htmlparser2";
import he from "he";

const XMLNS = "http://jabber.org/protocol/xhtml-im";

const VALID_ELEMENT_ATTRIBUTES = {
    // Defined Structure Module Elements and Attributes
    body: ["class", "id", "title", "style"],
    head:	["profile"],
    html:	["version"],
    title:	[],
    // Defined Text Module Elements and Attributes
    abbr: ["class", "id", "title", "style"],
    acronym: ["class", "id", "title", "style"],
    address: ["class", "id", "title", "style"],
    blockquote: ["class", "id", "title", "style", "cite"],
    br: ["class", "id", "title", "style"],
    cite: ["class", "id", "title", "style"],
    code: ["class", "id", "title", "style"],
    dfn: ["class", "id", "title", "style"],
    div: ["class", "id", "title", "style"],
    em: ["class", "id", "title", "style"],
    h1: ["class", "id", "title", "style"],
    h2: ["class", "id", "title", "style"],
    h3: ["class", "id", "title", "style"],
    h4: ["class", "id", "title", "style"],
    h5: ["class", "id", "title", "style"],
    h6: ["class", "id", "title", "style"],
    kbd: ["class", "id", "title", "style"],
    p: ["class", "id", "title", "style"],
    pre: ["class", "id", "title", "style"],
    q: ["class", "id", "title", "style", "cite"],
    samp: ["class", "id", "title", "style"],
    span: ["class", "id", "title", "style"],
    strong: ["class", "id", "title", "style"],
    var: ["class", "id", "title", "style"],
    // Hypertext Module Definition
    a: ["class", "id", "title", "style", "accesskey", "charset", "href", "hreflang", "rel", "rev", "tabindex", "type"],
    // List Module Definition
    dl: ["class", "id", "title", "style"],
    dt: ["class", "id", "title", "style"],
    dd: ["class", "id", "title", "style"],
    ol: ["class", "id", "title", "style"],
    ul: ["class", "id", "title", "style"],
    li: ["class", "id", "title", "style"],
    // Image Module Definition
    img: ["class", "id", "title", "style", "alt", "height", "longdesc", "src", "width"],
};

export class XHTMLIM {
    public static HTMLToXHTML(html: string) {
        let xhtml = "";
        const parser = new Parser({
            onopentag: (tagname, rawAttribs) => {
                // Filter out any elements or attributes we cannot support.
                if (VALID_ELEMENT_ATTRIBUTES[tagname] === undefined) {
                    return;
                }
                const attribs: {[key: string]: string } = {};
                Object.keys(rawAttribs).filter(
                    (a) => VALID_ELEMENT_ATTRIBUTES[tagname].includes(a.toLowerCase()),
                ).forEach((a) => {
                    attribs[a] = he.encode(rawAttribs[a]);
                });
                if (tagname === "html") {
                    attribs.xmlns = XMLNS;
                }
                xhtml += `<${tagname}${Object.keys(attribs).map((k) => ` ${k}='${attribs[k]}'`).join("")}>`;
            },
            ontext: (text) => {
                xhtml += `${he.escape(text)}`;
            },
            onclosetag: (name) => {
                if (VALID_ELEMENT_ATTRIBUTES[name] === undefined) {
                    return;
                }
                xhtml += `</${name}>`;
            },
        }, {
            decodeEntities: true,
            xmlMode: true,
            lowerCaseTags: true,
            lowerCaseAttributeNames: true,
        });
        if (!html.startsWith("<html")) {
            html = `<html xmlns='${XMLNS}'>${html}`;
        }
        if (!html.toLowerCase().endsWith("</html>")) {
            html += "</html>";
        }
        parser.write(html);
        parser.end();
        return xhtml;
    }
}
