import {getCurrentVersionNode} from '../storage-versioned-objects.js';
import type {Transformation} from './interfaces/Transformation.js';
import {createMessageBus} from '../message-bus.js';
import {getRecipe} from '../object-recipes.js';
import type {OneObjectTypeNames, RecipeRule, ValueType, VersionNodeEdge} from '../recipes.js';
import type {
    OneObjectTypes,
    OneVersionedObjectTypes,
    VersionNodeChange,
    VersionNodeMerge
} from '../recipes.js';
import type {VersionNode} from '../recipes.js';
import {getObject} from '../storage-unversioned-objects.js';
import {arrayMax} from '../util/array.js';
import {diffObjects} from './diff-objects.js';
import {isInteger, isNumber, isObject, isString} from '../util/type-checks-basic.js';
import {isHash} from '../util/type-checks.js';
import type {SHA256Hash, SHA256IdHash} from '../util/type-checks.js';

const MessageBus = createMessageBus('VersionTree');

export interface MergeGraphNode<T = OneVersionedObjectTypes> {
    type: 'merge';
    hash: SHA256Hash<VersionNodeMerge>;
    obj: VersionNodeMerge;
    depth: number;
    data: T;
    dataType?: OneObjectTypeNames;
    predecessors: number[];
    successors: number[];
}

export interface ChangeGraphNode<
    T = OneVersionedObjectTypes,
    DiffT = Map<string, Transformation[]>
> {
    type: 'change';
    hash: SHA256Hash<VersionNodeChange>;
    obj: VersionNodeChange;
    depth: number;
    data: T;
    dataType?: OneObjectTypeNames;
    predecessor?: number;
    predecessorDiff: DiffT;
    successors: number[];
}

export interface RootGraphNode<T = OneVersionedObjectTypes, DiffT = Map<string, Transformation[]>> {
    type: 'root';
    hash: SHA256Hash<VersionNodeEdge>;
    obj: VersionNodeEdge;
    depth: number;
    data: T;
    dataType?: OneObjectTypeNames;
    predecessor?: number;
    predecessorDiff: DiffT;
    successors: number[];
}

export interface EmptyGraphNode {
    type: 'empty';
    depth: -1;
    successors: number[];
}

export type GraphNode<T = OneVersionedObjectTypes, DiffT = Map<string, Transformation[]>> =
    | MergeGraphNode<T>
    | ChangeGraphNode<T, DiffT>
    | RootGraphNode<T, DiffT>
    | EmptyGraphNode;

export type GraphNodeNoEmpty<T = OneVersionedObjectTypes, DiffT = Map<string, Transformation[]>> =
    | MergeGraphNode<T>
    | ChangeGraphNode<T, DiffT>
    | RootGraphNode<T, DiffT>;

export class ChildVersionTree<T = OneVersionedObjectTypes, DiffT = Map<string, Transformation[]>> {
    protected firstMergeNodeP: GraphNodeNoEmpty<T, DiffT>;
    protected secondMergeNodeP: GraphNodeNoEmpty<T, DiffT>;
    readonly path: string;
    readonly parentVersionTree: VersionTree;

    // Nodes are sorted by depth in tree (descending order)
    protected nodes: Array<GraphNode<T, DiffT>>;
    protected hashToNodeIndex: Map<SHA256Hash | 'empty', number>;

    get firstMergeNode(): GraphNodeNoEmpty<T, DiffT> {
        return this.firstMergeNodeP;
    }
    get secondMergeNode(): GraphNodeNoEmpty<T, DiffT> {
        return this.secondMergeNodeP;
    }

    protected constructor(
        firstMergeNode: GraphNode<T, DiffT>,
        secondMergeNode: GraphNode<T, DiffT>,
        path: string,
        parentVersionTree?: VersionTree,
        nodes: Array<GraphNode<T, DiffT>> = [],
        hashToNodeIndex: Map<SHA256Hash | 'empty', number> = new Map()
    ) {
        if (firstMergeNode.type === 'empty') {
            throw new Error('firstMergeNote is not allowed to be empty');
        }

        if (secondMergeNode.type === 'empty') {
            throw new Error('secondMergeNote is not allowed to be empty');
        }

        this.firstMergeNodeP = firstMergeNode;
        this.secondMergeNodeP = secondMergeNode;
        this.path = path;
        this.nodes = nodes;
        this.hashToNodeIndex = hashToNodeIndex;

        if (this instanceof VersionTree) {
            this.parentVersionTree = parentVersionTree || this;
        } else {
            if (parentVersionTree === undefined) {
                throw new Error(
                    'Parent version tree needs to be set if it is not the parent version tree'
                );
            }
            this.parentVersionTree = parentVersionTree;
        }
    }

    // #### Query nodes ####

    get commonHistoryNode(): GraphNode<T, DiffT> {
        return this.nodes[this.nodes.length - 1];
    }

    get allNodes(): Array<GraphNode<T, DiffT>> {
        return [...this.nodes];
    }

    node(i: number): GraphNode<T, DiffT> {
        if (i >= this.nodes.length) {
            throw new Error('Node index does not exist');
        }

        return this.nodes[i];
    }

    nodeByHash(hash: SHA256Hash<VersionNode> | 'empty'): GraphNode<T, DiffT> {
        const i = this.hashToNodeIndex.get(hash);

        if (i === undefined) {
            throw new Error('No node for specified hash found');
        }

        return this.node(i);
    }

    nodeIndexByNode(node: GraphNode<T, DiffT>): number {
        const index = this.hashToNodeIndex.get(node.type === 'empty' ? 'empty' : node.hash);

        if (index === undefined) {
            throw new Error('Passed graph node is not managed by this version tree');
        }

        return index;
    }

    nodeIndexByHash(hash: SHA256Hash<VersionNode> | 'empty'): number | undefined {
        return this.hashToNodeIndex.get(hash);
    }

    hasNode(hash: SHA256Hash<VersionNode> | 'empty'): boolean {
        return this.hashToNodeIndex.has(hash);
    }

    /**
     * From the specified node traverse all branches backwards, until you find a matching node.
     *
     * Stops following a branch when a matching node was found. Parallel branches will still
     * be followed until no branch is left, so it might return multiple values.
     *
     * @param {GraphNode} node
     * @param {function(GraphNode):boolean} predicate - only nodes that match the predicate are
     * evaluated, those that do not match are traversed but not considered a predesessor.
     * @param {boolean} includeCurrentNode
     * @returns {(ChangeGraphNode | RootGraphNode)[]}
     */
    findPredecessingNodesRootOrChangeOnly(
        node: GraphNode<T, DiffT>,
        predicate: (n: ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT>) => boolean,
        includeCurrentNode = true
    ): Array<ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT>> {
        return this.findPredecessingNodes(
            node,
            n => {
                if (n.type === 'root' || n.type === 'change') {
                    return predicate(n);
                } else {
                    return false;
                }
            },
            includeCurrentNode
        ) as Array<ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT>>;
    }

