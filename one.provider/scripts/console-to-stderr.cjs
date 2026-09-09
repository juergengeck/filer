// ONE diagnostics must not share the canonical operation response stream.
const {Console} = require('node:console');
global.console = new Console({stdout: process.stderr, stderr: process.stderr});
