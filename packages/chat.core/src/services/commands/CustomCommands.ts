// packages/chat.core/src/services/commands/CustomCommands.ts
import {CommandRegistry, type CommandDefinition} from '../CommandRegistry.js';

export interface CustomShortcut {
    /** Command name (without /) */
    name: string;
    /** What it expands to (can be another /command or text) */
    expansion: string;
    /** Description for help/autocomplete */
    description: string;
}

/**
 * Manages user-defined custom command shortcuts.
 * Shortcuts can expand to other commands or insert text.
 */
export class CustomCommands {
    private shortcuts: CustomShortcut[] = [];

    /**
     * Load custom shortcuts from settings and register them.
     */
    loadShortcuts(shortcuts: CustomShortcut[]): void {
        // Unregister old custom commands
        for (const shortcut of this.shortcuts) {
            CommandRegistry.instance.unregister(shortcut.name);
        }

        this.shortcuts = shortcuts;

        // Register new ones
        for (const shortcut of shortcuts) {
            const definition: CommandDefinition = {
                name: shortcut.name,
                description: shortcut.description || `Custom: ${shortcut.expansion}`,
                usage: `/${shortcut.name}`,
                category: 'custom',
                handler: async (args, context) => {
                    const expansion = shortcut.expansion;
                    // If expansion is another command, execute it
                    if (expansion.startsWith('/')) {
                        const fullCommand = args
                            ? `${expansion} ${args}`
                            : expansion;
                        return CommandRegistry.instance.execute(
                            fullCommand,
                            context
                        );
                    }
                    // Otherwise, send as text
                    return {type: 'message', text: expansion};
                }
            };

            CommandRegistry.instance.register(definition);
        }
    }

    getShortcuts(): CustomShortcut[] {
        return [...this.shortcuts];
    }
}
