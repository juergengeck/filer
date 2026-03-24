const filenameEscapeMap = new Map<string, string>([
    ['<', '﹤'],
    ['>', '﹥'],
    [':', 'ː'],
    ['"', '“'],
    ['/', '⁄'],
    ['\\', '∖'],
    ['|', '⼁'],
    ['?', '﹖'],
    ['*', '﹡']
]);

/**
 * Replaces all forbidden chars in a file name with utf8 equivalents.
 *
 * Note escaping is not perfectly reversible (e.g. trim space at end). Therefore we don't provide an
 * 'unescape'. Try to be able to live without it. So far it worked, but not sure if this will be
 * always the case.
 *
 * @param fileName
 */
export function escapeFileName(fileName: string): string {
    let fileNameEscaped = fileName;

    for (const [l, r] of filenameEscapeMap.entries()) {
        fileNameEscaped = fileNameEscaped.replaceAll(l, r);
    }

    // We need trimming, because on windows there seems to be a bug where folder names with ending
    // spaces leads to bugs when double clicking images in it. It then says the directory
    // doesn't exist, because somewhere in widows this space is trimmed.
    return fileNameEscaped.trimEnd();
}