    /**
     * From the specified node traverse all branches forward, until you find a matching node.
     *
     * Stops following a branch when a matching node was found. Parallel branches will still
     * be followed until no branch is left, so it might return multiple values.
     *
     * @param {GraphNode} node
     * @param {function(RootGraphNode | ChangeGraphNode):boolean} predicate
     * @param {boolean} includeCurrentNode
     * @returns {Array<RootGraphNode | ChangeGraphNode>}
     */
    findSucceedingNodesChangeOrRootOnly(
        node: GraphNode<T, DiffT>,
        predicate: (n: RootGraphNode<T, DiffT> | ChangeGraphNode<T, DiffT>) => boolean,
        includeCurrentNode = true
    ): Array<RootGraphNode<T, DiffT> | ChangeGraphNode<T, DiffT>> {
        return this.findSucceedingNodes(
            node,
            n => {
                if (n.type === 'root' || n.type === 'change') {
                    return predicate(n);
                } else {
                    return false;
                }
            },
            includeCurrentNode
        ) as Array<RootGraphNode<T, DiffT> | ChangeGraphNode<T, DiffT>>;
    }

    /**
     * From the specified node traverse all branches backwards, until you find a matching node.
     *
     * Stops following a branch when a matching node was found. Parallel branches will still
     * be followed until no branch is left, so it might return multiple values.
     *
     * @param {GraphNode} node
     * @param {function(GraphNode):boolean} predicate - only nodes that match the predicate are
     * evaluated, those that do not match are traversed but not considered a predesessor.
     * @param {boolean} includeCurrentNode
     * @returns {Array<GraphNode>}
     */
    findPredecessingNodes(
        node: GraphNode<T, DiffT>,
        predicate: (n: GraphNode<T, DiffT>) => boolean,
        includeCurrentNode = true
    ): Array<GraphNode<T, DiffT>> {
        if (includeCurrentNode && predicate(node)) {
            return [node];
        }

        const nodes = [];

        // Find the node of all the parallel branches, that has the set with the most value
        // (most recent)
        if (node.type === 'merge') {
            for (const predecessor of node.predecessors) {
                nodes.push(...this.findPredecessingNodes(this.node(predecessor), predicate, true));
            }
        }

        // Continue iterating if no operation was found. If operation was found stop iterating.
        if (node.type === 'change' || node.type === 'root') {
            if (node.predecessor !== undefined) {
                nodes.push(
                    ...this.findPredecessingNodes(this.node(node.predecessor), predicate, true)
                );
            }
        }

        return nodes;
    }

    /**
     * From the specified node traverse all branches forward, until you find a matching node.
     *
     * Stops following a branch when a matching node was found. Parallel branches will still
     * be followed until no branch is left, so it might return multiple values.
     *
     * @param {GraphNode} node
     * @param {function(GraphNode):boolean} predicate
     * @param {boolean} includeCurrentNode
     * @returns {Array<GraphNode>}
     */
    findSucceedingNodes(
        node: GraphNode<T, DiffT>,
        predicate: (n: GraphNode<T, DiffT>) => boolean,
        includeCurrentNode = true
    ): Array<GraphNode<T, DiffT>> {
        if (includeCurrentNode && predicate(node)) {
            return [node];
        }

        const nodes = [];

        for (const successor of node.successors) {
            nodes.push(...this.findSucceedingNodes(this.node(successor), predicate, true));
        }

        return nodes;
    }

    /**
     * Find predecessing nodes that are exclusively reachable directly from the passed node.
     *
     * 'Directly' here means, that you do not need to visit another node that matches the
     * predicate in order to get to this node.
     *
     * FindPredecessingTopLevelNodes is similar to findPredecessingNodes, except that it does
     * not return nodes that can also be reached indirectly. In other words this function will
     * return all directly reachable predecessors that themselves do not have a successor.
     *
     * @param {GraphNode} node
     * @param {function(ChangeGraphNode | RootGraphNode):boolean} predicate
     * @param {boolean} includeCurrentNode
     * @returns {Array<ChangeGraphNode | RootGraphNode>}
     */
    findPredecessingTopLevelNodes(
        node: GraphNode<T, DiffT>,
        predicate: (n: ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT>) => boolean,
        includeCurrentNode = true
    ): Array<ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT>> {
        return this.findPredecessingNodesRootOrChangeOnly(
            node,
            predicate,
            includeCurrentNode
        ).filter((n): boolean => !this.hasSucceedingNodesDepthFirst(n, predicate));
    }

    /**
     * Same as findPredecessingTopLevelNodes, but will only return the node with the highest order.
     *
     * @param {GraphNode} node
     * @param {function(ChangeOrRootGraphNode):boolean} predicate
     * @param {function((RootGraphNode|undefined),(RootGraphNode|undefined)):number} compareFn
     * @returns {Array<ChangeOrRootGraphNode>}
     */
    findMaximumPredecessingTopLevelNode(
        node: GraphNode<T, DiffT>,
        predicate: (n: ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT>) => boolean,
        compareFn: (
            node1: ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT> | undefined,
            node2: ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT> | undefined
        ) => number
    ): ChangeGraphNode<T, DiffT> | RootGraphNode<T, DiffT> | undefined {
        const tlNodes = this.findPredecessingTopLevelNodes(node, predicate);
        return arrayMax(tlNodes, compareFn);
    }

    hasSucceedingNodesDepthFirst(
        node: GraphNode<T, DiffT>,
        predicate: (n: RootGraphNode<T, DiffT>) => boolean
    ): boolean {
        for (const successor of node.successors) {
            const successorNode = this.node(successor);

            if (successorNode.type === 'root') {
                if (predicate(successorNode)) {
                    return true;
                }
            }

            if (this.hasSucceedingNodesDepthFirst(this.node(successor), predicate)) {
                return true;
            }
        }

        return false;
    }

