import * as parser from "fast-xml-parser";
import { AssertionError } from "chai";

export function assertXML(xml) {
    const err = parser.validate(xml);
    if (err !== true) {
        throw new AssertionError(err.err.code + ": " + err.err.msg);
    }
}