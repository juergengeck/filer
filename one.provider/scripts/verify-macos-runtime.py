#!/usr/bin/env python3
"""Reject universal releases with incompatible or externally linked native code."""
import argparse
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys

MACHO_MAGIC = {bytes.fromhex(value) for value in (
    'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe',
    'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca')}
ARCHITECTURES = {'arm64', 'x86_64'}
SYSTEM_ROOTS = ('/usr/lib/', '/System/Library/')


def command(*args):
    """Read a checked Apple tool result without shell interpretation."""
    return subprocess.check_output(args, text=True).strip()


def version(value):
    """Compare deployment versions with omitted zero components."""
    parts = tuple(map(int, value.split('.')))
    return parts + (0,) * (3 - len(parts))


def is_macho(path):
    """Inspect all regular files, including non-executable .node modules."""
    with path.open('rb') as source:
        return source.read(4) in MACHO_MAGIC


def is_system(path):
    """Recognize only libraries supplied by the operating system."""
    return os.path.normpath(path).startswith(SYSTEM_ROOTS)


def get_binaries(root):
    """Find native code without depending on file extensions or execute bits."""
    binaries = []
    for directory, directories, files in os.walk(root):
        for name in directories + files:
            path = Path(directory) / name
            if not path.resolve().is_relative_to(root):
                raise ValueError(f'External bundle symlink: {path}')
        for name in files:
            path = Path(directory) / name
            if is_macho(path):
                binaries.append(path)
    if not binaries:
        raise ValueError(f'No Mach-O binaries found in {root}')
    return binaries


def verify(root, minimum=None):
    """Verify every native slice and dependency in a runtime or application."""
    root = Path(root).resolve()
    plist = root / 'Contents/Info.plist'
    if minimum is None:
        with plist.open('rb') as source:
            minimum = plistlib.load(source)['LSMinimumSystemVersion']
    binaries = get_binaries(root)
    executable_dirs = [path.parent for path in binaries if path.parent.name == 'MacOS']
    if not executable_dirs:
        executable_dirs = [root]
    native = set(path.resolve() for path in binaries)

    def expand(value, binary):
        """Expand dyld locations while keeping dependency resolution in the bundle."""
        if value.startswith('@loader_path/'):
            return [binary.parent / value.removeprefix('@loader_path/')]
        if value.startswith('@executable_path/'):
            return [directory / value.removeprefix('@executable_path/') for directory in executable_dirs]
        return [Path(value)] if value.startswith('/') else []

    for binary in binaries:
        archs = set(command('lipo', '-archs', str(binary)).split())
        if archs != ARCHITECTURES:
            raise ValueError(f'{binary}: expected arm64 + x86_64, found {sorted(archs)}')
        for arch in sorted(archs):
            load = command('otool', '-arch', arch, '-l', str(binary))
            minima = re.findall(r'cmd LC_BUILD_VERSION\s+cmdsize \d+\s+platform \S+\s+minos ([0-9.]+)', load)
            minima += re.findall(r'cmd LC_VERSION_MIN_MACOSX\s+cmdsize \d+\s+version ([0-9.]+)', load)
            if not minima or any(version(value) > version(minimum) for value in minima):
                raise ValueError(f'{binary} ({arch}): minimum macOS {minima} exceeds advertised {minimum}')
            rpaths = re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset', load)
            dependencies = re.findall(r'cmd LC_(?:LOAD_DYLIB|LOAD_WEAK_DYLIB|REEXPORT_DYLIB|LOAD_UPWARD_DYLIB|LAZY_LOAD_DYLIB)\s+cmdsize \d+\s+name (.+?) \(offset', load)
            for dependency in dependencies:
                if is_system(dependency):
                    continue
                if dependency.startswith('@rpath/'):
                    candidates = [candidate / dependency.removeprefix('@rpath/')
                                  for rpath in rpaths for candidate in expand(rpath, binary)]
                else:
                    candidates = expand(dependency, binary)
                if not any(is_system(candidate.resolve()) or candidate.resolve() in native for candidate in candidates):
                    raise ValueError(f'{binary} ({arch}): external or unresolved library {dependency}')
    print(f'Validated {len(binaries)} universal Mach-O files, macOS {minimum}, and system/bundled libraries in {root}')
    return len(binaries)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--minimum-macos', help='Required for an unpackaged runtime without Info.plist')
    parser.add_argument('--list-mach-o', action='store_true', help='Print NUL-delimited native paths for signing')
    args = parser.parse_args()
    try:
        if args.list_mach_o:
            for binary in get_binaries(args.bundle.resolve()):
                sys.stdout.buffer.write(os.fsencode(binary) + b'\0')
        else:
            verify(args.bundle, args.minimum_macos)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Release validation failed: {error}\n')