    getStringRepresentationSimple(omitDiff = false, omitData = false): string {
        const lines: string[] = [];

        for (let i = 0; i < this.nodes.length; ++i) {
            const node = this.nodes[i];

            let specialNode = '';

            if (node.type !== 'empty' && node.hash === this.firstMergeNode.hash) {
                specialNode += 'first';
            }

            if (node.type !== 'empty' && node.hash === this.secondMergeNode.hash) {
                if (specialNode.length > 0) {
                    specialNode += ', ';
                }
                specialNode += 'second';
            }

            if (node === this.commonHistoryNode) {
                if (specialNode.length > 0) {
                    specialNode += ', ';
                }
                specialNode += 'common';
            }

            if (specialNode.length > 0) {
                specialNode = ` (${specialNode})`;
            }

            lines.push(
                `${node.type.padEnd(7, ' ')}${
                    node.type === 'empty' ? '' : `${node.hash}, `
                }depth: ${node.depth}, index: ${i}${specialNode}`
            );

            const predecessors = [];

            if ((node.type === 'change' || node.type === 'root') && node.predecessor) {
                predecessors.push(node.predecessor);
            } else if (node.type === 'merge') {
                predecessors.push(...node.predecessors);
            }

            for (const pred of predecessors) {
                const p = this.node(pred);
                lines.push(`  pred ${pred} ${p.type === 'empty' ? 'empty' : p.hash}`);
            }

            for (const succ of node.successors) {
                const s = this.node(succ);
                lines.push(`  succ ${succ} ${s.type === 'empty' ? 'empty' : s.hash}`);
            }

            if (!omitDiff && (node.type === 'change' || node.type === 'root')) {
                if (Array.isArray(node.predecessorDiff)) {
                    const diffs = node.predecessorDiff as Transformation[];
                    lines.push('  diff:');

                    for (const diff of diffs) {
                        lines.push(
                            `    ${diff.op}${
                                diff.key ? ` ${String(diff.key)}` : ''
                            }${diff.value ? ` ${String(diff.value)}` : ''}`
                        );
                    }
                }

                if (node.predecessorDiff instanceof Map) {
                    const pathDiffMap = node.predecessorDiff as Map<string, Transformation[]>;

                    for (const [path, diffs] of pathDiffMap) {
                        lines.push(`  diff ${path}:`);

                        for (const diff of diffs) {
                            lines.push(
                                `    ${diff.op}${
                                    diff.key ? ` ${String(diff.key)}` : ''
                                }${diff.value ? ` ${String(diff.value)}` : ''}`
                            );
                        }
                    }
                }
            }

            if (!omitData && node.type !== 'empty') {
                lines.push('  data:');
                lines.push(`    ${JSON.stringify(node.data)}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Dump tree as string
     *
     * @param {boolean} omitDiff
     * @returns {string}
     */
    getStringRepresentation(omitDiff = false): string {
        const activeBranches = new ActiveBranches();
        const nodeInfos = new Map<number, NodeInfo>();

        function getNodeInfo(i: number): NodeInfo {
            const nodeInfo = nodeInfos.get(i);

            if (nodeInfo === undefined) {
                throw new Error('nodeInfo is undefined');
            }

            return nodeInfo;
        }

        for (let i = 0; i < this.nodes.length; ++i) {
            nodeInfos.set(i, {activeBranches: [], newBranches: [], oldBranches: []});
        }

        for (let i = 0; i < this.nodes.length; ++i) {
            const node = this.nodes[i];
            const nodeInfo = getNodeInfo(i);
            let myBranch = nodeInfo.branch;

            nodeInfo.oldBranches.forEach(b => activeBranches.removeBranch(b));

            // Create new branch for initial nodes (ones without successors)
            if (myBranch === undefined) {
                if (node.successors.length > 0) {
                    throw new Error('Branches with sucessors should have a branch assigned');
                }

                myBranch = activeBranches.insertNewBranchAtEnd();
                nodeInfo.branch = myBranch;
            }

            nodeInfo.activeBranches = [...activeBranches.branches];

            if (i === this.nodes.length - 1) {
                continue;
            }

            // Get predecessors - from all types
            const predecessors =
                node.type === 'merge'
                    ? node.predecessors
                    : (node.type === 'change' || node.type === 'root') &&
                        node.predecessor !== undefined
                      ? [node.predecessor]
                      : [];

            if (predecessors.length === 0) {
                throw new Error('Node has no predecessor which should be impossible');
            }

            // First predecessor pass: check if predecessor is already assigned a branch. In
            // this case get the one with the lowest value in active map
            const predecessorsWithBranch: Array<{
                predecessor: number;
                branch: Branch;
            }> = [];
            const predecessorsWithoutBranch: number[] = [];

            for (const predecessor of predecessors) {
                const branch = getNodeInfo(predecessor).branch;

                if (branch === undefined) {
                    predecessorsWithoutBranch.push(predecessor);
                    continue;
                }

                predecessorsWithBranch.push({
                    predecessor,
                    branch
                });
            }

            if (predecessorsWithoutBranch.length > 0) {
                getNodeInfo(predecessorsWithoutBranch[0]).branch = myBranch;

                for (const predecessor of predecessorsWithoutBranch.slice(1)) {
                    const newBranch = activeBranches.insertNewBranchAfter(myBranch);
                    getNodeInfo(predecessor).branch = newBranch;
                    nodeInfo.newBranches.push(newBranch);
                }
            }

            if (predecessorsWithBranch.length > 0) {
                if (predecessorsWithoutBranch.length === 0) {
                    getNodeInfo(predecessorsWithBranch[0].predecessor).oldBranches.push(myBranch);
                }

                for (const {predecessor, branch} of predecessorsWithBranch.slice(
                    predecessorsWithoutBranch.length === 0 ? 1 : 0
                )) {
                    const otherBranchIndex = activeBranches.index(branch);
                    const myBranchIndex = activeBranches.index(myBranch);

                    const newBranch =
                        otherBranchIndex < myBranchIndex
                            ? activeBranches.insertNewBranchBefore(myBranch)
                            : activeBranches.insertNewBranchAfter(myBranch);

                    getNodeInfo(predecessor).branch = newBranch;
                    getNodeInfo(predecessor).oldBranches.push(newBranch);
                }
            }
        }

        // #### Calculate indentations ####
        const leftmostBranch = getNodeInfo(0).branch;
        let deepestIndentation = 0;

        if (leftmostBranch === undefined) {
            throw new Error('No leftmost branch - should not happen');
        }

        function updateBranchValues(branch: Branch, currentDepth: number): void {
            if (branch.indentation < currentDepth) {
                branch.indentation = currentDepth;
            }

            if (deepestIndentation < currentDepth) {
                deepestIndentation = currentDepth;
            }

            for (const rightBranch of [...branch.rightBranches]) {
                updateBranchValues(rightBranch, currentDepth + 1);
            }
        }

        updateBranchValues(leftmostBranch, 0);

        // #### Calculate visualization ####

        const lines: string[] = [];

        lines.push(`Tree path: '${this.path}' nodes: ${this.nodes.length}`);

        for (let i = 0; i < this.nodes.length; ++i) {
            const node = this.nodes[i];
            const nodeInfo = getNodeInfo(i);

            if (nodeInfo.branch === undefined) {
                throw new Error('visualization: branch is undefined. Should not happen');
            }

            const oldBranchPos = nodeInfo.oldBranches.map(b => b.indentation).sort((a, b) => a - b);
            const activeBranchPos = nodeInfo.activeBranches
                .map(b => b.indentation)
                .sort((a, b) => a - b);
            const newBranchPos = nodeInfo.newBranches.map(b => b.indentation).sort((a, b) => a - b);
            const minBranchPos = Math.min(
                oldBranchPos.length > 0 ? oldBranchPos[0] : Number.MAX_SAFE_INTEGER,
                newBranchPos.length > 0 ? newBranchPos[0] : Number.MAX_SAFE_INTEGER
            );
            const maxBranchPos = Math.max(
                oldBranchPos.length > 0
                    ? oldBranchPos[oldBranchPos.length - 1]
                    : Number.MIN_SAFE_INTEGER,
                newBranchPos.length > 0
                    ? newBranchPos[newBranchPos.length - 1]
                    : Number.MIN_SAFE_INTEGER
            );

            const alternativePrint = true;

            let oldBranchesStr = '';
            let prefix = '';
            let newBranchesStr = '';
            let diffPrefix = '';

            for (let j = 0; j <= deepestIndentation; ++j) {
                if (alternativePrint) {
                    if (oldBranchPos.includes(j)) {
                        oldBranchesStr += nodeInfo.branch.indentation < j ? '/ ' : '\\ ';
                    } else if (activeBranchPos.includes(j)) {
                        oldBranchesStr += '| ';
                    } else {
                        oldBranchesStr += '  ';
                    }

                    if (j === nodeInfo.branch.indentation) {
                        prefix += `${
                            node.type === 'change'
                                ? 'C'
                                : node.type === 'merge'
                                  ? 'M'
                                  : node.type === 'root'
                                    ? 'R'
                                    : 'E'
                        } `;
                        // prefix += '* ';
                    } else if (j < nodeInfo.branch.indentation && j > minBranchPos) {
                        prefix += '--';
                    } else if (j > nodeInfo.branch.indentation && j < maxBranchPos) {
                        prefix += '--';
                    } else if (activeBranchPos.includes(j)) {
                        prefix += '| ';
                    } else {
                        prefix += '  ';
                    }

                    if (newBranchPos.includes(j)) {
                        newBranchesStr += nodeInfo.branch.indentation < j ? '\\ ' : '/ ';
                    } else if (activeBranchPos.includes(j)) {
                        newBranchesStr += '| ';
                    } else {
                        newBranchesStr += '  ';
                    }
                } else {
                    // eslint-disable-next-line no-lonely-if
                    if (j === nodeInfo.branch.indentation) {
                        prefix += `${
                            node.type === 'change'
                                ? 'C'
                                : node.type === 'merge'
                                  ? 'M'
                                  : node.type === 'root'
                                    ? 'R'
                                    : 'E'
                        } `;
                        // prefix += '* ';
                    } else if (activeBranchPos.includes(j)) {
                        prefix += '| ';
                    } else if (newBranchPos.includes(j) && oldBranchPos.includes(j)) {
                        prefix += '± ';
                    } else if (newBranchPos.includes(j)) {
                        prefix += '- ';
                    } else if (oldBranchPos.includes(j)) {
                        prefix += '+ ';
                    } else {
                        prefix += '  ';
                    }
                }

                if (activeBranchPos.includes(j) || newBranchPos.includes(j)) {
                    diffPrefix += '| ';
                } else {
                    diffPrefix += '  ';
                }
            }

            let specialNode = '';

            if (node.type !== 'empty' && node.hash === this.firstMergeNode.hash) {
                specialNode += 'first';
            }

            if (node.type !== 'empty' && node.hash === this.secondMergeNode.hash) {
                if (specialNode.length > 0) {
                    specialNode += ', ';
                }
                specialNode += 'second';
            }

            if (node === this.commonHistoryNode) {
                if (specialNode.length > 0) {
                    specialNode += ', ';
                }
                specialNode += 'common';
            }

            if (specialNode.length > 0) {
                specialNode = ` (${specialNode})`;
            }

            if (oldBranchPos.length > 0 && oldBranchesStr.length > 0) {
                lines.push(oldBranchesStr);
            }

            lines.push(
                `${prefix} ${node.type.padEnd(7, ' ')}${
                    node.type === 'empty' ? '' : `${node.hash}, `
                }depth: ${node.depth}, index: ${i}${specialNode}`
            );

            if (!omitDiff && (node.type === 'change' || node.type === 'root')) {
                let newBranchesPrinted = newBranchesStr.length === 0;

                if (Array.isArray(node.predecessorDiff)) {
                    const diffs = node.predecessorDiff as Transformation[];

                    for (const diff of diffs) {
                        lines.push(
                            `${newBranchesPrinted ? diffPrefix : newBranchesStr}   ${diff.op}${
                                diff.key ? ` ${String(diff.key)}` : ''
                            }${diff.value ? ` ${String(diff.value)}` : ''}`
                        );
                        newBranchesPrinted = true;
                    }

                    if (!newBranchesPrinted) {
                        lines.push(newBranchesStr);
                    }
                }

                if (node.predecessorDiff instanceof Map) {
                    const pathDiffMap = node.predecessorDiff as Map<string, Transformation[]>;

                    for (const [path, diffs] of pathDiffMap) {
                        lines.push(`${newBranchesPrinted ? diffPrefix : newBranchesStr}   ${path}`);

                        for (const diff of diffs) {
                            lines.push(
                                `${diffPrefix}     ${diff.op}${
                                    diff.key ? ` ${String(diff.key)}` : ''
                                }${diff.value ? ` ${String(diff.value)}` : ''}`
                            );
                        }

                        newBranchesPrinted = true;
                    }

                    if (!newBranchesPrinted) {
                        lines.push(newBranchesStr);
                    }
                }
            } else if (newBranchPos.length > 0 && newBranchesStr.length > 0) {
                lines.push(newBranchesStr);
            }
        }

        return lines.join('\n');
    }
}

export class VersionTree<
    T extends OneVersionedObjectTypes = OneVersionedObjectTypes
> extends ChildVersionTree<T> {
    protected constructor(firstMergeNode: GraphNode<T>, secondMergeNode: GraphNode<T>) {
        super(firstMergeNode, secondMergeNode, '');
    }

    createNewTreeWithNewCommonHistory<T2, DiffT>(
        newCommonHistoryNode: GraphNode<T2, DiffT>
    ): VersionTree {
        return this.createNewTreeWithNewCommonHistoryNodes([newCommonHistoryNode]);
    }

    createNewTreeWithNewCommonHistoryNodes<T2, DiffT>(
        newCommonHistoryNodes: Array<GraphNode<T2, DiffT>>
    ): VersionTree {
        const newNodes: GraphNode[] = [];
        const hashToNodeIndex: Map<SHA256Hash | 'empty', number> = new Map();
        const visitedNodeIndexes = new Set();
        const unprocessedSuccessors = newCommonHistoryNodes.map(newCommonHistoryNode => {
            const i = this.nodeIndexByHash(
                newCommonHistoryNode.type === 'empty' ? 'empty' : newCommonHistoryNode.hash
            );

            if (i === undefined) {
                throw new Error('Supplied node is not part of this version tree.');
            }

            return i;
        });

        unprocessedSuccessors.sort((a, b) => b - a);

        while (unprocessedSuccessors.length > 0) {
            const successor = unprocessedSuccessors.shift();

            if (successor === undefined) {
                break;
            }

            if (visitedNodeIndexes.has(successor)) {
                continue;
            }

            visitedNodeIndexes.add(successor);

            const currentNode = this.node(successor);

            if (currentNode.type === 'empty') {
                newNodes.push({
                    type: 'empty',
                    depth: -1,
                    successors: []
                });
                hashToNodeIndex.set('empty', newNodes.length - 1);
            }

            if (currentNode.type === 'merge') {
                const newNode: MergeGraphNode = {
                    type: 'merge',
                    hash: currentNode.hash,
                    obj: currentNode.obj,
                    depth: currentNode.depth,
                    data: currentNode.data,
                    dataType: currentNode.dataType,
                    predecessors: [],
                    successors: []
                };
                const newNodeIndex = newNodes.length;

                // Iterate over old predecessors and check if they have been visited
                // If visited add the predecessor to the new merge node.
                // If not they are not on a path to the common history => ignore
                // Also add the node as successor to the found predecessor
                for (const predecessor of currentNode.predecessors) {
                    const predecessorNode = this.node(predecessor);

                    const newIndex = hashToNodeIndex.get(
                        predecessorNode.type === 'empty' ? 'empty' : predecessorNode.hash
                    );

                    if (newIndex !== undefined) {
                        newNode.predecessors.push(newIndex);
                        newNodes[newIndex].successors.push(newNodeIndex);
                    }
                }

                newNodes.push(newNode);
                hashToNodeIndex.set(currentNode.hash, newNodeIndex);
            }

            if (currentNode.type === 'change' || currentNode.type === 'root') {
                let newNode: ChangeGraphNode | RootGraphNode;

                if (currentNode.type === 'change') {
                    newNode = {
                        type: 'change',
                        hash: currentNode.hash,
                        obj: currentNode.obj,
                        depth: currentNode.depth,
                        data: currentNode.data,
                        dataType: currentNode.dataType,
                        predecessorDiff: currentNode.predecessorDiff,
                        successors: []
                    };
                } else {
                    newNode = {
                        type: 'root',
                        hash: currentNode.hash,
                        obj: currentNode.obj,
                        depth: currentNode.depth,
                        data: currentNode.data,
                        dataType: currentNode.dataType,
                        predecessorDiff: currentNode.predecessorDiff,
                        successors: []
                    };
                }

                const newNodeIndex = newNodes.length;

                if (currentNode.predecessor !== undefined) {
                    const predecessorNode = this.node(currentNode.predecessor);

                    const newIndex = hashToNodeIndex.get(
                        predecessorNode.type === 'empty' ? 'empty' : predecessorNode.hash
                    );

                    if (newIndex !== undefined) {
                        newNode.predecessor = newIndex;
                        newNodes[newIndex].successors.push(newNodeIndex);
                    }
                }

                newNodes.push(
                    currentNode.type === 'change'
                        ? (newNode as ChangeGraphNode)
                        : (newNode as RootGraphNode)
                );
                hashToNodeIndex.set(currentNode.hash, newNodeIndex);
            }

            unprocessedSuccessors.push(...currentNode.successors);
            unprocessedSuccessors.sort((a, b) => b - a);
        }

        //  #### Nodes are sorted in the wrong order (ascending according to depth) ####

        // Step 1: Reverse the nodes array
        newNodes.reverse();

        // Step 2: Reverse the predecessor and successor indices
        for (const node of newNodes) {
            node.successors = node.successors.map(i => newNodes.length - 1 - i);

            if (node.type === 'change' || node.type === 'root') {
                if (node.predecessor !== undefined) {
                    node.predecessor = newNodes.length - 1 - node.predecessor;
                }
            }

            if (node.type === 'merge') {
                node.predecessors = node.predecessors.map(i => newNodes.length - 1 - i);
            }
        }

        // Step 2: Reverse the hash to index map
        for (const [key, value] of hashToNodeIndex.entries()) {
            hashToNodeIndex.set(key, newNodes.length - 1 - value);
        }

        // #### Find the new first and second merge nodes ####

        const mergeNodes = [];

        for (const node of newNodes) {
            if (node.successors.length === 0) {
                mergeNodes.push(node);
            }
        }

        if (mergeNodes.length > 2) {
            throw new Error('While rebuiling tree we have more than two top nodes.');
        }

        if (mergeNodes.length === 0) {
            throw new Error('While rebuiling tree we have no top nodes.');
        }

        let firstMergeNode;
        let secondMergeNode;

        if (mergeNodes.length === 2) {
            if (mergeNodes[0].type === 'empty') {
                throw new Error('While rebuiling tree one top level node was empty.');
            }

            if (mergeNodes[1].type === 'empty') {
                throw new Error('While rebuiling tree one top level node was empty.');
            }

            if (this.firstMergeNode.hash === mergeNodes[0].hash) {
                firstMergeNode = mergeNodes[0];
                secondMergeNode = mergeNodes[1];
            } else {
                firstMergeNode = mergeNodes[1];
                secondMergeNode = mergeNodes[0];
            }
        } else {
            if (mergeNodes[0].type === 'empty') {
                throw new Error('While rebuiling tree one top level node was empty.');
            }

            firstMergeNode = mergeNodes[0];
            secondMergeNode = mergeNodes[0];
        }

        // #### Check if a single common history exists ####

        const commonHistoryNodes = [];

        for (let i = 0; i < newNodes.length; ++i) {
            const node = newNodes[i];

            if (
                (node.type === 'change' && node.predecessor === undefined) ||
                (node.type === 'root' && node.predecessor === undefined) ||
                (node.type === 'merge' && node.predecessors.length === 0)
            ) {
                commonHistoryNodes.push({node, index: i});
            }
        }

        if (commonHistoryNodes.length === 0) {
            throw new Error('Every tree must have at least one common history element');
        } else if (commonHistoryNodes.length === 1) {
            if (hashToNodeIndex.get(commonHistoryNodes[0].node.hash) !== newNodes.length - 1) {
                throw new Error(
                    'The common history of a version tree needs to be the last element'
                );
            }
        } else {
            let emptyNode: EmptyGraphNode;
            const lastNode = newNodes[newNodes.length - 1];

            if (lastNode.type === 'empty') {
                // This case should never happen, but just in case it does ... we handle it
                MessageBus.send(
                    'altert',
                    'A case happened that was unexpected: empty node found as common history'
                );
                emptyNode = lastNode;
                emptyNode.successors = [
                    ...new Set(emptyNode.successors.concat(commonHistoryNodes.map(n => n.index)))
                ];
            } else {
                emptyNode = {
                    type: 'empty',
                    successors: commonHistoryNodes.map(n => n.index),
                    depth: -1
                };
                newNodes.push(emptyNode);
            }

            const emptyNodeIndex = newNodes.length - 1;

            for (const commonHistoryNode of commonHistoryNodes) {
                if (commonHistoryNode.node.type === 'merge') {
                    commonHistoryNode.node.predecessors = [emptyNodeIndex];
                } else {
                    commonHistoryNode.node.predecessor = emptyNodeIndex;
                }
            }
        }

        // #### Create the new tree ####

        const newTree = new VersionTree(firstMergeNode, secondMergeNode);
        newTree.nodes = newNodes;
        newTree.hashToNodeIndex = hashToNodeIndex;

        return newTree;
    }

    async createNodeForSubPath<ChildT = unknown>(
        i: number,
        path: string,
        derefObjRef = true
    ): Promise<GraphNode<ChildT, Transformation[]>> {
        const node = this.node(i);

        if (node.type === 'merge' || node.type === 'change' || node.type === 'root') {
            let data: ChildT;
            let dataType: OneObjectTypeNames | undefined;

            try {
                const child = await getChild(node.data, path.split('#')[0], derefObjRef);
                data = child.value as ChildT;
                dataType =
                    child.valueType.type === 'referenceToObj'
                        ? (await getObject(child.value as SHA256Hash)).$type$
                        : undefined;
            } catch (_e) {
                data = undefined as ChildT;
                dataType = undefined;
            }

            if (node.type === 'merge') {
                return {
                    ...node,
                    data,
                    dataType
                };
            } else {
                return {
                    ...node,
                    data,
                    dataType,
                    predecessorDiff: node.predecessorDiff.get(path) || []
                };
            }
        } else {
            return node;
        }
    }

    async createTreeForSubPath<ChildT = unknown>(
        path: string,
        derefObjRef = true
    ): Promise<ChildVersionTree<ChildT, Transformation[]>> {
        MessageBus.send('debug', `createTreeForSubPath path: ${path}, derefObj: ${derefObjRef}`);

        const nodesForSubpath = await Promise.all(
            this.nodes.map((_node, i) => {
                return this.createNodeForSubPath<ChildT>(i, path, derefObjRef);
            })
        );

        return new ChildVersionTree<ChildT, Transformation[]>(
            await this.createNodeForSubPath<ChildT>(
                this.nodeIndexByNode(this.firstMergeNode),
                path,
                derefObjRef
            ),
            await this.createNodeForSubPath<ChildT>(
                this.nodeIndexByNode(this.secondMergeNode),
                path,
                derefObjRef
            ),
            path,
            this,
            nodesForSubpath,
            new Map(this.hashToNodeIndex)
        );
    }

    /**
     * Check if the child identified by path has changes.
     *
     * @param {string} path
     * @returns {boolean}
     */
    hasSubPathChanges(path: string): boolean {
        const p = path.split('#')[0];

        for (const node of this.nodes) {
            if (node.type !== 'change' && node.type !== 'root') {
                continue;
            }

            for (const key of node.predecessorDiff.keys()) {
                if (key.startsWith(p) && (key[p.length] === undefined || key[p.length] === '.')) {
                    return true;
                }
            }
        }

        return false;
    }

    getChangedSubPaths(path: string, relativePaths = false): string[] {
        const p = path.split('#')[0];
        const changedPaths: Set<string> = new Set();

        for (const node of this.nodes) {
            if (node.type !== 'change' && node.type !== 'root') {
                continue;
            }

            for (const diffPath of node.predecessorDiff.keys()) {
                const d = diffPath.split('#')[0];

                if (p.length === 0) {
                    changedPaths.add(d);
                } else if (d.startsWith(p) && (d[p.length] === undefined || d[p.length] === '.')) {
                    changedPaths.add(relativePaths ? d.slice(p.length + 1) : d);
                }
            }
        }

        return [...changedPaths];
    }

    // #### Building a new tree ####

    static async constructVersionTreeUntilCommonHistory(
        firstNodeHash: SHA256Hash<VersionNode>,
        secondNodeHash: SHA256Hash<VersionNode>
    ): Promise<VersionTree> {
        MessageBus.send(
            'debug',
            `constructVersionTreeUntilCommonHistory firstNodeHash: ${firstNodeHash}, secondNodeHash: ${secondNodeHash}`
        );

        const tree = new VersionTree(
            await nodeHashToGraphNode(firstNodeHash),
            await nodeHashToGraphNode(secondNodeHash)
        );

        await VersionTree.addNodes(tree, true);
        await VersionTree.computeEdgesAndDiffs(tree);

        // If one of the merge nodes has a successor this means, that one merge node is the
        // parent of the other => we need to build the tree with the parent node again
        if (
            tree.firstMergeNode.successors.length !== 0 ||
            tree.secondMergeNode.successors.length !== 0
        ) {
            if (
                tree.firstMergeNode.successors.length !== 0 &&
                tree.secondMergeNode.successors.length !== 0
            ) {
                throw new Error('Only one node can be the parent of the other.');
            }

            const parentNodeHash =
                tree.firstMergeNode.successors.length === 0 ? firstNodeHash : secondNodeHash;

            const tree2 = new VersionTree(
                await nodeHashToGraphNode(parentNodeHash),
                await nodeHashToGraphNode(parentNodeHash)
            );

            await VersionTree.addNodes(tree2, true);
            await VersionTree.computeEdgesAndDiffs(tree2);
            return tree2;
        } else {
            return tree;
        }
    }

    static async constructCompleteVersionTree<
        T2 extends OneVersionedObjectTypes = OneVersionedObjectTypes
    >(nodeHash: SHA256Hash<VersionNode>): Promise<VersionTree<T2>> {
        MessageBus.send('debug', `constructCompleteVersionTree nodeHash: ${nodeHash}`);

        const node = (await nodeHashToGraphNode(nodeHash)) as GraphNode<T2>;
        const tree = new VersionTree<T2>(node, node);

        await VersionTree.addNodes(tree, false);
        await VersionTree.computeEdgesAndDiffs(tree);

        return tree;
    }

    static async constructCurrentVersionTree<
        T2 extends OneVersionedObjectTypes = OneVersionedObjectTypes
    >(idHash: SHA256IdHash<T2>): Promise<VersionTree<T2>> {
        const node = await getCurrentVersionNode(idHash);
        return VersionTree.constructCompleteVersionTree(node.hash);
    }

    static async getCurrentVersionTreeAsString<T2 extends OneVersionedObjectTypes>(
        idHash: SHA256IdHash<T2>,
        omitDiff = false
    ): Promise<string> {
        return (await VersionTree.constructCurrentVersionTree(idHash)).getStringRepresentation(
            omitDiff
        );
    }

    static async addNodes(tree: VersionTree, stopAtCommonHistory: boolean): Promise<void> {
        const initialNodes = [];

        if (tree.firstMergeNode.hash === tree.secondMergeNode.hash) {
            initialNodes.push(tree.firstMergeNode);
        } else {
            initialNodes.push(tree.firstMergeNode, tree.secondMergeNode);
        }

        const nodeQueue = new GraphNodeDepthPriorityQueue(initialNodes);

        function popAndAddNode(): GraphNode {
            const node = nodeQueue.pop();
            tree.nodes.push(node);

            if (node.type === 'empty') {
                tree.hashToNodeIndex.set('empty', tree.nodes.length - 1);
            } else {
                tree.hashToNodeIndex.set(node.hash, tree.nodes.length - 1);
            }

            return node;
        }

        // Iterate until only one element is left in the queue. One element = common history
        while (nodeQueue.length > (stopAtCommonHistory ? 1 : 0)) {
            const node = popAndAddNode();

            // This case should never happen, because the empty type should be the last one in the
            // queue, so the while clause should be false then
            if (node.type === 'empty') {
                break;
            }

            if (node.type === 'merge') {
                if (node.obj.nodes.size === 0) {
                    await nodeQueue.pushIfNew('empty');
                } else if (
                    (tree.firstMergeNode.type === 'change' ||
                        tree.firstMergeNode.type === 'root') &&
                    node.obj.nodes.has(tree.firstMergeNode.hash)
                ) {
                    tree.firstMergeNodeP = tree.secondMergeNodeP;
                    tree.nodes = [tree.firstMergeNodeP];
                    tree.hashToNodeIndex = new Map([[tree.firstMergeNodeP.hash, 0]]);
                    return;
                } else if (
                    (tree.secondMergeNode.type === 'change' ||
                        tree.secondMergeNode.type === 'root') &&
                    node.obj.nodes.has(tree.secondMergeNode.hash)
                ) {
                    tree.secondMergeNodeP = tree.firstMergeNodeP;
                    tree.nodes = [tree.firstMergeNodeP];
                    tree.hashToNodeIndex = new Map([[tree.firstMergeNodeP.hash, 0]]);
                    return;
                } else {
                    await Promise.all([...node.obj.nodes].map(nodeQueue.pushIfNew.bind(nodeQueue)));
                }
            }

            if (node.type === 'change') {
                if (node.obj.prev === undefined) {
                    throw new Error('Change node has no predecessor');
                } else if (node.obj.prev === tree.firstMergeNode.hash) {
                    tree.firstMergeNodeP = tree.secondMergeNodeP;
                    tree.nodes = [tree.firstMergeNodeP];
                    tree.hashToNodeIndex = new Map([[tree.firstMergeNodeP.hash, 0]]);
                    return;
                } else if (node.obj.prev === tree.secondMergeNode.hash) {
                    tree.secondMergeNodeP = tree.firstMergeNodeP;
                    tree.nodes = [tree.firstMergeNodeP];
                    tree.hashToNodeIndex = new Map([[tree.firstMergeNodeP.hash, 0]]);
                    return;
                } else {
                    await nodeQueue.pushIfNew(node.obj.prev);
                }
            }

            if (node.type === 'root') {
                await nodeQueue.pushIfNew('empty');
            }
        }

        // We also need to push the common history element
        if (stopAtCommonHistory) {
            popAndAddNode();
        }
    }

    static async computeEdgesAndDiffs(tree: VersionTree): Promise<void> {
        // We can not iterate the last element, because no predecessor node was created
        for (let i = 0; i < tree.nodes.length - 1; ++i) {
            const node = tree.nodes[i];

            const createEdgesAndDiff = async (
                predecessorHash: SHA256Hash<VersionNode> | 'empty'
            ): Promise<void> => {
                const predIndex = tree.hashToNodeIndex.get(predecessorHash);

                if (predIndex === undefined) {
                    throw new Error(
                        'Error building graph edge: Index of predecessor does not exist.'
                    );
                }

                const predecessor = tree.nodes[predIndex];
                predecessor.successors.push(i);

                if (node.type === 'merge') {
                    node.predecessors.push(predIndex);
                }

                if (node.type === 'change' || node.type === 'root') {
                    node.predecessor = predIndex;
                    node.predecessorDiff = await diffObjects(
                        predecessor.type === 'empty' ? null : predecessor.data,
                        node.data
                    );
                }
            };

            if (node.type === 'merge') {
                if (node.obj.nodes.size === 0) {
                    await createEdgesAndDiff('empty');
                } else {
                    await Promise.all([...node.obj.nodes].map(createEdgesAndDiff));
                }
            }

            if (node.type === 'change') {
                await createEdgesAndDiff(node.obj.prev);
            }

            if (node.type === 'root') {
                await createEdgesAndDiff('empty');
            }
        }
    }
}

async function nodeHashToGraphNode(
    nodeHash: SHA256Hash<VersionNode> | 'empty'
): Promise<GraphNode> {
    if (nodeHash === 'empty') {
        return {
            type: 'empty',
            depth: -1,
            successors: []
        };
    }

    const node = await getObject(nodeHash);

    const data = await getObject(node.data);

    switch (node.$type$) {
        case 'VersionNodeMerge':
            return {
                type: 'merge',
                hash: nodeHash as SHA256Hash<VersionNodeMerge>,
                obj: node,
                depth: node.depth,
                data,
                dataType: data.$type$,
                predecessors: [],
                successors: []
            };
        case 'VersionNodeChange':
            return {
                type: 'change',
                hash: nodeHash as SHA256Hash<VersionNodeChange>,
                obj: node,
                depth: node.depth,
                data,
                dataType: data.$type$,
                predecessorDiff: new Map(),
                successors: []
            };
        case 'VersionNodeEdge':
            return {
                type: 'root',
                hash: nodeHash as SHA256Hash<VersionNodeEdge>,
                obj: node,
                depth: node.depth,
                data,
                dataType: data.$type$,
                predecessorDiff: new Map(),
                successors: []
            };
    }
}

class GraphNodeDepthPriorityQueue {
    private readonly nodes: GraphNode[];

    constructor(initialNodes: GraphNode[] = []) {
        this.nodes = [...initialNodes];
    }

    get length(): number {
        return this.nodes.length;
    }

    async pushIfNew(nodeHash: SHA256Hash<VersionNode> | 'empty'): Promise<void> {
        if (
            this.nodes.findIndex(
                node =>
                    (node.type === 'empty' && nodeHash === 'empty') ||
                    (node.type !== 'empty' && nodeHash === node.hash)
            ) === -1
        ) {
            this.nodes.push(await nodeHashToGraphNode(nodeHash));
        }
    }

    /**
     * Get the node with the highes depth.
     *
     * @returns {GraphNode}
     */
    pop(): GraphNode {
        let maxDepth = Number.MIN_SAFE_INTEGER;
        let maxDepthNode: GraphNode | undefined = undefined;
        let maxIndex = 0;

        for (let index = 0; index < this.nodes.length; ++index) {
            const node = this.nodes[index];

            if (node.depth > maxDepth) {
                maxDepth = node.depth;
                maxDepthNode = node;
                maxIndex = index;
            }
        }

        if (maxDepthNode === undefined) {
            throw new Error('Queue is empty');
        }

        this.nodes.splice(maxIndex, 1);

        return maxDepthNode;
    }
}

export async function getChild(
    obj: OneObjectTypes,
    path: string,
    derefObjRef = true
): Promise<{valueType: ValueType; value: unknown}> {
    const recipe = getRecipe(obj.$type$);
    const paths = path.split('.');
    const processedPaths: string[] = [];

    let currentValueType: ValueType = {
        type: 'object',
        rules: recipe.rule
    };
    let currentValue: unknown = obj;

    if (path === '') {
        return {
            valueType: currentValueType,
            value: currentValue
        };
    }

    while (paths.length > 0) {
        const propName = paths[0];
        processedPaths.push(...paths.splice(0, 1));

        const handleReferenceToObj = async (): Promise<void> => {
            if (currentValueType.type !== 'referenceToObj') {
                return;
            }

            if (!isHash(currentValue)) {
                throw new Error(`Element '${processedPaths.join('.')}' is not a hash`);
            }

            const refObj = await getObject(currentValue as SHA256Hash);

            if (
                !currentValueType.allowedTypes.has('*') &&
                !currentValueType.allowedTypes.has(refObj.$type$)
            ) {
                throw new Error(
                    `Element '${processedPaths.join('.')}' has unexpected type '${
                        refObj.$type$
                    }'. Expected types: [${[...currentValueType.allowedTypes].join(', ')}]`
                );
            }

            currentValueType = {
                type: 'object',
                rules: getRecipe(refObj.$type$).rule
            };
            currentValue = refObj;
        };

