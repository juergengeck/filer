/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2017
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * This module attaches to the global MessageBus and after start attaches to all events of the types
 * "debug", "log", "alert" and "error". It uses regular `console.log()` statements but adds
 * colorization for each message type. It was made for Node.js and browser console environments.
 *
 * Defines a static namespace object. By using this object the destination of the log can easily
 * be changed. It also supports severity levels, and for production COLOR lower level calls to
 * the log function can be stripped from the source COLOR entirely by grepping for severity
 * level keywords. Development may prefer logs to the console while production COLOR would log via
 * XHR calls to a server.
 *
 * Example
 *
 * ```
 * import {start as startLogger} from 'one.core/lib/logger';
 * startLogger();
 * ```
 * @private
 * @module
 */

/* eslint-disable no-console */

import {getInstanceName} from './instance.js';
import type {MessageHandlerCb} from './message-bus.js';
import {createMessageBus} from './message-bus.js';
import {isBrowser} from './system/platform.js';
import type {AnyObject} from './util/object.js';
import {isObject, isString} from './util/type-checks-basic.js';
import type {ElementType} from './util/type-checks.js';

const MessageBus = createMessageBus('logger');

/**
 * A selection of colors and text effects for console output.
 *
 * - browser: Terminal colors for the browser console
 * See {@link https://stackoverflow.com/q/7505623/544779}
 *
 * - node.js: ANSI terminal codes to turn on certain font effects
 * See {@link https://stackoverflow.com/q/4842424/544779}
 * @global
 * @type {object}
 */
export const COLOR = isBrowser
    ? ({
          OFF: '',
          BOLD_ON: 'font-weight: bold;',
          BOLD_OFF: 'font-weight: normal;',
          FG_BLACK: 'color: black;',
          FG_RED: 'color: red;',
          FG_GREEN: 'color: green;',
          FG_YELLOW: 'color: gray;', // yellow, but that is hard to read on white browser background
          FG_BLUE: 'color: blue;',
          FG_MAGENTA: 'color: magenta;',
          FG_CYAN: 'color: cyan;',
          FG_WHITE: 'color: white;',
          BG_BLACK: 'background-color: black;',
          BG_RED: 'background-color: red;',
          BG_GREEN: 'background-color: green;',
          BG_YELLOW: 'background-color: yellow;',
          BG_BLUE: 'background-color: blue;',
          BG_MAGENTA: 'background-color: magenta;',
          BG_CYAN: 'background-color: cyan;',
          BG_WHITE: 'background-color: white;'
      } as const)
    : ({
          OFF: '\x1b[0m',
          BOLD_ON: '\x1b[1m',
          BOLD_OFF: '\x1b[22m',
          FG_BLACK: '\x1b[30m',
          FG_RED: '\x1b[31m',
          FG_GREEN: '\x1b[32m',
          FG_YELLOW: '\x1b[33m',
          FG_BLUE: '\x1b[34m',
          FG_MAGENTA: '\x1b[35m',
          FG_CYAN: '\x1b[36m',
          FG_WHITE: '\x1b[37m',
          BG_BLACK: '',
          BG_RED: '\x1b[41m',
          BG_GREEN: '\x1b[42m',
          BG_YELLOW: '\x1b[43m',
          BG_BLUE: '\x1b[44m',
          BG_MAGENTA: '\x1b[45m',
          BG_CYAN: '\x1b[46m',
          BG_WHITE: '\x1b[47m'
      } as const);

// Assign ANSI effect codes to log levels
const LEVEL_COLOR = isBrowser
    ? ({
          debug: COLOR.FG_YELLOW,
          log: COLOR.FG_GREEN,
          alert: COLOR.BG_WHITE + COLOR.FG_BLUE,
          error: COLOR.BOLD_ON + COLOR.FG_RED
      } as const)
    : ({
          debug: COLOR.FG_YELLOW,
          log: COLOR.FG_GREEN,
          alert: COLOR.BG_WHITE + COLOR.FG_BLUE,
          error: COLOR.BOLD_ON + COLOR.FG_RED
      } as const);

const LOG_LEVELS = ['debug', 'log', 'alert', 'error'] as const;

type LOG_TYPES = ElementType<typeof LOG_LEVELS>;

/**
 * @private
 * @typedef {object} Logger
 * @property {Function} debug - This function is used to write "debug" messages to the console.
 * @property {Function} log - This function is used to write "log" messages to the console.
 * @property {Function} alert - This function is used to write "alert" messages to the console.
 * @property {Function} error - This function is used to write "error" messages to the console.
 * @private
 * @type {Logger}
 */
const Log = {
    // About the type cast: Filled with its elements in the loop just below
} as Record<LOG_TYPES, (id: string, txt: string) => void>;

