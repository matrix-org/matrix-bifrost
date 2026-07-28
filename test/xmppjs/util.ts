import { XMLValidator } from "fast-xml-parser";

export function assertXML(xml) {
    const err = XMLValidator.validate(xml);
    if (err !== true) {
        throw new Error(err.err.code + ": " + err.err.msg);
    }
}