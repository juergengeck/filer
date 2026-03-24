/**
 * This escapes the message, so that message does not equal the keyword anymore.
 *
 * @param keyword
 * @param message
 */
export function escapeKeyword(keyword: string, message: string): string {
    return message.startsWith(keyword) ? `${message}x` : message;
}

export function escapeKeywords(keywords: string[], message: string): string {
    let transformedMessage = message;
    for (const keyword of keywords) {
        transformedMessage = escapeKeyword(keyword, transformedMessage);
    }
    return transformedMessage;
}

/**
 * This unescapes the message that was escaped with the escapeKeyword function.
 *
 * @param keyword
 * @param message
 */
export function unescapeKeyword(keyword: string, message: string): string {
    if (message === keyword) {
        throw new Error(`Tried to unescape the keyword value ${keyword}`);
    }
    return message.startsWith(keyword) ? message.slice(0, -1) : message;
}

export function unescapeKeywords(keywords: string[], message: string): string {
    let transformedMessage = message;
    for (const keyword of [...keywords].reverse()) {
        transformedMessage = unescapeKeyword(keyword, transformedMessage);
    }
    return transformedMessage;
}
