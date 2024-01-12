import { XMLValidator } from "fast-xml-parser";
import { AssertionError } from "chai";

export function assertXML(xml) {
    const err = XMLValidator.validate(xml);
    if (err !== true) {
        throw new AssertionError(err.err.code + ": " + err.err.msg);
    }
}