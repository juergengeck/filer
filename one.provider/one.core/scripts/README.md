# Explanation of scripts design

This readme explains how the scripts are designed in order to get reliable build results. Note:
The whole readme only focuses on `install` and `prepare` scripts and ignores all other scripts,
because they don't seem to add any value (except maybe the prepublishOnly script - for detection
of a publish operation)

## Usage scenarios

We have three usage scenarios for one.core

1. Scenario 1: one.core [standalone build](#scenario-1-standalone) from source `npm install`
2. Scenario 2: one.core [as package dependency](#scenario-2-as-package-dependency) `npm install @refinio/one.core`
3. Scenario 3: one.core [as source dependency](#scenario-3-as-source-dependency) `npm install github:/refinio/one.core`

### Scenario 1: Standalone

This is usually used for one.core development and executing unit-tests. You clone a source
version with a command like `git clone git@github.com:refinio/one.core.git` and then execute
`npm install`, which will execute scripts in the following order:

-   execute `install` script
-   execute `prepare` script

### Scenario 2: As package dependency

This is used if you want to use one.core published versions in other projects.

#### Publishing a package

When publishing a package to the registry the following steps are done:

-   execute `prepare` script
-   package and upload to registry

#### Installing a package

Installing a one.core package with `npm install @refinio/one.core` in a project will lead to the
following steps:

-   **Phase 1**: get and unpack package from registry into a temporary directory **tempdir**
-   **Phase 2**: install as dependency from **tempdir** to **node_modules/@refinio/one.core**
    -   copy content from **tempdir** filtered by _files_ section of _package.json_
    -   execute `install` script in **node_modules/@refinio/one.core**

### Scenario 3: As Source dependency

This is used if you want to use a one.core branch for development purposes for which a package
does not exist. `npm install github:/refinio/one.core` in a project will lead to the following
steps:

- **Phase 1**: build dependency in temporary directory (e.g. 
  npm-cache_cacache\tmp\git-clone<random>). Same as in a 
  [standalone install](#scenario-1-standalone)
    -   `git clone git@github.com:refinio/one.core.git` to **tempdir**
    -   `npm install` in **tempdir**
        -   execute `install` script
        -   execute `prepare` script
- **Phase 2**: install as dependency from **tempdir** to **node_modules/@refinio/one.core**.
  Same steps as [installing a package](#installing-a-package) but from **tempdir** instead of 
  registry.
    -   copy content from **tempdir** filtered by _files_ section of _package.json_
    -   execute `install` script in **node_modules/@refinio/one.core**

## Design of scripts

For our library we have the following steps we need to perform in order to get a working version:

-   Step 1: build the code for all platforms: creates `lib` folder with platform specific
    code in `lib/system-*`
-   Step 2: select the platform by copying `lib/system-<target>` to `lib/system`
-   Step 3: remove all platform specific system folders `lib/system-*`

### Conflicts between _scenario 1_ and _scenario 2_

For _scenario 2_ (publish and use packages):

-   `prepare` would execute _step 1_ and
-   `install` would execute _steps 2 & 3_

But for _scenario 1_ the order of those scripts is reversed:

-   `install`
-   `prepare`

This means that `install` would fail, because the output files haven't been created, yet.

So we have two choices:

-   either `install` also executes _step 1_
-   or `prepare` also executes _steps 2 & 3_

In the end I opted for the first choice, which means that `install` also builds the files if they
haven't been built before. I opted for the first choice, so that the published package is as clean as
possible, because it is just a bare build.

In order to prevent multiple builds _step 1_ should only run if it wasn't run before by checking
if the output files already exist.

### Conflicts between _scenario 2_ and _scenario 3_

_Scenario 3_ makes everything even more complicated because it was designed badly by the npm team.
You cannot detect reliably whether you are in _scenario 3_ or in one of the others. In addition,
the `install` script is not always run in the context of your parent project (_scenario 3_ build
is done in a temporary dirextory) so target detection isn't possible in a nice manner in such cases.

Here is a complete list of such problems:

-   Only _scenario 3 - phase 1_ has all the dev dependencies to do a build (they are only
    available in the **tempdir** folder)
-   Only _Scenario 3 - phase 2_ has all the information to select correct platform specific code
-   _Scenario 1_ is exactly the same as _scenario 3 - phase 1_ and we cannot detect whether we are
    in _scenario 1_ or _scenario 3_ reliably.
-   _Scenario 2 - installing a package - phase 2_ is exactly the same as _scenario 3 - phase 2_
    and we cannot detect whether we are in _scenario 2_ or _scenario 3_ reliably.
-   All executions of the 'install' and 'prepare' scripts lack the knowledge in which scenario
    they were used. (With one exception, see below)
-   For _scenario 3_ we have an 'install' script execution in _phase 1_ which is not run in the
    context of the parent project, but in a temporary directory.
-   On the bright side we can reliably detect whether we are in the final install of _scenario 2
    or 3_ or not by checking if the current working directory ends with `node_modules/@refinio/one. core`

So there are the following conclusions we can deduce:

-   _Scenario 1_
    -   executes `install` and `prepare`scripts
    -   needs to build the library and copy the platform specific code from
        `lib/system-*` to `lib/system`
-   _Scenario 2 - [publish](#publishing-a-package)_
    -   executes `prepare` script
    -   needs to build the library
-   _Scenario 2 - [install](#installing-a-package)_
    -   executes `install` script
    -   needs to copy the platform specific code from `lib/system-*` to `lib/system`
-   _Scenario 3 - Phase 1_
    -   executes `install` and `prepare`scripts
    -   needs to build the library
-   _Scenario 3 - Phase 2_
    -   executes `install` script
    -   needs to copy the platform specific code from `lib/system-*` to `lib/system`

Since _scenario 3 - phase 1_ is exactly the same as _scenario 1_ and we cannot detect the
difference, the standalone build needs to keep the platform sepecific files, so that the install
step in _scenario 3 - phase 2_ can select the files for the correct target.

### Final design

So in the end we opted for the following solution (there might be others)

`install` executes

-   _step 1_: build files **if no output files exist**
-   _step 2_: copy platform specific code (`lib/system-<platform>` to `lib/system`)
-   _step 3_: remove all platform specific system folders (`lib/system-*`) **only if inside a
    node_modules folder**

`prepare` exeuctes

-   _step 1_: build files **if no output files exist**

This solution has drawbacks:
- The standalone build will still have the platform specific folders `lib/system-*` after the 
  initial install. But since we have a separate build script (npm run build) those folders will 
  be removed if you do another build by yourself
- Everything is very convoluted and a large readme is required to explain it all

## Debugging this stuff

When you want to debug this stuff stdout is not a good choice, because npm hides some output. 
You can redirect the console.log output to a file by calling

`redirectOutputToFile('/tmp/log.txt');`

This way everything is logged to this file. Put this line before the `run()` function in the 
`scripts/prepare.js`, `scripts/install.js` and `scripts/prepublishOnly.js` files.