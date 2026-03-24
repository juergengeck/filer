# ONE objects

## Format

#### Microdata
ONE objects are stored as microdata on disk and as Javascript objects during runtime. The
basic structure always looks like this simple example object with just one property "`name`":

```html
<span itemscope itemtype="http://gecko.io/MyType"><span itemprop="name">FooBar</span></span>
```

ONE microdata objects are described by *recipes*. A recipe describes the type name as well as the 
names and types of all properties. Recipes are stored in
[`./src/recipes.ts`](recipes.ts.html) (scroll down to the definition of `export const
 CORE_RECIPES`).

While the microdata string is how ONE objects are stored, and the SHA-256 identifying the content
is derived from it, in applications we use a native object representation since microdata
(basically an HTML string) would be unwieldy and impractical.

#### Javascript

ONE objects as Javascript objects are of interest only to programmers of an app working with the
local data in memory. Any exchange with external parties including other ONE instances is done
using microdata.

In Javascript the object for the microdata example from above looks like this:

```javascript
const exampleOneObject = {
    type: 'MyType',  // reserved property for the ONE type name
    name: 'FooBar'
}
```

**Reserved property name: "`type`"** cannot be used as property name because this is the property 
ONE uses for the ONE object type name.

The modules responsible for the conversions are
[`./src/object-to-microdata.ts`](object-to-microdata.module_ts.html) and
[`./src/microdata-to-object.ts`](microdata-to-object.module_ts.html). There also is a module
[`./src/microdata-to-json.ts`](microdata-to-json.module_ts.html) which translates a microdata string
directly to a JSON string, without going through an intermediate format (direct string-to-string
conversion, for speed).

In order to be able to get reliable SHA-256 hashes of the data content The microdata format is very 
strict and the parser has no leniency built-in - a single character out of place and the 
microdata is rejected. Spaces and newlines are not allowed (unless it is in the data of course). 
Any space or newline character makes the microdata invalid as a ONE object.

### Object properties (keys)

Another issue for producing consistent hashes from the same data is that since properties in a 
ONE object don't have a natural order because they are key/value stores. However, when converting
to microdata we have to ensure a reproducible order, since the SHA-256 hash would be different 
if individual properties (stored  inside `<span itemprop="propertyName">` tags) are in a different
order. For example, the following two Person objects have the exact same data, but their SHA-256 
hashes are different

**Note:** Indentation and newlines inserted for readability.

SHA-256: `e2912ff8a92478c4dad5d6be8268c3b8695016e12fcd52d6d905a5b438609b94`:
```html
<span itemscope itemtype="http://gecko.io/Person">
    <span itemprop="email">foo@bar.com</span>
    <span itemprop="name">Foo Bar</span>
</span>
```
SHA-256: `2e05d63dadf4053a8e76dd48da60071152b441c9ccece92885deb08e8cd651f5`:
```html
<span itemscope itemtype="http://gecko.io/Person">
    <span itemprop="name">Foo Bar</span>
    <span itemprop="email">foo@bar.com</span>
</span>
```

To solve this problem the order of rules in the *recipes* determines the order of properties 
inside the microdata string.

### Object values

