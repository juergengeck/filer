import type {CommandDefinition} from '../CommandRegistry.js';

export const clearCommand: CommandDefinition = {
    name: 'clear',
    description: 'Clear the local chat view (messages are not deleted)',
    usage: '/clear',
    category: 'topic',
    handler: async (_args, _context) => {
        // The UI layer listens for this result type and clears the view
        return {type: 'action', performed: true};
    }
};

export const TOPIC_COMMANDS: CommandDefinition[] = [clearCommand];
