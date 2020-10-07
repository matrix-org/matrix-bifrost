// tslint:disable: no-any
import * as Chai from "chai";
import { XEP0106ApplyEscapingTransformations } from "../src/MatrixRoomHandler";
const expect = Chai.expect;

describe("XEP0106JIDEscaping", () => {
  it("implement XEP-0106 JID escaping for matrix room ID", () => {
    expect(XEP0106ApplyEscapingTransformations('callme"ishmael"')).to.equal(
      "callme\\22ishmael\\22"
    );
    expect(XEP0106ApplyEscapingTransformations("at&tguy")).to.equal(
      "at\\26tguy"
    );
    expect(XEP0106ApplyEscapingTransformations("d'artagnan")).to.equal(
      "d\\27artagnan"
    );
    expect(XEP0106ApplyEscapingTransformations("/.fanboy")).to.equal(
      "\\2f.fanboy"
    );
    expect(XEP0106ApplyEscapingTransformations("::foo::")).to.equal(
      "\\3a\\3afoo\\3a\\3a"
    );
    expect(XEP0106ApplyEscapingTransformations("<foo>")).to.equal(
      "\\3cfoo\\3e"
    );
    expect(XEP0106ApplyEscapingTransformations("user@host")).to.equal(
      "user\\40host"
    );
  });
});
