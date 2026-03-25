/**
 * A single item in the autocomplete popup.
 */
export interface AutocompleteItem {
    /** Unique identifier for this item */
    id: string;
    /** Display label (e.g., "smile", "/me") */
    label: string;
    /** Optional description shown beside label */
    description?: string;
    /** Preview image URL (SVG/PNG) or inline SVG string */
    icon?: string;
    /** Category for grouping (e.g., "Recently Used", "Smileys", "Chat Actions") */
    category?: string;
    /** Text to insert or command to match (e.g., ":smile:", "/me") */
    shortcode: string;
}

/**
 * Action returned when an autocomplete item is selected.
 */
export type InputAction =
    | { type: 'insert'; text: string }
    | { type: 'execute'; command: string; args: string }
    | { type: 'replace'; text: string };

/**
 * Provider interface for autocomplete sources.
 * Each provider handles one trigger character.
 */
export interface AutocompleteProvider {
    /** Character that activates this provider (e.g., ":", "/") */
    trigger: string;
    /** Return filtered results for the given query (text after trigger) */
    getResults(query: string): AutocompleteItem[];
    /** Called when user selects an item. Returns the action to perform. */
    onSelect(item: AutocompleteItem, currentText: string): InputAction;
    /** Optional: priority for ordering when multiple providers share a trigger (lower = first) */
    priority?: number;
}
