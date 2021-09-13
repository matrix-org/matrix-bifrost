/* eslint-disable max-classes-per-file */
import { Element } from "@xmpp/xml";
import { IStza, StzaIqResponse, StzaJingleAcceptIBB, StzaJingleIBBClose, StzaJingleTerminate } from "./Stanzas";
import { JingleConfig } from "./XJSBackendOpts";
import { XmppJsInstance } from "./XJSInstance";
import { XMPPFeatures } from "./XMPPConstants";
import stream from "stream";
import * as http from "http";
import { createHash, Hash } from "crypto";
import { Logging } from "matrix-appservice-bridge";
import { IncomingMessage } from "node:http";
import { EventEmitter } from "events";
import jid, { JID } from "@xmpp/jid";

const log = Logging.get("JingleHandler");

interface JingleSessionInitiateOpts {
    initiator: string;
    name: string;
    descriptionXmlns: string;
}

interface JingleUploadOpts {
    homeserverUrl: string;
    token: string;
}

export interface JingleFile {
    date?: Date;
    description: string;
    mediaType: string;
    name: string;
    size?: number;
    hash?: {algo: string, value: string};
}

export interface JingleReceivedFile {
    file: JingleFile;
    mxcUrl: string;
    from: JID;
    to: JID;
}

export abstract class JingleSession {
    constructor(public readonly sid: string, public readonly sessionDescription: JingleSessionInitiateOpts) { /* */}

    public abstract processDescriptionContents(contents: Element[]);
    public abstract chooseTransport(transports: Element[]);
    public abstract accept(from, to, descriptionXML: string): string | IStza;

}

export enum JingleFileTransferSessionState {
    NeedTransport,
    NeedAccept,
    NeedOpen,
    Writable,
    Closed,
    Error,
}

export class JingleFileTransferSession extends JingleSession {
    private internalFile?: JingleFile;
    public transportSid?: string;
    private transportBlockSize: number;
    private stream: stream.Writable;
    private hashSHA1: Hash;
    private state: JingleFileTransferSessionState = JingleFileTransferSessionState.NeedTransport;
    private internalMxc: string;

    constructor(
        sid: string,
        sessionDescription: JingleSessionInitiateOpts,
        private readonly uploadOpts: JingleUploadOpts,
        private readonly onUploadResult: (err: Error|null, mxcUrl?: string, file?: JingleFile) => void) {
        super(sid, sessionDescription)
    }

    private assertState(...expectedStates: JingleFileTransferSessionState[]) {
        if (!expectedStates.includes(this.state)) {
            throw Error(`Invalid session state: ${this.state}`);
        }
    }

    public processDescriptionContents(contents: Element[]) {
        const fileElement = contents.find(el => el.name === 'file');
        // XEP-234 https://xmpp.org/extensions/xep-0234.html#table-2 states the following
        const dateStr = fileElement.getChildText('date');
        const description = fileElement.getChildText('desc');
        // If no mediaType is specified, we should fall back to octet-stream.
        const mediaType = fileElement.getChildText('media-type') || "application/octet-stream";
        const name = fileElement.getChildText('name');
        const sizeStr = fileElement.getChildText('size');
        this.internalFile = {
            date: dateStr && new Date(dateStr),
            description,
            mediaType,
            name,
            size: sizeStr && parseInt(sizeStr),
        }
    }


    public chooseTransport(transports: Element[]) {
        this.assertState(JingleFileTransferSessionState.NeedTransport);
        const transport = transports.find(ts => ts.getAttr('xmlns') === XMPPFeatures.JingleIBB);
        if (!transport) {
            throw Error('No IBB transport given, cannot accept jingle');
        }
        this.state = JingleFileTransferSessionState.NeedAccept;
        this.transportSid = transport.getAttr('sid');
        // Limit the block size.
        this.transportBlockSize = Math.min(parseInt(transport.getAttr('block-size')) || 4096, 65535);
    }

