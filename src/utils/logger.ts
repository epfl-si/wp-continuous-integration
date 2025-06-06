import {Config} from "./configFileReader";

let debug = false;

export function configLogs(configFile: Config) {
    debug = configFile.DEBUG;
}

function log(message: string, level: string = 'info', metadata: object = {}) {
    const logObject = {
        message,
        ...metadata,
    };

    if (level == 'error' || debug) {
        console.log(new Date().toISOString(), JSON.stringify(logObject));
    }
}

export function error(message: string, metadata: any) {
    log(message, 'error', metadata);
}

export function warn(message: string, metadata: any) {
    log(message, 'warning', metadata);
}

export function info(message: string, metadata: any) {
    log(message, 'info', metadata);
}

export function getErrorMessage(e: any): string {
    let message: string = '';

    if (typeof e === "string") {
        message = e;
    } else if (e instanceof Error) {
        message = e.message;
        if (debug) {
            message = message.concat(e.stack != undefined ? " --- " + e.stack : '');
        }
    }

    return message;
}
