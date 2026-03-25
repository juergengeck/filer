/**
 * Plan Metadata Interface
 *
 * Defines static metadata properties that Plans can expose
 * for runtime introspection, documentation, and IPC registration.
 *
 * Usage:
 * ```typescript
 * export class ChatPlan implements Plan {
 *   static get name(): string { return 'Chat'; }
 *   static get description(): string { return 'Manages chat conversations'; }
 *   static get version(): string { return '1.0.0'; }
 *   // ... plan implementation
 * }
 * ```
 */

/**
 * Plan interface - defines the contract for plan metadata
 */
export interface Plan {
  /**
   * Plan name (short, used for identification)
   * Example: "Chat", "Contacts", "AI"
   */
  name: string;

  /**
   * Plan description (concise explanation of functionality)
   * Example: "Manages chat conversations and messages"
   */
  description: string;

  /**
   * Semantic version number
   * Example: "1.0.0"
   */
  version: string;
}

/**
 * Method-level metadata for plan operations
 */
export interface PlanMethodMetadata {
  /**
   * Description of what the method does
   */
  description: string;

  /**
   * Optional category for grouping methods
   * Example: "messaging", "query", "configuration"
   */
  category?: string;

  /**
   * Optional deprecation notice
   */
  deprecated?: string;
}

/**
 * Extended plan interface with method-level metadata
 */
export interface PlanWithMethods extends Plan {
  /**
   * Method-level metadata
   */
  methods?: Record<string, PlanMethodMetadata>;
}