    public accept(from, to, descriptionXML: string) {
        this.assertState(JingleFileTransferSessionState.NeedAccept);
        this.state = JingleFileTransferSessionState.NeedOpen;
        return new StzaJingleAcceptIBB(
            from, to, this.sid, this.sessionDescription.name,
            descriptionXML, this.transportBlockSize, this.transportSid);
    }

    private onHttpCallback(res: IncomingMessage) {
        let buffer = Buffer.from('');
        res.setEncoding('utf8');
        res.on('error', (err) => {
            this.onUploadResult(err);
        });
        res.on('data', (data) => {
            data = data instanceof Buffer ? data : Buffer.from(data);
            buffer = Buffer.concat([buffer, data]);
        })
        res.on('end', () => {
            const dataStr = buffer.toString('utf8');
            const data = JSON.parse(dataStr);
            if (res.statusCode !== 200) {
                this.onUploadResult(new Error(`Got ${res.statusCode} response from API ${dataStr}`));
                this.state = JingleFileTransferSessionState.Error;
                return;
            }
            const mxcurl = data.content_uri;
            this.internalMxc = mxcurl;
            this.onUploadResult(null, this.mxc, this.file);
        });
    }

    public onOpen() {
        this.assertState(JingleFileTransferSessionState.NeedOpen);
        // Open a request to the media repo
        const searchParams = new URLSearchParams({
            filename: this.file.name || "file.bin",
        });
        const url = new URL(`/_matrix/media/r0/upload?${searchParams}`, this.uploadOpts.homeserverUrl);
        this.stream = http.request(url, {
            headers: {
                'Content-Type': this.file.mediaType || "application/octect-stream",
                // TODO: This will break if we are not given the size.
                'Content-Length': this.file.size,
                'Authorization': `Bearer ${this.uploadOpts.token}`,
            },
            method: 'POST',
        }, (res) => {
            this.onHttpCallback(res);
        });
        this.hashSHA1 = createHash('sha1');
        this.state = JingleFileTransferSessionState.Writable;
    }

    public onData(b64: string) {
        this.assertState(JingleFileTransferSessionState.Writable);
        const buffer = Buffer.from(b64, "base64");
        this.stream.write(buffer);
        this.hashSHA1.write(buffer);
    }

    public onClose() {
        this.assertState(JingleFileTransferSessionState.Writable);
        this.stream.end();
    }

    public hashDigest() {
        this.assertState(JingleFileTransferSessionState.Writable, JingleFileTransferSessionState.Closed);
        return this.hashSHA1.digest('base64');
    }

    public get file() {
        return this.internalFile;
    }

    public get mxc() {
        return this.internalMxc;
    }
}

export class JingleHandler extends EventEmitter {
    public readonly sessions = new Map<string, JingleSession>();
    constructor(
        private readonly xmpp: XmppJsInstance,
        private readonly jingleConfig: JingleConfig,
        private readonly uploadOpts: JingleUploadOpts) {
        super();
    }

    public async onJingleRequest(stanza: Element) {
        const jingleElement = stanza.getChildByAttr('xmlns', 'urn:xmpp:jingle:1');
        if (!jingleElement) {
            throw Error('Request does not wrap a jingle request');
        }
        const jingleAction = jingleElement.getAttr('action');
        const sid = jingleElement.getAttr('sid');
        const from = stanza.getAttr('from');
        const to = stanza.getAttr('to');
        switch(jingleAction) {
            case 'session-initiate':
                return this.onSessionInitiate(jingleElement as Element, sid, from, to, stanza.getAttr('id'));
            case 'session-info':
                return this.onSessionInfo(jingleElement as Element, sid, from, to, stanza.getAttr('id'));
            case 'session-terminate':
                const session = this.sessions.get(sid);
                if (!session) {
                    log.warn(`Got session-terminate for a unknown session ${sid}?`);
                } else {
                    this.sessions.delete(sid);
                }
                break;
        }
    }