Using the ordered sequence of [rules](global.html#RecipeRule) only solves the problem of non
-deterministic microdata strings (and resulting difference in SHA 256 hashes for the same raw
data) for single value properties. We also have properties with a rule property called
`list` where one property can have multiple values.

#### Multi-value properties

This `list` property can take one of two string constant values, which are provided through [an
 _enum_ `ORDERED_BY`exported by `recipes`](recipes.module_ts.html#.ORDERED_BY):
 
 - `ORDERED_BY.ONE` - Your data is like an unordered "bag" rather than an ordered array (but we
  only have ordered arrays in Javascript, unlike e.g.  in Java) 
 - `ORDERED_BY.APP` - Your data is ordered and the sequence matters to you

You should ignore the actual string constants being used and always use that exported object. 

As the names indicate, if you set `ORDERED_BY.ONE` as the value for the `list` property in a
[recipe-rule](global.html#RecipeRule) describing a property that is going to accept an array of
values that array will be sorted by ONE *after conversion of each array item to a microdata
`<span>` tag containing the (HTML-escaped) value of the item. That means your array of data is
not mutated, only the ephemeral internal array of mcirodata strings before being added to the
final microdata string for the object. The sorting will be done alphabetically but it could
really be any order.

The point is that if your data is a *bag of unordered data*, e.g. a list of email addresses
collected from parsing documents and if the parsing was done in parallel the order of the collected
emails might be random, or even if it was not random that a different sequence of those addresses
would still be the same "data" to you. Your algorithm, if run again, mught produce a different
sequence, which would produce a ONE object with a different hash unless a reproducible order is
enforced.

If on the other hand _your application_ takes care of of producing an _ordered_ array set
`list: ORDERED_BY.APP` in the [recipe-rule](global.html#RecipeRule) and ONE will not do any
sorting but convert the array to microdata exactly in the given order.  

#### JSON-encoded data properties

One option for values is to be stored as "object": In the recipes a property can be marked as
storing this type. This means that any data handed to the object-to-microdata converter simply is
converted to JSON. Since the native `JSON.stringify` method is inconsistent - it iterates over an
object's properties in insertion order - we use our own method implemented in module
[`./src/sorted-stringify.ts`](util_sorted-stringify.module_ts.html). It guarantees that the order
inside the JSON string always is the same. It also converts `Set` and `Map` properties and stores
them in an array representation.

Data created by ONE's modules is guaranteed to have the correct format. Saving the same data (in 
the form of a Javascript object) will always create the exact same microdata.

## Naming

The name of an object (and the filename  for storing it) is determined by creating the SHA-256 
hash of the microdata string.

For example, the filename of the example object

```html
<span itemscope itemtype="http://gecko.io/MyType"><span itemprop="name">FooBar</span></span>
```

is `e39e901b6b2b6c4e30287c8d9b14c40bad597200f26f78b3bc7bba0075abd241`.

*Exception:* Some changing but purely internal files like
[VersionMap](#internal-objects-reversemap-and-versionmap) objects (explained below) are stored 
under a fixed hash name component, and their name may consist of more than the hash.


## Nested objects

To keep things as simple as possible ONE objects are *flat*. However, it is possible to nest
objects: A property in a parent object can be declared as having a "type", with the type being 
the name of another ONE object recipe. Instead of a regular value (string, number, boolean) 
another object can be the value.

An example for a nested object are `KeyValueMap` objects including an array of key-value objects 
called `KeyValueMapItem`.

**NOTE:** The meaning of the individual properties does not matter, this is just an example for 
how a nested ONE object and a ONE object recipe look like. This particular object is actually 
obsolete and will probably be removed since it will probably always be better to use a "JSON" 
property to save an array in a ONE object (recipe rule option: `jsType: 'object'`).
   

Example, first the microdata:

```html
<span itemscope itemtype="http://gecko.io/KeyValueMap">
    <span itemprop="name">SomeType =&gt; OtherType</span>
    <span itemprop="valuesAreArrays">false</span>
    <span itemprop="keyJsType">string</span>
    <span itemprop="valueJsType">string</span>
    <span itemprop="item" itemscope itemtype="http://gecko.io/KeyValueMapItem">
        <span itemprop="key">0006d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</span>
        <span itemprop="value">4996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</span>
    </span>
    <span itemprop="item" itemscope itemtype="http://gecko.io/KeyValueMapItem">
        <span itemprop="key">4446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</span>
        <span itemprop="value">7996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a</span>
    </span>
</span>
```

The microdata converted to a Javascript object:

```javascript
const asJsObject = {
    type: "KeyValueMap",
    name: "SomeType =&gt; OtherType",
    valuesAreArrays: false,
    keyJsType: "string",
    valueJsType: "string",
    item: [
        {
            type: "KeyValueMapItem",
            key: "0006d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a",
            value: "4996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a"
        },
        {
            type: "KeyValueMapItem",
            key: "4446d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a",
            value: "7996d9bfc4a8bdb1f6b7e744b3ba3acaa9e18882ae08096a41ebe9c7356f325a"
        }
    ]
}
```

Finally, the `Recipe` objects for `KeyValueMap` and for `KeyValueMapItem` with the array of 
`RecipeRule` objects. Recipes and rules are themselves described by ONE objects! That means the 
`type` property in those objects is the ONE object meta-property and not part of the actual 
recipe or rule.   

```
const KeyValueMapRecipe = {
    type: 'Recipe',
    name: 'KeyValueMap',
    rule: [
        {
            type: 'RecipeRule',
            itemprop: 'name'
        },
        {
            type: 'RecipeRule',
            itemprop: 'valuesAreArrays',
            jsType: 'boolean'
        },
        {
            type: 'RecipeRule',
            itemprop: 'keyJsType'
        },
        {
            type: 'RecipeRule',
            itemprop: 'valueJsType'
        },
        {
            type: 'RecipeRule',
            itemprop: 'item',
            referenceTo: new Set(['KeyValueMapItem']),
            sequenceMatters: true,
            multiple: true
        }
    ]
};

const KeyValueMapItemRecipe = {
    type: 'Recipe',
    name: 'KeyValueMapItem',
    rule: [
        {
            type: 'RecipeRule',
            itemprop: 'key'
        },
        {
            type: 'RecipeRule',
            itemprop: 'value',
            multiple: true
        }
    ]
};
```


## ID objects and object versions

ID objects are purely virtual constructs that are not written to disk. An actual object with
the same properties (when no other than the mandatory ID properties are present) has a different
hash than an ID object, because a string ` data-id-object="true"` is added to the outer type
identifying `<span>` tag.

An ID object is created by using only properties marked as `isId: true` in
[`./src/recipes.ts`](recipes.module_ts.html) (or in your own recipes for your own data).

For example, the only ID property in a Person object is `email`. All other properties are
optional for ONE - the application may have other ideas because it knows more about what the 
object actually represents. If an application requires a property it is up to the app to make sure
it exists, ONE will not enforce the presence of any property unless it is an ID property because 
it does not have the subject knowledge.

ID objects are only created temporarily in RAM for the sole purpose to create an "ID hash" from 
their microdata representation. They are never written. This ID hash identifies all versions 
of a given ONE object because *it is used to store the version map*, which is an internal ONE 
object that lists all hashes of all objects representing different versions of this object.

ID objects and therefore ID hashes can be produced from any concrete version of the object.
Internally this is done simply by omitting any non-ID properties, converting the resulting object 
to microdata - and then also adding a special `data-id-object="true"` to the outer `<span>` tag of
the object before calculating the SHA-256 of the microdata string.

Here is an example of an ID object for the "Person" ONE object type, which has only one ID 
property "email":

**Note:** Indentation and newlines inserted for readability.

```html
<span data-id-object="true" itemscope itemtype="http://gecko.io/Person">
    <span itemprop="email">foo@bar.com</span>
</span>
```

The SHA-256 of this string is `400d6354a2305d90575a28407fd37b5fe1c09a091bf70d6b5f9802ecc7687718`.
This is the ID hash representing *all* Person objects where the `email` property is `foo@bar.com`. 

For example, if we have three Person objects *(Note: indentation and newlines added for
readability, they are not present in ONE microdata)*

```html
<span itemscope itemtype="http://gecko.io/Person">
    <span itemprop="email">foo@bar.com</span>
</span>
```

SHA-256: `37ccb840e0017eb22b9bf25c4d1a26c7e104168e543b79db4a5bb14ddc65e9b8`

```html
<span itemscope itemtype="http://gecko.io/Person">
    <span itemprop="email">foo@bar.com</span>
    <span itemprop="name">Foo Bar</span>
</span>
```

SHA-256: `e2912ff8a92478c4dad5d6be8268c3b8695016e12fcd52d6d905a5b438609b94`

```html
<span itemscope itemtype="http://gecko.io/Person">
    <span itemprop="email">foo@bar.com</span>
    <span itemprop="name">Foo Foo Bar</span>
</span>
```

SHA-256: `0402efc268ca699fc292ac7d948b8b186b26fc0e115d9433f3b979bc30dd7a43`

They are three different versions of the same object, because the ID object of all of them is the
same, since the only ID pproperty "email" is the same. In this example the first Person Object
happens to only have ID properties, but its hash still is different from the ID hash because the 
latter has the additional attribute `data-id-object="true"` in the opening `span` tag.

The ID hash is used to store a [VersionMap](#internal-objects-reversemap-and-versionmap) ONE 
object listing these three versions. The key is the hash of the Plan creating the object, the 
value is the hash of the created object:

```
${Plan-Hash},37ccb840e0017eb22b9bf25c4d1a26c7e104168e543b79db4a5bb14ddc65e9b8
${Plan-Hash},e2912ff8a92478c4dad5d6be8268c3b8695016e12fcd52d6d905a5b438609b94
${Plan-Hash},0402efc268ca699fc292ac7d948b8b186b26fc0e115d9433f3b979bc30dd7a43
```

Note that nothing is ever deleted (at least not during normal ONE operation, an app can of course
do whatever it wants), so this map only ever grows when entries for new versions are appended.
 
Also note that the values don't have to be unique: A SHA-256 pointing to the latest object may 
very well exist in an earlier position. In the context of Person objects this could happen when 
an address item is changed and later changed back. No new Person object will have been created 
since the exact same Person object from last time still exists, but its SHA-256 is appended at 
the last position to show that this now again is the current version.

*Note:* See [`./src/object-recipes.ts`](object-recipe.module_ts.html) for the definitions of the ONE
objects mentioned in this document.


## Accessing an object

To access an object we first have to get an ID-hash (possibly by building an ID-object to get its
hash), then we load the **version map (Plan => Object)** for that particular object which is 
stored under that hash. It has a list of all versions of the object. The last entry in the 
version map points to the latest version of the object.

New entries are always added at the end, so the last entry always points to the latest object and
thereby the latest version of the object identified by the ID-hash.


## Creating or updating an object

### Step 1: Creating a Plan

Writing *anything* is only possible through a Plan, which *must* create at least one versioned 
object.
 
Plan-creating functions are available in the storage API module for 1 or n created objects, the 
1-object creating function merely being a convenience wrapper around the latter that returns a 
single object creation result structure instead of an array.

The Plan-creating function needs a) the name of a module with an object-creating function, b) 
arguments for that function. A Plan object is created using that data, it is stored and the 
result of storing the Plan object is examined (it has a creatioon status component which can be 
either "new" or "exists"): If the Plan already exists we return the previous results using the 
PlanEnd object of the Plan, which contains a list of all previous results.

If the Plan is new we need to run the given code which returns one or more versioned ONE objects 
and  possibly a number of unversioned objects like maps, or CLOBs or BLOBs. For each *versioned* 
object we go through these steps (unversioned objects and CLOBs/BLOBs are just a simple write):

### Step 2: Creating one or more objects

We write the object, then calculate the ID-hash of the object, insert that string into the string
template for the empty version map (see above) for this object, update or create this version 
map, and then return the VersionedObjectResult of the object creation (i.e. the object itself, 
its SHA-256, its ID-hash's SHA-256, and the creation status "new", "exists", "appended", the 
last one if another version of that object already existed). 

This process may be repeated. Also, unversioned objects as well as CLOBs and BLOBs could be 
written. The Plan intercepts all write operations and collects information about which objects 
are written, whether versioned, unversioned, CLOB or BLOB. 


### Step 3: Creating a PlanEnd object


### Plan objects

TODO: fix
Plan objects control the creation of ONE objects. The only way to create a (versioned) object
is to go through a Plan. Module `storage-unversioned-objects.ts` has two methods to create ONE
objects through a Plan: `createObjectsWithPlan` and `createObjectsWithPlan`. The latter is merely
a convenience shortcut for the former when only one object is expected, to avoid getting an array
of one object but instead get the object directly.

Plan objects have SHA-256 hashes to all (code) modules involved in creating an object and a
`JSON.stringify`-ed list of the arguments for that code.

Before executing the code that is supposed to create the ONE objects the global Plan index is
checked with the hash of the Plan. If we find this exact Plan has already been run, meaning we
have an entry for this Plan hash, we do not run the code but simply return the previous results.

This means that some thought may have to go into designing the object-creating function and its
arguments. For example, the Mailbox object creating function that downloads messages from an IMAP
server and creates a Mailbox object pointing to all downloaded email BLOB files does not know if
anything changed on the IMAP server in advance. So the parameters only include the ImapAccount
object and the name of the mailbox on that account. This means a Plan would only be created once:
After all, when we call the same function a day later it still is the same ImapAccount and the
same mailbox name, so the exact same Plan hash would be created.

In such a case when external data is involved a dummy parameter representing that data could be
used: In the Mailbox object example we have chosen to add a timestamp to the parameters. This
leads to creation of a new Plan each time the function is called. This is only an approximation
of the real world: If we call the function a hundred times per hour and there is no new email on
the server then we get the exact same Mailbox object, so we should not have run the Plan, but we
cannot know that. Getting the data from the server before creating the Plan on the other hand
would take responsibility that belongs into the Mailbox module out of it. In this case a
timestamp seems a sufficiently reasonable proxy for the unknown state of the external data source.

On the other hand, unless some thought is given to designing the object creating module's API it is
possible to have parameters that do change the hash of the resulting Plan object but have no
influence on the resulting objects! This too is undesirable. These examples show that designing
the interface for the modules called through Plans requires some planning.


### Internal objects reverse and version maps

These purely internal objects are never shared with the outside which is why they use a structure 
that does not conform to the ONE object convention but is instead optimized for storage space and 
speed. In particular,  

1. They are purely text-based, there is no microdata. There is one entry per line. The newlines 
   separating individual entries are Unix style (just \n).

2. System maps are stored under a hash independent of the SHA-256 of their string microdata.
   System maps are stored in a different location, not with the data files, and there is one 
   location for each type of system map. 

3. System maps change (goes along with (2)). No other file in ONE storage ever changes.

### Version maps

These maps for versioned objects are created per ID-object, have an entry for each version of an 
object are stored  under the hash of the ID-object (*ID-hash*) they are for. On filesystem based 
storage version maps are stored in the `version-maps` subdirectory.

**Format:**

```
timestamp,planHash,objectHash
timestamp,planHash,objectHash
...
```

The timestamp is the time the object was created (or recreated, if it already existed) and when 
the version map entry was made.

The Plan hashes are the hashes of the Plan that created that particular object.
 
The object hashes are the hashes of the concrete ONE objects that were created.

New entries are always appended at the bottom.

### Reverse maps

These maps are created for all objects per referencing object type, meaning if an object
is referenced by another object a reverse map **from** the referenced and **to** the 
referencing object an entry in the referenced object's reverse map for the referencing 
object's type is made.

Reverse maps are the counter part to references (down the tree, towards leave nodes): They 
point back up the tree, from the object being referenced to the one that has the reference. 

On filesystem based storage version maps are stored in the `reverse-maps` subdirectory.

Reverse maps are optional, confgurable in the instance. They can be left out completely, 
written for all references, or only for references from selected object types.

Reverse map file names differ because it is not (only) a SHA-256 hash:

```
[hash of object being referenced].[H|I].to.[type of referencing object]
```

The first component is the hash of the object the reverse map belongs to, which can be the 
hash of a real object for unversioned objects and an ID object for versioned objects.

The second component is an "H" or an "I", short for **H**ash and for **I**D-hash. This is for 
a human reader and has meaning for ONE itself. It shows whether the first component is a 
concrete object hash or an ID hash. Both versioned object references as well as ID-hash 
references (linking to all versions of an object) are put into the same reverse map (i.e. the 
ID hash is used), i.e. the concrete object hash is used only for reverse maps of unversioned 
objects, which do not have an ID. 

The third component is the type string of the object which has the reference to the hash in 
the first component.

**Format:**

```
targetObjHash,referencingObjIdHash,referencingObjHash
targetObjHash,referencingObjIdHash,referencingObjHash
...
```

The target object hash is the same for all entries for all of an unversioned object's reverse 
maps. The reverse map for a versioned object can have any of its concrete object versions as the 
target hash, of the ID hash itself if the reference is an ID reference pointing to all versions 
and not a concrete one.

Reverse maps contain entries that could be described with the SQL statement `GROUP BY 
referenced-hash, referencing type`. If we were to group only by "referenced hash" we would 
have one reverse map, but we have an additional item to group by, so we end up with different 
reverse maps for any one given referenced object hash, one for each type.

The reason is that we think the most common use case for reverse maps, to go UP the tree 
created by the hash references, is to look for references from a specific type of object. For 
example, in an application dealing with emails, if the tree is from `Folder` objects to `Email` 
objects and you want to know which folders a given email is in you use the reverse map for 
that object and for the `Folder` type. Since reverse maps may become quite large separating 
them per type is more efficient in most use cases, if everything was in one file most entries 
would be read via expensive I/O operations only to be thrown away.

# Starting for the first time

The basic structure of the most basic node.js ONE app might look like this (the example uses 
[TypeScript types](http://www.typescriptlang.org/) as Javascript type system &mdash; but apart 
from the type annotations the code is 100% pure ECMAScript):

```javascript
// @flow
'use strict';

const Instance = require('One/lib/instance.js');

// In order to use async/await the code must be inside a function.
const run = async function (): Promise<void> {
    const instance: InstanceObj = await Instance.init({
        email: 'test@test.com',
        instanceName: 'test',
        directory: '/some/path'
    });

    // Application code:
    // ....
};

run().catch(console.error);
```

Altogether 8 files are created when you run `Instance.init` for the first time (per storage area).


#### Overview over all eight files created during initial startup

**NOTE:** Newlines and indentation inserted for readability, they don't exist in any ONE object!

- Plan for Person and the Instance object (the JSON string inside "parameters" is one long line in 
  real life!) (SHA-256: `6bdbabc535ef67b08388f57020185eec816de7c1402cb0a384b458304144c95d`)
```html
<span itemscope itemtype="http://gecko.io/Plan">
    <span itemprop="parameters">
    [
        {
            "email":"test@test.com",
            "type":"Person"
        },
        {
            "name":"test",
            "ownerId":"13268e03b3b629cf25f08505cf83bd92438631ebbc010ccaa24d90a74b5487a0",
            "type":"Instance"
        }
    ]
    </span>
    <span itemprop="moduleName">lib/identity</span>
</span>
```

- Person object (SHA-256: `b8d6e8d8a547d99e100e6e21203ea9bdf3838e9c7e35a0f55ab3b1b5faa9cbef`)
```html
<span itemscope itemtype="http://gecko.io/Person">
    <span itemprop="email">test@test.com</span>
</span>
```

- Version map (Plan => Object) for the Person object (SHA-256: 
the ID-hash of the Person object `13268e03b3b629cf25f08505cf83bd92438631ebbc010ccaa24d90a74b5487a0`)
```
82d866aa8a85411f1bd1dbd5928639c75a8378cffc9a5aa49e9b5ecdf9d6539b,b8d6e8d8a547d99e100e6e21203ea9bdf3838e9c7e35a0f55ab3b1b5faa9cbef
```

- Instance object (SHA-256: `5f60f7970e038923879747c7cc237eaaaaa1fde404cbe311171399315af67ba6`)
```html
<span itemscope itemtype="http://gecko.io/Instance">
    <span itemprop="name">test</span>
    <span itemprop="ownerId">13268e03b3b629cf25f08505cf83bd92438631ebbc010ccaa24d90a74b5487a0</span>
</span>
```

- Version map (Plan => Object) for the Instance object (SHA-256:
the ID-hash of the Instance object `ed7a0aea9ced968e93ce7372864754034158125f42587eb302ef8e202aeed814`)
```
82d866aa8a85411f1bd1dbd5928639c75a8378cffc9a5aa49e9b5ecdf9d6539b,5f60f7970e038923879747c7cc237eaaaaa1fde404cbe311171399315af67ba6
```

- PlanEnd for Person and Instance object
(SHA-256: `14f5c712f86e57659b8036f4cef11642abaf528c9f9a471e4205cb0f922dd57a`)
```html
<span itemscope itemtype="http://gecko.io/PlanEnd">
    <span itemprop="plan">6bdbabc535ef67b08388f57020185eec816de7c1402cb0a384b458304144c95d</span>
    <span itemprop="startTime">1498336599873</span>
    <span itemprop="endTime">1498336599886</span>
    <span itemprop="objectVersioned" itemscope itemtype="http://gecko.io/VersionedCreationResult">
        <span itemprop="object" itemscope itemtype="http://gecko.io/Reference">
            <a itemprop="hash" href="5f60f7970e038923879747c7cc237eaaaaa1fde404cbe311171399315af67ba6">
                5f60f7970e038923879747c7cc237eaaaaa1fde404cbe311171399315af67ba6
            </a>
            <span itemprop="targetType">Instance</span>
            <span itemprop="id">ed7a0aea9ced968e93ce7372864754034158125f42587eb302ef8e202aeed814</span>
        </span>
        <span itemprop="status">new</span>
        <span itemprop="versionMapUpdate">new</span>
    </span>
    <span itemprop="objectVersioned" itemscope itemtype="http://gecko.io/VersionedCreationResult">
        <span itemprop="object" itemscope itemtype="http://gecko.io/Reference">
            <a itemprop="hash" href="b8d6e8d8a547d99e100e6e21203ea9bdf3838e9c7e35a0f55ab3b1b5faa9cbef">
                b8d6e8d8a547d99e100e6e21203ea9bdf3838e9c7e35a0f55ab3b1b5faa9cbef
            </a>
            <span itemprop="targetType">Person</span>
            <span itemprop="id">13268e03b3b629cf25f08505cf83bd92438631ebbc010ccaa24d90a74b5487a0</span>
        </span>
        <span itemprop="status">new</span>
        <span itemprop="versionMapUpdate">new</span>
    </span>
    <span itemprop="returns">b8d6e8d8a547d99e100e6e21203ea9bdf3838e9c7e35a0f55ab3b1b5faa9cbef</span>
    <span itemprop="returns">5f60f7970e038923879747c7cc237eaaaaa1fde404cbe311171399315af67ba6</span>
</span>
```

The `PlanEnd` object contains two "Reference" objects which lead to the creation of reverse maps 
from the referenced objects back to the referencing object (the `PlanEnd` object):

- ReverseMap object for the Person (owner) object (SHA-256: 
`8554d91f414ab5d3cd402640f6aa0e2d9694f358f20a21de2bcb93ad90db9ae7.I.to.PlanEnd`)
```
b8d6e8d8a547d99e100e6e21203ea9bdf3838e9c7e35a0f55ab3b1b5faa9cbef,14f5c712f86e57659b8036f4cef11642abaf528c9f9a471e4205cb0f922dd57a
```

- ReverseMap object for the Instance object (SHA-256: 
`d3c1ec51bab6213295c47f3ade200835c31622d9643cf087c0a2c8585e432dc5.I.to.PlanEnd`)
```
5f60f7970e038923879747c7cc237eaaaaa1fde404cbe311171399315af67ba6,14f5c712f86e57659b8036f4cef11642abaf528c9f9a471e4205cb0f922dd57a```
```
