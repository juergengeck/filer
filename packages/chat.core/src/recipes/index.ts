/**
 * Central recipe registry for chat.core
 * All ONE.core recipes that need to be registered
 *
 * NOTE: Topic recipe is defined in one.models/src/recipes/ChatRecipes.ts
 * and is registered there. Do not duplicate here.
 *
 * @see docs/designs/STORY-CUBE-CHAT-ARCHITECTURE.md
 */

import { LLMRecipe } from './LLMRecipe.js';
import { TTSRecipe } from './TTSRecipe.js';
import { STTRecipe } from './STTRecipe.js';
import { ChatMessageRecipe } from './ChatMessageRecipe.js';
import { InputHistoryRecipe } from './InputHistoryRecipe.js';
import {
    ChatTrieNodeRecipe,
    ChatTrieRootRecipe,
    ChatTrieEntryRecipe,
    TopicTrieNodeRecipe,
    TopicTrieRootRecipe,
    SubjectTrieNodeRecipe,
    SubjectTrieRootRecipe,
    SubjectRangeRecipe
} from './ChatTrieRecipes.js';
import { TimeTrieRecipes } from '@refinio/trie.core';

/**
 * All recipes that need to be registered with ONE.core
 * Pass this array to registerRecipes() during initialization
 *
 * NOTE: Topic recipe is NOT included here - it's in one.models
 */
export const CHAT_CORE_RECIPES = [
    // Chat messaging recipes (Story + Cube architecture)
    ChatMessageRecipe,
    // LLM/AI recipes
    LLMRecipe,
    TTSRecipe,
    STTRecipe,
    // Input history
    InputHistoryRecipe,
    // ChatTrie persistence (sync + time)
    ChatTrieNodeRecipe,
    ChatTrieRootRecipe,
    ChatTrieEntryRecipe,
    TopicTrieNodeRecipe,
    TopicTrieRootRecipe,
    SubjectTrieNodeRecipe,
    SubjectTrieRootRecipe,
    SubjectRangeRecipe,
    // TimeTrie structural nodes (shared — used by PresenceTrie in glue.core)
    ...TimeTrieRecipes
];

// Re-export individual recipes for convenience
export {
    ChatMessageRecipe,
    LLMRecipe,
    TTSRecipe,
    STTRecipe,
    InputHistoryRecipe,
    ChatTrieNodeRecipe,
    ChatTrieRootRecipe,
    ChatTrieEntryRecipe,
    TopicTrieNodeRecipe,
    TopicTrieRootRecipe,
    SubjectTrieNodeRecipe,
    SubjectTrieRootRecipe,
    SubjectRangeRecipe
};

// Re-export types
export type { ChatMessage } from './ChatMessageRecipe.js';
export type {
    ChatTrieNode,
    ChatTrieRoot,
    ChatTrieEntry,
    TopicTrieNode,
    TopicTrieRoot,
    SubjectTrieNode,
    SubjectTrieRoot,
    SubjectRange
} from './ChatTrieRecipes.js';
// Topic type is from one.models - re-export for convenience
export type { Topic, TopicAISettings } from '@refinio/one.models/lib/recipes/ChatRecipes.js';