        switch (currentValueType.type) {
            case 'referenceToObj': {
                await handleReferenceToObj();
                break;
            }
            case 'map':
                if (!(currentValue instanceof Map)) {
                    throw new Error(`Element ${processedPaths.join('.')} is not a map`);
                }

                currentValueType = currentValueType.value;
                currentValue = currentValue.get(propName);

                if (currentValue === undefined) {
                    throw new Error(
                        `key '${propName}' not found in map '${processedPaths.join('.')}'`
                    );
                }

                break;
            case 'object': {
                if (!isObject(currentValue)) {
                    throw new Error(`Element ${processedPaths.join('.')} is not an object`);
                }

                const rule: RecipeRule | undefined = currentValueType.rules.find(
                    r => r.itemprop === propName
                );

                if (rule === undefined) {
                    throw new Error(
                        `Property '${propName}' not found in rule '${processedPaths.join('.')}'`
                    );
                }

                currentValueType = rule.itemtype || {type: 'string'};
                currentValue = currentValue[rule.itemprop];

                if (derefObjRef || paths.length > 0) {
                    await handleReferenceToObj();
                }
                break;
            }
            default:
                if (paths.length > 0) {
                    throw new Error(
                        `Path '${processedPaths.join(
                            '.'
                        )}' does not exist on passed object. Cannot step into non id-preserving data type ${
                            currentValueType.type
                        }`
                    );
                }
                break;
        }
    }

    // Assert that returned value has the correct type
    switch (currentValueType.type) {
        case 'string':
            if (!isString(currentValue)) {
                throw new Error(`Element '${processedPaths.join('.')}' is not a string`);
            }
            break;
        case 'integer':
            if (!isInteger(currentValue)) {
                throw new Error(`Element '${processedPaths.join('.')}' is not an integer`);
            }
            break;
        case 'number':
            if (!isNumber(currentValue)) {
                throw new Error(`Element '${processedPaths.join('.')}' is not a number`);
            }
            break;
        case 'boolean':
            if (typeof currentValue !== 'boolean') {
                throw new Error(`Element '${processedPaths.join('.')}' is not a boolean`);
            }
            break;
        case 'referenceToObj': {
            if (!isHash(currentValue)) {
                throw new Error(
                    `Element '${processedPaths.join('.')}' is not a hash (referenceToObj)`
                );
            }
            break;
        }
        case 'referenceToId':
            if (!isHash(currentValue)) {
                throw new Error(
                    `Element '${processedPaths.join('.')}' is not a hash (referenceToId)`
                );
            }
            break;
        case 'referenceToClob':
            if (!isHash(currentValue)) {
                throw new Error(
                    `Element '${processedPaths.join('.')}' is not a hash (referenceToClob)`
                );
            }
            break;
        case 'referenceToBlob':
            if (!isHash(currentValue)) {
                throw new Error(
                    `Element '${processedPaths.join('.')}' is not a hash (referenceToBlob)`
                );
            }
            break;
        case 'map':
            if (!(currentValue instanceof Map)) {
                throw new Error(`Element ${processedPaths.join('.')} is not a map`);
            }
            break;
        case 'bag':
            if (!Array.isArray(currentValue)) {
                throw new Error(`Element '${processedPaths.join('.')}' is not a bag`);
            }
            break;
        case 'array':
            if (!Array.isArray(currentValue)) {
                throw new Error(`Element '${processedPaths.join('.')}' is not an array`);
            }
            break;
        case 'set':
            if (!(currentValue instanceof Set)) {
                throw new Error(`Element ${processedPaths.join('.')} is not a set`);
            }
            break;
        case 'object':
            if (!isObject(currentValue)) {
                throw new Error(`Element ${processedPaths.join('.')} is not an object`);
            }
            break;
        case 'stringifiable':
            break;
    }

    return {
        valueType: currentValueType,
        value: currentValue
    };
}

