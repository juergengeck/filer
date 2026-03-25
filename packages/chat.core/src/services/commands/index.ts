import {CommandRegistry} from '../CommandRegistry.js';
import {CHAT_COMMANDS} from './ChatCommands.js';
import {SYSTEM_COMMANDS} from './SystemCommands.js';
import {TOPIC_COMMANDS} from './TopicCommands.js';

export {CHAT_COMMANDS} from './ChatCommands.js';
export {SYSTEM_COMMANDS} from './SystemCommands.js';
export {TOPIC_COMMANDS} from './TopicCommands.js';

/**
 * Register all built-in commands.
 * Call once at app startup.
 */
export function registerBuiltinCommands(): void {
    const registry = CommandRegistry.instance;
    for (const cmd of [...CHAT_COMMANDS, ...TOPIC_COMMANDS, ...SYSTEM_COMMANDS]) {
        registry.register(cmd);
    }
}
