"""Validate both Private IPC peers with real signatures, without touching installed domains."""
import os
import plistlib
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import uuid

provider = Path(__file__).resolve().parent.parent
identity = os.environ.get('SIGNING_IDENTITY', 'Developer ID Application: Refinio GmbH (26W8AC52QS)')
with tempfile.TemporaryDirectory(prefix='filer-ipc-security-') as temp:
    root = Path(temp)
    probe = root / 'probe'
    subprocess.run(['xcrun', 'swiftc', '-target', 'arm64-apple-macos13.0',
        str(provider / 'Sources/OneFilerShared/RuntimeProtocol.swift'),
        str(provider / 'Sources/OneFilerShared/PrivateSocket.swift'),
        str(provider / 'Sources/OneFilerHost/NodeRuntimeProcess.swift'),
        str(provider / 'Tests/Security/PrivateSocketProbe.swift'), '-o', str(probe)], check=True)
    binaries = {}
    for role, identifier in [('host', 'one.filer'), ('extension', 'one.filer.extension'), ('wrong', 'one.filer.wrong'), ('adhoc', 'one.filer.extension')]:
        binary = root / role
        shutil.copy2(probe, binary)
        subprocess.run(['codesign', '--force', '--sign', '-' if role == 'adhoc' else identity, '--identifier', identifier, str(binary)], check=True)
        binaries[role] = binary
    for server_role, client_role, expected in [('host', 'extension', 0), ('host', 'wrong', 3), ('wrong', 'extension', 3), ('host', 'adhoc', 3)]:
        endpoint = root / (uuid.uuid4().hex[:8] + '.sock')
        server = subprocess.Popen([str(binaries[server_role]), 'server', str(endpoint)], stdout=subprocess.PIPE, text=True)
        try:
            if not select.select([server.stdout], [], [], 10)[0] or server.stdout.readline().strip() != 'READY':
                raise RuntimeError('Private IPC probe server did not start')
            client = subprocess.run([str(binaries[client_role]), 'client', str(endpoint)], timeout=15)
            if client.returncode != expected:
                raise RuntimeError(f'{server_role}/{client_role}: expected {expected}, received {client.returncode}')
            print(f'PASS: server={server_role}, client={client_role}', flush=True)
        finally:
            server.terminate()
            server.wait(timeout=10)

# Optional provisioned App Sandbox check; profiles are read from an existing signed build.
profile_app = os.environ.get('FILER_PROFILE_APP')
if profile_app:
    with tempfile.TemporaryDirectory(prefix='filer-ipc-sandbox-') as temp:
        root = Path(temp)
        probe = root / 'probe'
        subprocess.run(['xcrun', 'swiftc', '-target', 'arm64-apple-macos13.0',
            str(provider / 'Sources/OneFilerShared/RuntimeProtocol.swift'),
            str(provider / 'Sources/OneFilerShared/PrivateSocket.swift'),
            str(provider / 'Sources/OneFilerHost/NodeRuntimeProcess.swift'),
        str(provider / 'Tests/Security/PrivateSocketProbe.swift'), '-o', str(probe)], check=True)
        binaries = {}
        for role, identifier, profile in [
            ('host', 'one.filer', Path(profile_app) / 'Contents/embedded.provisionprofile'),
            ('extension', 'one.filer.extension', Path(profile_app) / 'Contents/PlugIns/OneFilerExtension.appex/Contents/embedded.provisionprofile')]:
            app = root / 'host.app' if role == 'host' else root / 'host.app/Contents/PlugIns/OneFilerExtension.appex'
            contents = app / 'Contents'
            (contents / 'MacOS').mkdir(parents=True)
            binary = contents / 'MacOS/probe'
            shutil.copy2(probe, binary)
            shutil.copy2(profile, contents / 'embedded.provisionprofile')
            (contents / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': identifier, 'CFBundleExecutable': 'probe', 'CFBundlePackageType': 'APPL'}))
            entitlements = root / (role + '.entitlements')
            entitlements.write_bytes(plistlib.dumps({'com.apple.security.app-sandbox': True,
                'com.apple.security.application-groups': ['group.one.filer'],
                'com.apple.application-identifier': '26W8AC52QS.' + identifier,
                'com.apple.developer.team-identifier': '26W8AC52QS'}))
            subprocess.run(['codesign', '--force', '--sign', identity, '--options', 'runtime', '--entitlements', str(entitlements), str(app)], check=True)
            binaries[role] = binary
        subprocess.run(['codesign', '--force', '--sign', identity, '--options', 'runtime', '--entitlements', str(root / 'host.entitlements'), str(root / 'host.app')], check=True)
        endpoint = Path.home() / 'Library/Group Containers/group.one.filer' / ('test-' + uuid.uuid4().hex[:8] + '.sock')
        server = subprocess.Popen([str(binaries['host']), 'server', str(endpoint)], stdout=subprocess.PIPE, text=True)
        try:
            if not select.select([server.stdout], [], [], 10)[0] or server.stdout.readline().strip() != 'READY':
                raise RuntimeError('Sandboxed server did not start')
            subprocess.run([str(binaries['extension']), 'client', str(endpoint)], check=True, timeout=15)
            print('PASS: provisioned sandboxed peers without network entitlements', flush=True)
        finally:
            server.terminate()
            server.wait(timeout=10)
            endpoint.unlink(missing_ok=True)

        runtime_path = os.environ.get('FILER_TEST_RUNTIME')
        if runtime_path:
            contents = root / 'host.app/Contents'
            (contents / 'Resources').mkdir(exist_ok=True)
            shutil.copytree(Path(runtime_path) / 'runtime', contents / 'Resources/runtime', symlinks=True)
            shutil.copy2(Path(runtime_path) / 'node', contents / 'MacOS/node')
            subprocess.run(['codesign', '--force', '--sign', identity, '--options', 'runtime', '--entitlements',
                str(provider / 'Resources/Node.entitlements'), str(contents / 'MacOS/node')], check=True)
            entitlements = root / 'host.entitlements'
            properties = plistlib.loads(entitlements.read_bytes())
            properties['com.apple.security.network.client'] = True
            entitlements.write_bytes(plistlib.dumps(properties))
            subprocess.run(['codesign', '--force', '--sign', identity, '--options', 'runtime', '--entitlements',
                str(entitlements), str(root / 'host.app')], check=True)
            subprocess.run([str(binaries['host']), 'runtime', 'unused'], check=True, timeout=90)
