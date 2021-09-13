
export interface JingleConfig {
    autodownload: boolean;
}
export interface IXJSBackendOpts {
    service: string;
    domain: string;
    password: string;
    defaultResource: string;
    logRawStream: boolean;
    jingle?: JingleConfig;
}
