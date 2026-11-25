/** Local build targets; Unix FUSE remains supported independently of Windows ProjFS. */
export const localPackages = [
    {directory: 'one.filer', platforms: ['linux', 'darwin']},
    {directory: 'one.provider', platforms: ['darwin']},
    {directory: 'one.fuse3'},
    {directory: 'one.projfs'}
];

/** Combine runner-specific platform constraints with the package's declared OS support. */
export function supportsPlatform(config, manifest, platform) {
    if (config.platforms && !config.platforms.includes(platform)) return false;
    const declared = manifest.os;
    if (!Array.isArray(declared) || declared.length === 0) return true;
    if (declared.includes('!' + platform)) return false;
    const allowed = declared.filter(entry => !entry.startsWith('!'));
    return allowed.length === 0 || allowed.includes(platform);
}
