import * as Chai from "chai";
import { XHTMLIM } from "../../src/xmppjs/XHTMLIM";
import * as mockRequire from "mock-require";

const expect = Chai.expect;

describe("XHTMLIM", () => {
    it("should transform a message", () => {
        expect(
            XHTMLIM.HTMLToXHTML(
                "<html xmlns='http://jabber.org/protocol/xhtml-im'><p>Hello world</p></html>",
            ),
        ).to.equal(
            "<html xmlns='http://jabber.org/protocol/xhtml-im'><p>Hello world</p></html></html>",
        );
    });
    it("should transform a message with a link", () => {
        expect(
            XHTMLIM.HTMLToXHTML(
                "<a href=\"https://matrix.to/#/@benpa:matrix.org\">benpa</a>: Will be there in spirit!",
            ),
        ).to.equal(
            "<html xmlns=\'http://jabber.org/protocol/xhtml-im\'><a href=\'https://matrix.to/#/@benpa:matrix.org\'>"
            + "benpa</a>: Will be there in spirit!</html>",
        );
    });
    it("should transform a message with a reply", () => {
        expect(
            XHTMLIM.HTMLToXHTML(
                "<mx-reply><blockquote><a href=\"https://matrix.to/#/!ruaviCwHdJSWfKcBam:half-shot.uk/"
                + "$1548685877554RlePg:half-shot.uk?via=half-shot.uk&via=matrix.org&via=t2bot.io\">In reply to</a>"
                + "<a href=\"https://matrix.to/#/@Half-Shot:half-shot.uk\">"
                + "@Half-Shot:half-shot.uk</a><br>This is the first message</blockquote></mx-reply>"
                + "And this is a reply",
            ),
        ).to.equal(
            "<html xmlns='http://jabber.org/protocol/xhtml-im'><blockquote><a href='"
            + "https://matrix.to/#/!ruaviCwHdJSWfKcBam:half-shot.uk/$1548685877554RlePg:half-shot.uk?"
            + "via=half-shot.uk&via=matrix.org&via=t2bot.io'>In reply to</a><a href='https://matrix.to"
            + "/#/@Half-Shot:half-shot.uk'>@Half-Shot:half-shot.uk</a><br></br>This is the first message"
            + "</blockquote>And this is a reply</html>",
        );
    });
});
