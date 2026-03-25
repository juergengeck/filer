export interface ChatTrieEmbeddingEstimate {
    vectorCount: number;
    dimensions: number;
    bytesPerDimension: number;
    estimatedBytes: number;
    model?: string;
    abstractionLevel?: number;
}

export interface ChatTrieEmbeddingEstimateInput {
    vectorCount?: number;
    dimensions: number;
    bytesPerDimension?: number;
    estimatedBytes?: number;
    model?: string;
    abstractionLevel?: number;
}

export interface ChatTrieEmbeddingEstimateSummary {
    entryCount: number;
    entriesWithEstimates: number;
    embeddingCount: number;
    estimatedBytes: number;
    maxDimensions: number;
    modelIds: string[];
    abstractionLevels: number[];
}

export function createChatTrieEmbeddingEstimate(
    input: ChatTrieEmbeddingEstimateInput
): ChatTrieEmbeddingEstimate {
    const vectorCount = Number.isInteger(input.vectorCount) && Number(input.vectorCount) > 0
        ? Number(input.vectorCount)
        : 1;
    const dimensions = Number(input.dimensions);
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new Error(`Embedding estimate dimensions must be a positive integer: ${input.dimensions}`);
    }

    const bytesPerDimension = input.bytesPerDimension === undefined
        ? 4
        : Number(input.bytesPerDimension);
    if (!Number.isFinite(bytesPerDimension) || bytesPerDimension <= 0) {
        throw new Error(`Embedding estimate bytesPerDimension must be > 0: ${input.bytesPerDimension}`);
    }

    const estimatedBytes = input.estimatedBytes === undefined
        ? Math.ceil(vectorCount * dimensions * bytesPerDimension)
        : Number(input.estimatedBytes);
    if (!Number.isFinite(estimatedBytes) || estimatedBytes < 0) {
        throw new Error(`Embedding estimate estimatedBytes must be >= 0: ${input.estimatedBytes}`);
    }

    return {
        vectorCount,
        dimensions,
        bytesPerDimension,
        estimatedBytes,
        ...(String(input.model || '').trim() ? {model: String(input.model).trim()} : {}),
        ...(typeof input.abstractionLevel === 'number' && Number.isFinite(input.abstractionLevel)
            ? {abstractionLevel: input.abstractionLevel}
            : {})
    };
}

export function summarizeChatTrieEmbeddingEstimates(
    entries: Array<{embeddingEstimate?: ChatTrieEmbeddingEstimate | null | undefined}>
): ChatTrieEmbeddingEstimateSummary {
    const modelIds = new Set<string>();
    const abstractionLevels = new Set<number>();
    let entriesWithEstimates = 0;
    let embeddingCount = 0;
    let estimatedBytes = 0;
    let maxDimensions = 0;

    for (const entry of entries) {
        const estimate = entry.embeddingEstimate;
        if (!estimate) {
            continue;
        }

        entriesWithEstimates += 1;
        embeddingCount += estimate.vectorCount;
        estimatedBytes += estimate.estimatedBytes;
        maxDimensions = Math.max(maxDimensions, estimate.dimensions);
        if (estimate.model) {
            modelIds.add(estimate.model);
        }
        if (typeof estimate.abstractionLevel === 'number') {
            abstractionLevels.add(estimate.abstractionLevel);
        }
    }

    return {
        entryCount: entries.length,
        entriesWithEstimates,
        embeddingCount,
        estimatedBytes,
        maxDimensions,
        modelIds: [...modelIds].sort(),
        abstractionLevels: [...abstractionLevels].sort((left, right) => left - right)
    };
}
