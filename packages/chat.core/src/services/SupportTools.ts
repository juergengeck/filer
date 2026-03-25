// packages/chat.core/src/services/SupportTools.ts
import {CommandRegistry} from './CommandRegistry.js';

export interface MCPToolDefinition {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
}

/**
 * MCP tool definitions for AI support of message entry features.
 * These tools let the AI agent query available commands, emoji, etc.
 */
export class SupportTools {
    getToolDefinitions(): MCPToolDefinition[] {
        return [
            {
                name: 'support:commands',
                description:
                    'List or search available slash commands. Returns command names, descriptions, and usage.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description:
                                'Optional search query to filter commands by name'
                        }
                    }
                }
            },
            {
                name: 'support:help',
                description:
                    'Get general help text about message entry features including commands, emoji shortcodes, icons, and input history.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            }
        ];
    }

    async executeTool(
        toolName: string,
        params: Record<string, unknown>
    ): Promise<{content: Array<{type: string; text: string}>}> {
        switch (toolName) {
            case 'support:commands':
                return this.handleCommands(params);
            case 'support:help':
                return this.handleHelp();
            default:
                throw new Error(`Unknown support tool: ${toolName}`);
        }
    }

    private handleCommands(params: Record<string, unknown>): {
        content: Array<{type: string; text: string}>;
    } {
        const registry = CommandRegistry.instance;
        const query = (params.query as string) ?? '';

        const commands = query
            ? registry.search(query)
            : registry.getAllCommands();

        const text = commands
            .map(
                cmd =>
                    `/${cmd.name} - ${cmd.description} (Usage: ${cmd.usage})`
            )
            .join('\n');

        return {
            content: [
                {
                    type: 'text',
                    text: text || 'No commands found.'
                }
            ]
        };
    }

    private handleHelp(): {
        content: Array<{type: string; text: string}>;
    } {
        const registry = CommandRegistry.instance;
        const commands = registry.getAllCommands();

        const text = `# Message Entry Features

## Slash Commands
Type / followed by a command name. Available commands:
${commands.map(c => `- ${c.usage} - ${c.description}`).join('\n')}

## Emoji Shortcodes
Type : followed by an emoji name (e.g., :smile:, :rocket:, :thumbsup:).
An autocomplete popup will appear to help you find the right emoji.
Recently used emoji appear at the top.

## Icon Shortcodes
Type :icon- followed by an icon name (e.g., :icon-home:, :icon-check:).
Icons use the Lucide icon set.

## Input History
Press Arrow Up to recall previously sent messages.
Press Arrow Down to return to newer messages or your current draft.
History is saved per conversation and syncs across devices.

## Settings
Customize commands, emoji, and icons in Settings > Chat > Customization.
`;

        return {content: [{type: 'text', text}]};
    }
}
