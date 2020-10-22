import { jid } from "@xmpp/jid";

export const XMPP_CHAT_NAME = "mychatname#matrix.org";
export const XMPP_MEMBER_JID = jid("xmpp_bob", "xmpp.example.com", "myresource");
export const XMPP_MEMBER_JID_STRIPPED = jid("xmpp_bob", "xmpp.example.com");
export const XMPP_MEMBER_JID_SECOND_DEVICE = jid("xmpp_bob", "xmpp.example.com", "myresource2");
export const XMPP_MEMBER_ANONYMOUS = jid(XMPP_CHAT_NAME, "xmpp.example.com", "bob");
export const XMPP_MEMBER_MXID = "@_x_xmpp_bob:matrix.example.com";

export const MATRIX_MEMBER_MXID = "@alice:matrix.example.com";
export const MATRIX_MEMBER_ANONYMOUS = jid(XMPP_CHAT_NAME, "xmpp.example.com", "alice");
export const MATRIX_ALIAS = "#mychatname:matrix.org"