import type {SHA256IdHash} from '@refinio/one.core/lib/util/type-checks.js';

export type CommandCategory = 'chat' | 'topic' | 'user' | 'system' | 'custom';

export interface CommandContext {
    topicId: SHA256IdHash;
    userId: SHA256IdHash;
    sendMessage: (text: string) => Promise<void>;
    navigateTo?: (path: string) => void;
}

export type CommandResult =
    | {type: 'message'; text: string}
    | {type: 'action'; performed: true}
    | {type: 'error'; message: string};

export type CommandHandler = (
    args: string,
    context: CommandContext
) => Promise<CommandResult>;

export interface CommandDefinition {
    /** Command name without leading / (e.g., "me", "shrug") */
    name: string;
    /** Human-readable description shown in autocomplete and /help */
    description: string;
    /** Usage example (e.g., "/me <action>") */
    usage: string;
    /** Category for grouping in autocomplete */
    category: CommandCategory;
    /** Handler function to execute the command */
    handler: CommandHandler;
    /** Optional: delegate execution to a Plan by ID */
    planId?: string;
}

/**
 * Central registry for slash commands.
 * Packages register commands at init time.
 * Singleton - use CommandRegistry.instance.
 */
export class CommandRegistry {
    private static _instance: CommandRegistry | undefined;
    private commands = new Map<string, CommandDefinition>();

    static get instance(): CommandRegistry {
        if (!CommandRegistry._instance) {
            CommandRegistry._instance = new CommandRegistry();
        }
        return CommandRegistry._instance;
    }

    /**
     * Register a command. Replaces existing command with same name.
     */
    register(command: CommandDefinition): void {
        this.commands.set(command.name.toLowerCase(), command);
    }

    /**
     * Unregister a command by name.
     */
    unregister(name: string): void {
        this.commands.delete(name.toLowerCase());
    }

    /**
     * Get a command by exact name.
     */
    getCommand(name: string): CommandDefinition | undefined {
        return this.commands.get(name.toLowerCase());
    }

    /**
     * Get all registered commands.
     */
    getAllCommands(): CommandDefinition[] {
        return Array.from(this.commands.values());
    }

    /**
     * Search commands by prefix match on name.
     */
    search(query: string): CommandDefinition[] {
        const q = query.toLowerCase();
        return this.getAllCommands().filter(
            cmd => cmd.name.toLowerCase().startsWith(q)
        );
    }

    /**
     * Parse a raw input string into command name + args.
     * Returns undefined if input doesn't start with /.
     */
    static parse(input: string): {name: string; args: string} | undefined {
        const trimmed = input.trim();
        if (!trimmed.startsWith('/')) {
            return undefined;
        }
        const withoutSlash = trimmed.slice(1);
        const spaceIndex = withoutSlash.indexOf(' ');
        if (spaceIndex === -1) {
            return {name: withoutSlash, args: ''};
        }
        return {
            name: withoutSlash.slice(0, spaceIndex),
            args: withoutSlash.slice(spaceIndex + 1).trim()
        };
    }

    /**
     * Execute a command by raw input string.
     */
    async execute(
        input: string,
        context: CommandContext
    ): Promise<CommandResult> {
        const parsed = CommandRegistry.parse(input);
        if (!parsed) {
            return {type: 'error', message: 'Not a command'};
        }

        const command = this.getCommand(parsed.name);
        if (!command) {
            return {
                type: 'error',
                message: `Unknown command: /${parsed.name}. Type /help for available commands.`
            };
        }

        return command.handler(parsed.args, context);
    }

    /**
     * Reset the registry (for testing).
     */
    clear(): void {
        this.commands.clear();
    }
}
