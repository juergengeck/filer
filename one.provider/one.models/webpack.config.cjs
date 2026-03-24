const path = require('path');
const webpack = require('webpack');

module.exports = {
    mode: 'production',
    output: {
        chunkFormat: "module",
        path: path.resolve(__dirname),
        library: {
            type: "module"
        }
    },
    entry: {
        comm_server: {
            import: './lib/tools/CommunicationServer.js',
            filename: '[name].bundle.js'
        },
        password_recovery_server: {
            import: './lib/tools/PasswordRecoveryService/PasswordRecoveryServer.js',
            filename: '[name].bundle.js'
        },
        generate_identity: {
            import: './lib/tools/identity/GenerateIdentity.js',
            filename: '[name].bundle.js'
        }
    },
    experiments: {
        outputModule: true,
    },
    devtool: 'inline-source-map',
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules|@refinio|one\.core|utf-8-validate|bufferutil/
            }
        ]
    },

    resolve: {
        extensions: ['.js']
    },
    target: 'node',
    node: {
        __dirname: true
    },
    plugins: []
};
