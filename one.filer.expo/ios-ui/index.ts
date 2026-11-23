import type Model from '../src/runtime/Model';

export {default as Model} from '../src/runtime/Model';
export type {default as ModelType} from '../src/runtime/Model';

let globalModel: Model | null = null;

export function setGlobalModel(model: Model): void {
    globalModel = model;
}

export function getModel(): Model | null {
    return globalModel;
}

export {ModelProvider, useModel} from './hooks/ModelContext';
