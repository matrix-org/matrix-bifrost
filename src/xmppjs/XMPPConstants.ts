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
    ExtendedStanzaAddressing = "http://jabber.org/protocol/address"
}