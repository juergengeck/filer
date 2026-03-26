# Demand / Supply Sync Matching

Status: initial implementation note for channel-free matching over trie-root capabilities.

## Goal

Replace the old channel-based matching surface with a control-plane that publishes:

- demand declarations
- supply declarations
- scoped trie roots
- granted matches

The data plane stays unchanged:

- access is granted to a root or scoped root
- CHUM transports only what is accessible
- trie diff moves the actual content efficiently

## Core Rule

Demand / supply matching decides which scoped trie roots may be shared.

It does not replace:

- `Access` / `IdAccess`
- CHUM
- trie diff

It sits in front of them.

## Objects

The new object family is:

- `ScopedTrieRoot`
- `SyncDemand`
- `SyncSupply`
- `SyncMatch`

### `ScopedTrieRoot`

A stable versioned capability object that defines the share boundary.

Important fields:

- logical `id`
- `contentType`
- `selectorKind`
- `selector`
- `trie`
- owner
- optional `subjectId`
- optional current `root`
- optional current `rootId`

`ScopedTrieRoot` is what gets access-granted.

### `SyncDemand`

A versioned declaration that says:

- which logical content is wanted
- which trie view is relevant
- the minimum trust level required
- whether the declaration is active

### `SyncSupply`

A versioned declaration that says:

- which logical content can be supplied
- which scoped root backs that supply
- the minimum trust level required for receiving it
- whether the declaration is active

### `SyncMatch`

A versioned audit object for successful grants.

It records:

- demand id
- supply id
- scoped root id
- granted-to person
- granted-by person
- trust level used for the decision

## Trust Levels

The initial trust ladder is:

- `public`
- `known-key`
- `affirmed`
- `delegated`
- `inner-circle`

These are derived from `TrustedKeysManager` and local identity knowledge:

- `inner-circle`: one of my own managed identities
- `known-key`: trusted keys exist for the person
- `affirmed`: trusted affirmation exists on one of the person's profiles
- `delegated`: trusted trust-keys certificate exists on one of the person's profiles

The effective required level for a match is the stricter of:

- demand minimum trust
- supply minimum trust

## Matching Rules

Two declarations are eligible only when:

- both are active
- `contentType` matches
- `trie` matches
- selectors intersect
- counterparty trust satisfies both minima

The initial selector logic supports:

- exact to exact
- exact to prefix
- prefix to exact
- prefix to prefix
- equality for the remaining selector kinds

## Grant Flow

1. A remote `SyncDemand` arrives.
2. The local instance compares it against local `SyncSupply` declarations.
3. If trust is high enough, the local instance grants `IdAccess` to the referenced `ScopedTrieRoot`.
4. A `SyncMatch` object is written as an audit trail.
5. CHUM can now expose the scoped root.
6. Trie diff transfers only the missing content below that root.

If the local instance only has demand and the remote side has supply, the model can still report a
match, but only the supply owner can create the grant.

## Current Implementation Slice

The repository now contains:

- recipe definitions for the new object family
- trust comparison and selector matching utilities
- a channel-free `SyncMatchingModel`
- publish helpers for roots, demands, and supplies
- grant logic for locally-owned supplies

Known gaps for the next slice:

- bootstrap/index loading of historical declarations
- transport policy for exposing declarations to chosen peers
- richer selector languages
- explicit revocation and tombstoning policies
- integration of matching-derived access decisions into a reusable `objectFilter`
