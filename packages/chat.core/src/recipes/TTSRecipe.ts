/**
 * TTS (Text-to-Speech) Recipe for ONE.core
 *
 * Defines the schema for TTS model configuration objects.
 * Model weights are stored as blobs and referenced here.
 */

export const TTSRecipe = {
    $type$: 'Recipe' as const,
    name: 'TTS',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^TTS$/ }
        },
        // Model identifier (e.g., 'chatterbox', 'chatterbox-turbo')
        {
            itemprop: 'name',
            itemtype: { type: 'string' },
            isId: true
        },
        // HuggingFace repository (e.g., 'onnx-community/chatterbox-ONNX')
        {
            itemprop: 'huggingFaceRepo',
            itemtype: { type: 'string' }
        },
        // Display name for UI
        {
            itemprop: 'displayName',
            itemtype: { type: 'string' },
            optional: true
        },
        // Model type: 'local' (on-device) or 'remote' (API-based)
        {
            itemprop: 'modelType',
            itemtype: {
                type: 'string',
                regexp: /^(local|remote)$/
            }
        },
        // Sample rate of audio output (e.g., 24000)
        {
            itemprop: 'sampleRate',
            itemtype: { type: 'number' }
        },
        // Whether voice cloning requires reference audio
        {
            itemprop: 'requiresReferenceAudio',
            itemtype: { type: 'boolean' },
            optional: true
        },
        // Default voice audio URL (for models that support voice cloning)
        {
            itemprop: 'defaultVoiceUrl',
            itemtype: { type: 'string' },
            optional: true
        },
        // Installation status
        {
            itemprop: 'status',
            itemtype: {
                type: 'string',
                regexp: /^(not_installed|downloading|installed|loading|ready|error)$/
            }
        },
        // Total size in bytes of all model files
        {
            itemprop: 'sizeBytes',
            itemtype: { type: 'number' },
            optional: true
        },
        // Download progress (0-100)
        {
            itemprop: 'downloadProgress',
            itemtype: { type: 'number' },
            optional: true
        },
        // Error message if status is 'error'
        {
            itemprop: 'errorMessage',
            itemtype: { type: 'string' },
            optional: true
        },
        // Blob references for model files (ONNX weights, tokenizer, etc.)
        // Each file is stored as a separate blob
        {
            itemprop: 'modelBlobs',
            itemtype: {
                type: 'array',
                item: {
                    type: 'referenceToBlob'
                }
            },
            optional: true
        },
        // Blob metadata (filename -> blob hash mapping as JSON)
        {
            itemprop: 'blobMetadata',
            itemtype: { type: 'string' },
            optional: true
        },
        // Provider name (e.g., 'transformers.js', 'onnx-runtime')
        {
            itemprop: 'provider',
            itemtype: { type: 'string' },
            optional: true
        },
        // Model architecture (e.g., 'chatterbox', 'vits')
        {
            itemprop: 'architecture',
            itemtype: { type: 'string' },
            optional: true
        },
        // Capabilities
        {
            itemprop: 'capabilities',
            itemtype: {
                type: 'array',
                item: {
                    type: 'string',
                    regexp: /^(voice-cloning|multilingual|streaming)$/
                }
            },
            optional: true
        },
        // Owner (person who downloaded/owns this model)
        {
            itemprop: 'owner',
            itemtype: {
                type: 'referenceToId',
                allowedTypes: new Set(['Person', 'Instance'])
            },
            optional: true
        },
        // Timestamps
        {
            itemprop: 'created',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'modified',
            itemtype: { type: 'number' }
        },
        {
            itemprop: 'lastUsed',
            itemtype: { type: 'number' },
            optional: true
        },
        {
            itemprop: 'usageCount',
            itemtype: { type: 'number' },
            optional: true
        },
        // Soft delete flag
        {
            itemprop: 'deleted',
            itemtype: { type: 'boolean' },
            optional: true
        }
    ]
};
