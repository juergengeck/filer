import type {CommandDefinition} from '../CommandRegistry.js';

export const meCommand: CommandDefinition = {
    name: 'me',
    description: 'Send an action message (e.g., "/me waves hello")',
    usage: '/me <action>',
    category: 'chat',
    handler: async (args) => {
        if (!args.trim()) {
            return {type: 'error', message: 'Usage: /me <action>'};
        }
        return {type: 'message', text: `*${args.trim()}*`};
    }
};

export const shrugCommand: CommandDefinition = {
    name: 'shrug',
    description: 'Append a shrug to your message',
    usage: '/shrug [message]',
    category: 'chat',
    handler: async (args) => {
        const text = args.trim() ? `${args.trim()} ¯\\_(ツ)_/¯` : '¯\\_(ツ)_/¯';
        return {type: 'message', text};
    }
};

export const tableflipCommand: CommandDefinition = {
    name: 'tableflip',
    description: 'Append a table flip to your message',
    usage: '/tableflip [message]',
    category: 'chat',
    handler: async (args) => {
        const text = args.trim()
            ? `${args.trim()} (╯°□°)╯︵ ┻━┻`
            : '(╯°□°)╯︵ ┻━┻';
        return {type: 'message', text};
    }
};

export const unflipCommand: CommandDefinition = {
    name: 'unflip',
    description: 'Put the table back',
    usage: '/unflip [message]',
    category: 'chat',
    handler: async (args) => {
        const text = args.trim()
            ? `${args.trim()} ┬─┬ノ( º _ ºノ)`
            : '┬─┬ノ( º _ ºノ)';
        return {type: 'message', text};
    }
};

export const CHAT_COMMANDS: CommandDefinition[] = [
    meCommand,
    shrugCommand,
    tableflipCommand,
    unflipCommand
];
