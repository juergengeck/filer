/* eslint-disable @typescript-eslint/no-empty-interface */
/**
 * @author Michael Hasenstein <hasenstein@yahoo.com>
 * @copyright REFINIO GmbH 2018
 * @license CC-BY-NC-SA-2.5; portions MIT License
 * @version 0.0.1
 */

/**
 * @file
 *
 * Declares an empty module types that can be added to in module files by declaration
 * overloading. The overloading mechanism only works if there already is a module with the
 * given module name. Each code module automatically has its path+filename as its module name.
 *
 * Ambient module names are declared and may or may not correspond to a code module, and they
 * usually don't have a path component. cannot be created in code files, they *must* be declared
 * in a .d.ts file.
 *
 * TypeScript Module Argumentation:
 * {@link https://www.typescriptlang.org/docs/handbook/declaration-merging.html#module-augmentation}
 *
 * The module namespace created here *is used only for types*.
 *
 * The name does not have a path because there is no concrete module (no code, just types) and
 * because the identifier needs to be the same from one.core, from other ONE libraries that
 * include one.core, such as one.models, and from apps using one.core by direct import or by
 * indirect import e.g. through one.ui (which includes one.models which includes one.core).
 *
 * Any module in any project using one.core directly or indirectly can add their own ONE object
 * and Plan return types by adding to this ambient module name.
 *
 * There are four interface types added to this ambient module namespace:
 * - OneUnversionedObjectInterfaces
 * - OneIdObjectInterfaces
 * - OneVersionedObjectInterfaces
 * - PlanResultTypes
 *
 * See one.core's src/recipes.ts and src/plan.ts for how one.core adds types.
 */

declare module '@OneObjectInterfaces' {
    // extends OneCrdtMetaObjectInterfaces, extends is in recipes.ts
    export interface OneUnversionedObjectInterfaces {}

    // extends OneCrdtIdObjectInterfaces, extends is in recipes.ts
    export interface OneIdObjectInterfaces {}

    // extends OneCrdtObjectInterfaces, extends is in recipes.ts
    export interface OneVersionedObjectInterfaces {}

    export interface OneCrdtObjectInterfaces {}

    export interface PlanResultTypes {}
}
