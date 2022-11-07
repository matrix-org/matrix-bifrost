export enum XMPPStatusCode {
    RoomNonAnonymous = "100",
    SelfPresence = "110",
    RoomLoggingEnabled = "170",
    RoomLoggingDisabled = "171",
    RoomNowNonAnonymous = "172",
    SelfBanned = "301",
    SelfKicked = "307",
    SelfKickedTechnical = "333",
}

export enum XMPPFeatures {
    DiscoInfo = "http://jabber.org/protocol/disco#info",
    DiscoItems = "http://jabber.org/protocol/disco#items",
    Muc = "http://jabber.org/protocol/muc",
    IqVersion = "jabber:iq:version",
    IqSearch = "jabber:iq:search",
    MessageCorrection = "urn:xmpp:message-correct:0",
    XHTMLIM = "http://jabber.org/protocol/xhtml-im",
    Jingle = "urn:xmpp:jingle:1",
    // Swift uses v4
    JingleFileTransferV4 = "urn:xmpp:jingle:apps:file-transfer:4",
    // https://xmpp.org/extensions/xep-0234.html#appendix-revs
    // Everyone else uses V5
    // V5 changes are:
    // Update dependency on XEP-0300 to require the 'urn:xmpp:hashes:2' namespace that mandates base64 encoding.
    // Clarify that a <range/> element with a limit or offset value in a 'session-accept' should be honored by the file sender.
    JingleFileTransferV5 = "urn:xmpp:jingle:apps:file-transfer:5",
    JingleIBB = "urn:xmpp:jingle:transports:ibb:1",
    Receipts = "urn:xmpp:receipts",
    ChatStates = "http://jabber.org/protocol/chatstates",
}