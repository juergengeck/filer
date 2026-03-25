/**
 * STT (Speech-to-Text) Recipe for ONE.core
 *
 * Defines the schema for STT model configuration objects (Whisper, etc.).
 * Model weights are stored as blobs and referenced here.
 */

export const STTRecipe = {
    $type$: 'Recipe' as const,
    name: 'STT',
    rule: [
        {
            itemprop: '$type$',
            itemtype: { type: 'string', regexp: /^STT$/ }
        },
        // Model identifier (e.g., 'whisper-tiny', 'whisper-base')
        {
            itemprop: 'name',
            itemtype: { type: 'string' },
            isId: true
        },
        // HuggingFace repository (e.g., 'onnx-community/whisper-tiny')
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
        // Sample rate expected for input audio (e.g., 16000)
        {
            itemprop: 'sampleRate',
            itemtype: { type: 'number' }
        },
        // Supported languages (ISO 639-1 codes)
        {
            itemprop: 'languages',
            itemtype: {
                type: 'array',
                item: { type: 'string' }
            },
            optional: true
        },
        // Whether the model supports translation
        {
            itemprop: 'supportsTranslation',
            itemtype: { type: 'boolean' },
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
        // Model architecture (e.g., 'whisper', 'wav2vec2')
        {
            itemprop: 'architecture',
            itemtype: { type: 'string' },
            optional: true
        },
        // Model size variant (e.g., 'tiny', 'base', 'small', 'medium', 'large')
        {
            itemprop: 'sizeVariant',
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
                    regexp: /^(multilingual|translation|timestamps|streaming)$/
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