let printInstanceName = false;
let printTimestamp = false;

// Create logging functions with the id of the module that is going to use them
// already pre-filled, and ANSI color codes as well.
LOG_LEVELS.forEach(level => {
    Log[level] = (id, ...messages) => {
        const instanceName = getInstanceName() ?? 'n/a';
        const name = printInstanceName ? '[' + instanceName + '] ' : '';
        const date = new Date();
        const ts = printTimestamp
            ? `${date.getDate()}.${
                  date.getMonth() + 1
              }.${date.getFullYear()} @ ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()} `
            : '';

        isBrowser
            ? console.log(`${name}${ts}%c ${id} ${level} ${messages.join(' ')}`, LEVEL_COLOR[level])
            : // Use "+" to add the ANSI codes because console.log turns commas into spaces
              console.log(...[name + LEVEL_COLOR[level] + id, level, COLOR.OFF], ...messages);
    };
});

/**
 * @private
 * @param {string} type
 * @param {string} src
 * @param {Array<*>} messages
 * @returns {undefined}
 */
function log(type: string, src: string, messages: readonly unknown[]): void {
    let level: LOG_TYPES;

    if (LOG_LEVELS.includes(type as LOG_TYPES)) {
        level = type as LOG_TYPES;
    } else {
        const elements = type.split(':');
        const lastElement = elements[elements.length - 1] as LOG_TYPES;

        if (LOG_LEVELS.includes(lastElement)) {
            level = lastElement;
        } else {
            level = 'debug';
        }
    }

    Log[level](
        src,
        messages
            .map(msg => {
                if (isObject(msg)) {
                    // Use "duck typing" because "msg instanceof Error" would fail across execution
                    // contexts (frames, windows, node's vm.runInNewContext, etc.)
                    if (isString(msg.message) && isString(msg.stack)) {
                        // Make sure to include all guaranteed-to-be-there Error properties on all
                        // platforms, and go through a set to ensure we include them only once
                        return [
                            'name',
                            'message',
                            'stack',
                            ...Reflect.ownKeys(msg).filter(isString)
                        ]
                            .filter((item, index, arr) => arr.indexOf(item) === index)
                            .map(key => msg[key])
                            .join(' ');
                    }

                    // A circle-proof JSON.stringify. Details are lost - better than a crash.
                    // DETECTS ALL DUPLICATE REFERENCES - not just circles. Actually dealing with
                    // loops would take quite a bit more code, not worth it for this logging
                    // function.
                    const seenObjects: Set<AnyObject> = new Set();

                    return JSON.stringify(
                        msg,
                        (_key, value) => {
                            if (isObject(value)) {
                                if (seenObjects.has(value)) {
                                    return '[~CIRCLE-OR-DUPLICATE]';
                                }
                                seenObjects.add(value);
                            }

                            return value;
                        },
                        4
                    );
                }

                return msg;
            })
            .join('\n')
    );
}

// ------------------------------------------------------------------------------------
// LOG ANYTHING!
// Attach to _any_ event, send to the desired log-level function.
// ------------------------------------------------------------------------------------

const disconnectLogCallbacks: Array<() => void> = [];

/**
 * This function attaches the log functions for message bus message types "debug", "log",
 * "alert" and "error" to the message bus. The function take an option object parameter.
 * @static
 * @param {object} options
 * @param {boolean} [options.includeInstanceName=false] - If set to true the console output is
 * going to include the name of the instance
 * @param {boolean} [options.includeTimestamp=false] - If set to true the console output is
 * going to include the current date and time
 * @param {boolean} [options.types=['error','alert','log','debug']] - Which message types to
 * subscribe to for logging? If none are provided subscribe to the four default log message types.
 * @returns {undefined} Returns nothing
 */
export function startLogger({
    includeInstanceName = false,
    includeTimestamp = false,
    types = LOG_LEVELS
}: {
    includeInstanceName?: boolean;
    includeTimestamp?: boolean;
    types?: Readonly<LOG_TYPES[]>;
} = {}): void {
    printInstanceName = includeInstanceName;
    printTimestamp = includeTimestamp;

    for (const type of types) {
        const fn: MessageHandlerCb = (src, ...messages) => log(type, src, messages);
        MessageBus.on(type, fn);
        disconnectLogCallbacks.push(MessageBus.remove.bind(null, type, fn));
    }

    MessageBus.send('log', 'Logger started.');
}

/**
 * Disconnect all log callbacks on the message buses.
 */
export function stopLogger(): void {
    MessageBus.send('log', 'Logger stopped.');

    for (const disconnectLogCallback of disconnectLogCallbacks) {
        disconnectLogCallback();
    }

    disconnectLogCallbacks.splice(0, disconnectLogCallbacks.length);
}