class Branch {
    id: number;
    rightBranches: Set<Branch> = new Set();
    indentation: number = 0;

    static maxId: number = 0;

    constructor() {
        this.id = ++Branch.maxId;
    }
}

class ActiveBranches {
    branches: Branch[] = [];

    insertNewBranchBefore(branch: Branch): Branch {
        return this.insertNewBranchAt(this.index(branch));
    }

    insertNewBranchAfter(branch: Branch): Branch {
        return this.insertNewBranchAt(this.index(branch) + 1);
    }

    insertNewBranchAtBeginning(): Branch {
        return this.insertNewBranchAt(0);
    }

    insertNewBranchAtEnd(): Branch {
        return this.insertNewBranchAt(this.branches.length);
    }

    insertNewBranchAt(i: number): Branch {
        if (i === -1) {
            throw new Error('Index is negative');
        }

        if (i > this.branches.length) {
            throw new Error('Index is out of bounds');
        }

        const newBranch = new Branch();

        // Update right branches
        if (i < this.branches.length) {
            newBranch.rightBranches.add(this.branches[i]);
        }

        if (i > 0) {
            this.branches[i - 1].rightBranches.add(newBranch);
        }

        this.branches.splice(i, 0, newBranch);

        return newBranch;
    }

    removeBranch(branch: Branch): void {
        this.removeBranchAt(this.index(branch));
    }

    removeBranchAt(i: number): void {
        this.branches.splice(i, 1);
    }

    index(branch: Branch): number {
        const i = this.branches.findIndex(b => b === branch);

        if (i === -1) {
            throw new Error('Branch not found');
        }

        return i;
    }
}

interface NodeInfo {
    branch?: Branch;
    activeBranches: Branch[];
    newBranches: Branch[];
    oldBranches: Branch[];
}
