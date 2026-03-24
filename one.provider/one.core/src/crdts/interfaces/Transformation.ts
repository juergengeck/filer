export interface Transformation {
    op: 'add' | 'remove' | 'set' | 'delete';
    key?: string;
    value?: string;
}
