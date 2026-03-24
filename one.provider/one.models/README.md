# one.models

## Getting started

### In general

-   Download and install
    -   [node.js](https://nodejs.org/en/download/current/)
    -   [git](https://git-scm.com/downloads)
-   A Github account authenticated with a ssh key pair
-   Access to
    -   github.com/refinio/one.core

```bash
git clone https://github.com/refinio/one.models
cd one.models
npm install
```

## About the project

Main models used in one built in one package

## Project structure in general

-   Source files go into the **/src** folder.
-   Test files into **/test** folder.
-   They will both be process by **build.js** and the .ts files will be transpiled into the **/lib** folder
-   ONE plan modules into **/src/plan_modules** they are compiled with **/build_plan_modules.js**

## Style

As said we use TypeScript above JavaScript ES6 meaning we use **import**,**export** statements
instead of require. And have the newest javascript features available

Additional we use **prettier.js** for automatic code styling. Here you should also copy an existing
**.prettierc** form an existing project.

Most modern IDEs support to file watchers which then can execute scripts on changes.
Setup **prettier.js** and **build.js** te be run on file changes.

## TypeScript

The file **@OneCoreTypes.d.ts** defines the types this project uses as well as exports

## Tools

To build the `CommServer`, `PasswordRecoveryServer` and `GenerateIdentity` tools run

```bash
npm run bundle
```