    private async onSessionInitiate(jingleElement: Element, sid: string, from: string, to: string, iqId: string) {
        log.info(`Session initiate for ${sid} (${from}->${to})`);
        const content = jingleElement.getChild('content');
        // Beginning new jingle
        if (this.sessions.has(sid)) {
            throw Error(`Session already begun for ${sid}`);
        }
        const description = content.getChild('description');
        if (!description) {
            throw Error('No description for jingle session-initiate');
        }
        const descriptionXmlns = description.getAttr('xmlns');
        const info = {
            from,
            to,
            initiator: content.getAttr('initiator'),
            name: content.getAttr('name'),
            descriptionXmlns,
        }
        let session: JingleSession;
        switch (descriptionXmlns) {
            case XMPPFeatures.JingleFileTransferV4:
            case XMPPFeatures.JingleFileTransferV5:
                session = new JingleFileTransferSession(sid, info, this.uploadOpts, (err, mxcUrl, file) => {
                    if (err) {
                        // TODO: Cancel / emit a error to the other user.
                        log.warn(`There was an error handling a Jingle file transfer for ${sid}:`, err);
                        return;
                    }
                    log.info(`Uploaded file as ${mxcUrl}`);
                    this.emit('file', {
                        file,
                        mxcUrl,
                        from: jid(from),
                        to: jid(to),
                    } as JingleReceivedFile);
                });
                break;
            default:
                throw Error('Description not supported');
        }
        session.processDescriptionContents(description.getChildElements() as Element[]);
        session.chooseTransport(content.getChildren('transport') as Element[]);
        this.sessions.set(sid, session);
        // Send an ACK
        await this.xmpp.xmppSend(
            new StzaIqResponse(to, from, iqId, "result")
        );

        if (this.jingleConfig.autodownload) {
            // Accept download
            this.xmpp.xmppSend(session.accept(to, from, description.toString()));
        } else {
            // TODO: We need to emit a notice to the room to begin download
        }
    }

    public onSessionInfo(jingleElement: Element, sid: string, from: string, to: string, iqId: string) {
        log.info(`Session info for ${sid} (${from}->${to})`);
        const session = this.sessions.get(sid);
        if (!session) {
            throw Error('Session not found');
        }
        const checksum = jingleElement.getChild('checksum');
        const shaOneHash = checksum.getChild('file').getChildByAttr('algo', 'sha-1');
        if (!shaOneHash) {
            throw Error('Cannot calculate this type of hash');
        }
        const fTSession = session as JingleFileTransferSession;
        const fileDigest = fTSession.hashDigest();
        if (shaOneHash.getText() === fileDigest) {
            log.debug(`Checksum for file matched`);
            this.xmpp.xmppSend(new StzaIqResponse(to, from, iqId, "result"));
            this.xmpp.sendIq(new StzaJingleTerminate(to, from, sid));
            // Close the FT session.
            fTSession.onClose();
            return;
        }
        log.warn(`Checksum for file DID NOT match (${shaOneHash.getText()} !== ${fileDigest})`);
        this.xmpp.xmppSend(new StzaIqResponse(to, from, iqId, "error"));
    }

    public async onIBBStanza(stanza: Element) {
        const from = stanza.getAttr('from');
        const to = stanza.getAttr('to');
        const id = stanza.getAttr('id');
        const openElement = stanza.getChild('open');
        const dataElement = stanza.getChild('data');
        const closeElement = stanza.getChild('close');
        const sid = (openElement || dataElement || closeElement).getAttr('sid');
        const session = [...this.sessions.values()].find((s) => s instanceof JingleFileTransferSession && s.transportSid === sid) as JingleFileTransferSession;
        if (!session) {
            // Not found
            // TODO: Improve error handling
            return this.xmpp.xmppSend(
                new StzaIqResponse(to, from, id, "error")
            );
        }
        if (openElement) {
            log.info(`Got open for session`);
            session.onOpen();
        } else if (dataElement) {
            log.info(`Got data for session`);
            session.onData(dataElement.getText());
        } else if (closeElement) {
            log.info(`Got close for session`);
            session.onClose();
        } else {
            throw Error('Request does not wrap a open stanza');
        }
        // ACK
        await this.xmpp.xmppSend(
            new StzaIqResponse(to, from, id, "result")
        );
    }
}
