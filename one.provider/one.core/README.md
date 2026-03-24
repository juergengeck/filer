# Installation

Install the latest [node.js](https://nodejs.org/en/) at least **v16.x.x**

### To work on ONE itself

Clone the ONE directory from GitHub and run `npm install` inside the installation  directory.
All development dependencies such as _TypeScript_, _eslint_, _mocha_ or _Babel_ are installed
locally.

For working with the code we recommend JetBrains' WebStorm IDE. On Windows we recommend
installing [git for Windows](https://git-scm.com/downloads) and [ConEmu](https://conemu.github.io/).

### To include ONE in another project

**Before installing** the one.core package and if your target platform is not _node.js_ — which
is the default — set `refinio.platform` in package.json to either `nodejs`, `browser`
or to `rn` for a React Native target.

The reason is that during package installation the `build.js` script of one.core will run to
create the `lib/` folder. The script queries this environment variable, if it is set, to choose
the `src/system-[platform]/` folder for `lib/system/`. By default, the _node.js_ platform code is
used.

Next, provided you have access to the thus far private REFINIO one.core repository, in your
`package.json` include

```
"dependencies": {
    ...    
    "@refinio/one.core": "0.2.26",    
    ...
}
```

and run `npm install`.

You will also have to copy the .npmrc from one.core and add a `GITHUB_ACCESS_TOKEN` as an 
environment variable.


# TypeScript support

In order to gain full TypeScript support you will have to add `interface` type declarations for
all ONE object types that your application uses. For each _Recipe_ there has to be an `interface`
(object) declaration.

The way this works is a bit tricky (but easy), because the types in one.core have to support not
just all core ONE object types such as _Recipe_, _Person_, _Access_ or _Chum_, but also all ONE
object types it does not know about yet added by application code using one.core.

How we achieve this uses three TypeScript features:

- [TypeScript declaration `.d.ts` files](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)
  containing nothing but declarations for TypeScript
- A common
  [ambient module namespace](https://www.typescriptlang.org/docs/handbook/modules.html#ambient-modules)
  for all ONE object `interface` declarations, and
- [Declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)

Package ONE.core has a declaration file `@OneCoreTypes.d.ts` in its root directory with the
`interface` declarations for all ONE.core ONE object types, as well as a few types heavily used
by those types, such as `SHA256Hash` as an opaque type alias for hash strings. Those types are
included there because we try to avoid having `import` statements in that file since that would
complicate the build process (since we would only want to import from `lib/` instead of `src/`
during build there would be dependencies on files in `lib/` that don't exist before the build is
done). We try to have only ONE object `interface` declarations in there.

This file declares an ambient module namespace with `declare module '@OneCoreTypes' {...}`

It uses several key-value maps to achieve declaration merging of all `interface` types declared
in that namespace:

- `interface OneUnversionedObjectInterfaces`
- `interface OneVersionedObjectInterfaces`
- Special: `interface OneIdObjectInterfaces`

In order to add your own ONE object types you have to

- Create your own `.d.ts` file with `declare module '@OneCoreTypes' {...}`, so that anything
within is in this namespace
- Create the `interface` declarations for all your ONE object types
- Write your own versions of `OneUnversionedObjectInterfaces`, `OneVersionedObjectInterfaces` and
 `OneIdObjectInterfaces`. Be careful not to use any type names used anywhere else (e.g. in
 ONE.core, but also in other libraries you may include, such as ONE.recipes).

### Example for your @OneCoreTypes.d.ts

```typescript
declare module '@OneCoreTypes' {
    // export interface OneUnversionedObjectInterfaces {}

    export interface OneIdObjectInterfaces {
        MyVersionedObjTypeId: Pick<ReplicantRegistration, 'type' | 'idProperty'>;
    }

    export interface OneVersionedObjectInterfaces {
        MyVersionedObjType: MyVersionedObjType;
    }

    // Interfaces for your ONE object types

    export interface MyVersionedObjType {
        type: 'MyVersionedObjType';
        idProperty: string;
        someProp: string;
        someOptionalProp?: number;
        owner: SHA256IdHash;
        rawData: SHA256Hash;
    }
}
```

### tsconfig.json

In ONE.core we use two different tsconfig files, one for stytic type checking with the IDE and
the TS language service, one during builds for creating the declaration and map files in `lib/`.
You may want to copy that approach and look at those files in other ONE.* projects that include
ONE.core, for example ONE.recipes or ONE.replicant.

We recommend to set `"moduleResolution": "node"`, so that the `./node_modules/` folder is used.
That is because the ONE.core declaration files are not in an external DefinitelyTyped declaration
file, but part of the `one.core/lib/` folder itself.

You will have to add to the `"include"` section of tsconfig.json all the .d.ts files not in paths
where `tsc` (TypeScript service process) will find them. Those are all `.d.ts` files in top level
directories, such as `node_modules/one.core/@OneCoreTypes.d.ts` as well as your own ONE object
types declaration file for the "@OneCoreTypes" namespace.

Just to explain some oddities in our tsconfig files:

If you look at the tsconfig.[declaration.]json files from other REFINIO projects you will find a
lot of entries in `"includes"` and in `"excludes"`. That is for several reasons: One, as long as
we don't _publish_ the packages the `src/` folder still is there and just as likely to be used by
an IDE or by `tsc` instead of the `lib/` folder. Two, when looking for included files TypeScript
_ascends_ out of the project directory, which when we had imports such as `import {Foo} from
'one.core/lib/foo';` lead to `tsc` finding it in `../one.core/lib/` (or even `src/`) instead of
in `node_modules/one.core/lib/`. That is possible when several REFINIO projects are present in
the same parent directory because we worked on all of them. That is why we have two versions of
the same include- and exclude-directive, one covering when ONE.core is installed in the parent
directory, one when it is installed as dependency in `node_modules`.


# Running Tests

To run the tests 1) build all files for the correct environment (node.js or browser), 2) on node.js
run `npm test`. To run the same tests on the browser "run" `./test/index.html` from WebStorm
(which launches a webserver). Make sure you first build the files in the `lib/` folder for
the respective platform because the tests run the files in there, not in `src/`.


# Documentation

API documentation is generated from JSDoc comments in the source code. To view it clone the
repository and open `./doc/API/index.html` (static pages, no webserver needed).

For a general introduction to _ONE.core_ [go to `./doc/README.md`](./doc/README.md).

There is also an online version of the documentatiion available at https://docs.refinio.one/
that gets updated once per day.
<!--stackedit_data:
eyJoaXN0b3J5IjpbMjc0NzMzNTA1XX0=
-->


# Chum Synchronization Filtering

ONE.core now supports custom filtering of objects during chum synchronization through the `objectFilter` option. This allows applications to control which objects are shared with remote peers based on custom criteria such as certificates or verifiable credentials.

## Using Object Filters

When starting a chum synchronization, you can provide an optional `objectFilter` function:

```typescript
import { startChumSync } from '@refinio/one.core';

const chumApi = await startChumSync({
    connection: websocket,
    localPersonId: localPerson,
    remotePersonId: remotePerson,
    chumName: 'MyChum',
    localInstanceName: 'Local',
    remoteInstanceName: 'Remote',
    objectFilter: async (hash, type) => {
        // Custom filtering logic
        if (type === 'Group' || type === 'Access') {
            // Only share if we have valid certificates
            return await hasValidCertificate(hash);
        }
        return true; // Share other object types
    }
});
```

## Filter Function Signature

The `objectFilter` function has the following signature:

```typescript
(hash: SHA256Hash | SHA256IdHash, type: string) => Promise<boolean>
```

- `hash`: The hash of the object being considered for sharing
- `type`: The object type (e.g., 'Group', 'Access', 'IdAccess')
- Returns: `Promise<boolean>` - true to share the object, false to filter it out

## Default Behavior

Without an `objectFilter`, ONE.core maintains its default security behavior:
- Group objects are not shared
- Access and IdAccess objects are not shared
- This prevents unauthorized modification of access policies

## Use Cases

The objectFilter enables:
- Sharing Group/Access objects only with verified peers (using certificates)
- Custom access control based on application-specific criteria
- Gradual migration from blocked to certificate-based sharing
- Different filtering policies for different peer relationships

# Versioned Object Storage Functions

The following functions are used to store versioned objects in ONE.core with different versioning strategies:

## storeVersionedObject

Main function to store a versioned object with explicit version handling strategy. Takes two parameters:

- `obj`: The versioned ONE object to store
- `storeAs`: Optional parameter to specify storage strategy:
  - `STORE_AS.CHANGE` (default) - Stores as a change (or edge) version
  - `STORE_AS.MERGE` - Stores as a merge version (edge->merge with current or edge if no current)
  - `STORE_AS.NO_VERSION_MAP` - Stores without version mapping (no nodes)

## Storage Strategies

### storeVersionObjectAsChange

Stores object as a change version, creating a new version node after the current version. This is the default strategy used by `storeVersionedObject`.

### storeVersionObjectAsMerge 

Stores object as a merge version, combining the new change with the current version of edge if no current version is avaliable. 

### storeVersionedObjectNoMerge

Stores object without creating version nodes.

The version storage strategy should be chosen based on your versioning needs:

- Use `CHANGE` (default) for normal sequential updates
- Use `MERGE` when combining changes from multiple sources (instances)
- Use `NO_VERSION_MAP` for when you want to avoid version trees (not recomended)

