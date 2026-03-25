import {CommandRegistry, type CommandDefinition} from '../CommandRegistry.js';

export const helpCommand: CommandDefinition = {
    name: 'help',
    description: 'List all available commands',
    usage: '/help [command]',
    category: 'system',
    handler: async (args) => {
        const registry = CommandRegistry.instance;

        if (args.trim()) {
            const cmd = registry.getCommand(args.trim());
            if (!cmd) {
                return {
                    type: 'error',
                    message: `Unknown command: /${args.trim()}`
                };
            }
            return {
                type: 'message',
                text: `**/${cmd.name}** - ${cmd.description}\nUsage: \`${cmd.usage}\``
            };
        }

        const commands = registry.getAllCommands();
        const byCategory = new Map<string, CommandDefinition[]>();
        for (const cmd of commands) {
            const list = byCategory.get(cmd.category) ?? [];
            list.push(cmd);
            byCategory.set(cmd.category, list);
        }

        const categoryLabels: Record<string, string> = {
            chat: 'Chat Actions',
            topic: 'Topic Management',
            user: 'User',
            system: 'System',
            custom: 'Custom'
        };

        let text = '**Available Commands:**\n\n';
        for (const [category, cmds] of byCategory) {
            text += `**${categoryLabels[category] ?? category}**\n`;
            for (const cmd of cmds) {
                text += `  \`${cmd.usage}\` - ${cmd.description}\n`;
            }
            text += '\n';
        }

        return {type: 'message', text};
    }
};

export const SYSTEM_COMMANDS: CommandDefinition[] = [helpCommand];
