#!/usr/bin/env python3
"""Compile native fixtures to check the release gate against reachable defects."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('runtime_check', Path(__file__).with_name('verify-macos-runtime.py'))
runtime_check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime_check)


class ReleaseValidationTests(unittest.TestCase):
    """Use actual Mach-O load commands rather than mocked Apple tool output."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / 'fixture.c'
        self.source.write_text('int fixture(void) { return 42; }\n')

    def compile(self, name='fixture.dylib', architectures=('arm64', 'x86_64'), minimum='13.5', extra=()):
        """Build a native fixture with an explicit architecture and OS contract."""
        output = self.root / name
        subprocess.run(['xcrun', 'clang', '-dynamiclib', str(self.source),
                        *[arg for arch in architectures for arg in ('-arch', arch)],
                        f'-mmacosx-version-min={minimum}', '-o', str(output), *extra],
                       check=True, capture_output=True)
        return output

    def check(self, minimum='13.5'):
        """Keep test output limited to the test outcome."""
        with contextlib.redirect_stdout(io.StringIO()):
            return runtime_check.verify(self.root, minimum)

    def test_universal_system_linked_library_passes(self):
        self.compile()
        self.assertEqual(self.check(), 1)

    def test_thin_nonexecutable_node_module_is_rejected(self):
        self.compile()
        self.compile('addon.node', architectures=('arm64',)).chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'expected arm64'):
            self.check()

    def test_understated_os_requirement_is_rejected(self):
        self.compile(minimum='14.0')
        with self.assertRaisesRegex(ValueError, 'exceeds advertised 13.5'):
            self.check()

    def test_external_absolute_library_is_rejected(self):
        dependency = self.compile('dependency.dylib', extra=('-Wl,-install_name,/opt/filer-test/dependency.dylib',))
        self.source.write_text('extern int fixture(void); int caller(void) { return fixture(); }\n')
        self.compile('consumer.dylib', extra=(str(dependency),))
        with self.assertRaisesRegex(ValueError, 'external or unresolved library /opt/'):
            self.check()


if __name__ == '__main__':
    unittest.main()
