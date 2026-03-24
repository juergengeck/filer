module.exports = {
    root: true,
    // eslint recommended defaults can be found in [INSTALL_DIR]/eslint/conf/eslint.json
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'prettier'
    ],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: 2022,
        ecmaFeatures: {impliedStrict: true},
        project: ['./tsconfig.json', './src/tsconfig.json', './test/tsconfig.json']
    },
    ignorePatterns: ['*.js'],
    env: {
        es6: true,
        mocha: true,
        node: true
    },
    plugins: ['@typescript-eslint', 'jsdoc', 'prettier'],
    rules: {
        'jsdoc/check-alignment': 'error',
        'jsdoc/check-examples': 'off',
        'jsdoc/check-indentation': 'off',
        'jsdoc/check-param-names': 'error',
        'jsdoc/check-syntax': 'error',
        'jsdoc/check-tag-names': 'error',
        'jsdoc/check-types': 'error',
        'jsdoc/implements-on-classes': 'error',
        'jsdoc/match-description': 'off',
        'jsdoc/newline-after-description': 'off',
        'jsdoc/no-types': 'off',
        'jsdoc/no-undefined-types': 'off',
        'jsdoc/require-description-complete-sentence': 'off',
        'jsdoc/require-description': 'off',
        'jsdoc/require-example': 'off',
        'jsdoc/require-hyphen-before-param-description': 'error',
        'jsdoc/require-jsdoc': ['off', {publicOnly: true}],
        'jsdoc/require-param-description': 'off',
        'jsdoc/require-param-name': 'off',
        'jsdoc/require-param-type': 'off',
        'jsdoc/require-param': 'off',
        'jsdoc/require-returns-check': 'error',
        'jsdoc/require-returns-description': 'off',
        'jsdoc/require-returns-type': 'error',
        'jsdoc/require-returns': 'off',
        'jsdoc/valid-types': 'off',

        '@typescript-eslint/array-type': ['error', {default: 'array-simple'}],
        '@typescript-eslint/brace-style': ['error', '1tbs', {allowSingleLine: false}],
        '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
        '@typescript-eslint/consistent-type-imports': ['error', {prefer: 'type-imports'}],
        'func-call-spacing': 'off',
        '@typescript-eslint/func-call-spacing': ['error'],
        '@typescript-eslint/no-extra-parens': 'off', // 'all',{'nestedBinaryExpressions': false}
        '@typescript-eslint/consistent-type-assertions': 'off',
        '@typescript-eslint/explicit-function-return-type': [
            'error',
            {
                allowExpressions: true,
                allowTypedFunctionExpressions: true
            }
        ],
        '@typescript-eslint/indent': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        // Requires Promise-like values to be handled appropriately
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-inferrable-types': 'off',
        '@typescript-eslint/no-namespace': 'error',
        '@typescript-eslint/no-misused-promises': ['error', {checksVoidReturn: false}],
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-unused-vars': [
            'warn',
            {
                vars: 'all',
                args: 'all',
                argsIgnorePattern: '^_|^ignore',
                varsIgnorePattern: '^_|^ignore',
                caughtErrors: 'all',
                caughtErrorsIgnorePattern: '^ignore'
            }
        ],
        '@typescript-eslint/no-use-before-define': 'off',
        '@typescript-eslint/prefer-for-of': ['error'],
        // ENABLE TEMPORARILY: Used to check the whole code, but left disabled because we have
        // too many false positives which we don't want to disable individually
        '@typescript-eslint/return-await': ['off', 'always'],

        '@typescript-eslint/unbound-method': 'off',

        // Disallow async functions which have no await expression
        'require-await': 'off',
        '@typescript-eslint/require-await': 'off',

        // '@typescript-eslint/semi': ['error', 'always'],
        '@typescript-eslint/semi': 'off',

        // -------------------------------------------------------------------------
        // eslint rules
        // -------------------------------------------------------------------------

        'no-restricted-syntax': ['error', 'WithStatement'],
        // enforce line breaks after opening and before closing array brackets
        'array-bracket-newline': 'off',
        // Enforces return statements in callbacks of array's methods
        'array-callback-return': 'error',
        // Require parens in arrow function arguments
        'arrow-parens': ['off', 'as-needed'],
        // Enforces getter/setter pairs in objects
        'accessor-pairs': ['off', {setWithoutGet: true, getWithoutSet: false}],
        // Require space before/after arrow functions arrow
        'arrow-spacing': ['error', {before: true, after: true}],
        'brace-style': ['error', '1tbs', {allowSingleLine: false}],
        'consistent-this': ['error', 'self'],
        // Disallow trailing commas
        'comma-dangle': [
            'error',
            {
                arrays: 'never',
                objects: 'never',
                imports: 'never',
                exports: 'never',
                functions: 'never'
            }
        ],
        'comma-style': ['error', 'last'],
        // Require optional curly braces when a block contains only one statement after if,
        // else, while, etc.
        curly: ['error', 'all'],
        // Enforce newline before and after dot
        'dot-location': ['error', 'property'],
        // 'allowPattern': '^[a-z]+(_[a-z]+)+$'
        'dot-notation': ['warn', {allowKeywords: true}],
        'eol-last': 'error',
        // Require === and !==
        eqeqeq: 'error',
        // Enforce “for” loop update clause moving the counter in the right direction
        'for-direction': 'error',
        'func-style': ['error', 'declaration'],
        // Enforce consistent line breaks inside function parentheses - off, conflicts with prettier
        'function-paren-newline': ['off'],
        'generator-star-spacing': ['error', {before: true, after: false}],
        // Disallow require() outside of the top-level module scope
        'global-require': 'error',
        'key-spacing': ['error', {beforeColon: false, afterColon: true}],
        'keyword-spacing': 'error',
        'max-nested-callbacks': ['warn', 4],
        // Require newline before return statement
        'newline-before-return': 'off',
        // Require a newline after each call in a method chain
        'newline-per-chained-call': ['error', {ignoreChainWithDepth: 3}],
        'no-alert': 'error',
        // Disallow using an async function as a Promise executor
        'no-async-promise-executor': 'error',
        // Warn about await inside of loops
        'no-await-in-loop': 'warn',
        // disallow use of the Buffer() constructor
        'no-buffer-constructor': 'error',
        // Disallow Use of caller/callee
        'no-caller': 'error',
        // Disallow lexical declarations in case/default clauses
        'no-case-declarations': 'error',
        // disallow comparing against -0
        'no-compare-neg-zero': 'error',
        // Disallow assignment in conditional statements
        'no-cond-assign': 'error',
        // Disallow arrow functions where they could be confused with comparisons
        'no-confusing-arrow': 'off',
        // Disallow the use of console
        'no-console': 'off',
        // Disallow modifying variables that are declared using const
        'no-const-assign': 'error',
        // Disallow use of constant expressions in conditions
        'no-constant-condition': 'error',
        // Disallow controls characters in regular expressions
        'no-control-regex': 'error',
        // Disallow 'debugger' statement
        'no-debugger': 'error',
        // Disallow duplicate keys
        'no-dupe-keys': 'error',
        // Rule to disallow a duplicate case label
        'no-duplicate-case': 'error',
        // Disallow duplicate imports: OFF - TypeScript conflict with "import type"
        'no-duplicate-imports': 'off',
        // Disallow empty block statements
        'no-empty': 'error',
        // Disallow empty character classes
        'no-empty-character-class': 'error',
        // Disallow empty functions
        'no-empty-function': 'off',
        'no-eq-null': 'error',
        // Disallow assigning to the exception in a catch block
        'no-ex-assign': 'error',
        // Disallow unnecessary semicolons
        'no-extra-semi': 'error',
        // Disallow overwriting functions written as function declarations
        'no-func-assign': 'error',
        // Disallow assignment to native objects or read-only global variables
        'no-global-assign': 'error',
        // Disallow this keywords outside of classes or class-like objects
        'no-invalid-this': 'error',
        // Disallow irregular whitespace outside of strings and comments
        'no-irregular-whitespace': 'error',
        'no-lonely-if': 'error',
        // Disallow mixes of different operators
        'no-mixed-operators': 'error',
        'no-mixed-spaces-and-tabs': 'error',
        'no-multi-spaces': ['error', {ignoreEOLComments: true}],
        'no-negated-condition': 'error',
        // Disallow negation of the left operand of an in expression
        'no-negated-in-lhs': 'error',
        // Disallow Symbol Constructor
        'no-new-symbol': 'error',
        // Disallow the use of object properties of the global object (Math and JSON) as functions
        'no-obj-calls': 'error',
        // Disallow reassignment of function parameters
        'no-param-reassign': ['error', {props: false}],
        // Disallow string concatenation when using _dirname and _filename
        'no-path-concat': 'error',
        // Disallow the unary operators ++ and --
        'no-plusplus': ['off', {allowForLoopAfterthoughts: true}],
        // Disallow redeclaring variables
        'no-redeclare': ['error', {builtinGlobals: true}],
        // Disallows "return await" -- THIS RULE IS STUPID, in current versions of V8 using
        // "return awiat promise;" is MANDATORY - it enables free ("zero cost") asynchrous stack
        // traces that include the calling function. If it returns the promise instead of waiting
        // for the promise's result it will not appear in the stack trace!
        // ALWAYS TURN THIS RULE OFF (we actually need the opposite!)
        'no-return-await': 'off',
        // Disallow Self Assignment
        'no-self-assign': 'error',
        'no-self-compare': 'error',
        // Disallow variable declarations from shadowing variables declared in the outer scope
        'no-shadow': 'error',
        'no-sync': 'off',
        // Disallow tabs in file
        'no-tabs': 'error',
        // Disallow template literal placeholder syntax in regular strings
        'no-template-curly-in-string': 'error',
        'no-trailing-spaces': 'error',
        'no-throw-literal': 'error',
        // Disallow Undeclared Variables OFF: Typescript takes care of these
        'no-undef': 'off',
        'no-underscore-dangle': 'off',
        // Avoid code that looks like two expressions but is actually one
        'no-unexpected-multiline': 'error',
        // Disallow unreachable statements after a return, throw, continue, or break statement
        'no-unreachable': 'error',
        // Disallow control flow statements in finally blocks
        'no-unsafe-finally': 'error',
        // Disallow negating the left operand of relational operators
        'no-unsafe-negation': 'error',
        // Disallow unnecessary .call() and .apply()
        'no-useless-call': 'warn',
        // Disallow unnecessary catch claus
        'no-useless-catch': 'error',
        // Disallow unnecessary computed property keys on objects
        'no-useless-computed-key': 'error',
        // Disallow unncessary concatenation of strings
        'no-useless-concat': 'error',
        // Disallow unnecessary escape usage
        'no-useless-escape': 'error',
        // Disallow renaming import, export, and destructured assignments to the same name
        'no-useless-rename': 'error',
        // Disallow 'var' to declare variables
        'no-var': 'error',
        // Disallow whitespace before properties
        'no-whitespace-before-property': 'error',
        'operator-linebreak': ['error', 'after', {overrides: {'?': 'ignore', ':': 'ignore'}}],
        'padded-blocks': ['off', 'never'],
        'padding-line-between-statements': [
            'error',
            {blankLine: 'always', prev: 'directive', next: 'import'},
            {blankLine: 'always', prev: 'import', next: '*'},
            {blankLine: 'any', prev: 'import', next: 'import'},
            {blankLine: 'any', prev: 'case', next: '*'},
            {blankLine: 'always', prev: '*', next: ['export', 'cjs-export']},
            {blankLine: 'always', prev: ['export', 'cjs-export'], next: '*'},
            {blankLine: 'any', prev: ['export', 'cjs-export'], next: ['export', 'cjs-export']},
            {blankLine: 'always', prev: '*', next: ['while', 'switch', 'for', 'if', 'try']},
            {blankLine: 'always', prev: '*', next: ['block', 'block-like']},
            {blankLine: 'any', prev: 'case', next: ['block', 'block-like']},
            {blankLine: 'always', prev: ['block', 'block-like'], next: 'return'},
            {blankLine: 'always', prev: '*', next: ['const', 'let']},
            {blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let']}
        ],
        // Suggest using arrow functions as callbacks
        // DISADVANTAGE:No name in stack traces
        'prefer-arrow-callback': 'off',
        // Prefer 'const' over 'let' for constant variables
        'prefer-const': 'error',
        // require using Error objects as Promise rejection reasons
        'prefer-promise-reject-errors': 'error',
        // Suggest using Reflect methods where applicable
        'prefer-reflect': 'off',
        // Suggest using the rest parameters instead of arguments
        'prefer-rest-params': 'error',
        // Suggest using of the spread operator instead of .apply()
        'prefer-spread': 'error',
        // Use single quotes except when it conflicts with prettier's escape-avoidance feature
        quotes: ['error', 'single', {avoidEscape: true}],
        radix: 'error',
        // Disallow assignments that can lead to race conditions due to usage of await or yield
        // Turned off because of https://github.com/eslint/eslint/issues/11723#issuecomment-504649390
        'require-atomic-updates': 'off',
        'require-yield': 'error',
        'sort-imports': [
            'off',
            {
                ignoreCase: false,
                ignoreDeclarationSort: false,
                ignoreMemberSort: false,
                memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single']
            }
        ],
        // Requires or disallows a whitespace (space or tab) beginning a comment
        'spaced-comment': [
            'warn',
            'always',
            {
                line: {
                    exceptions: ['region', 'endregion', '-', '+'],
                    markers: ['region', 'endregion', 'noinspection', 'global', 'eslint-disable']
                },
                block: {
                    exceptions: ['*'],
                    markers: ['eslint-disable', 'eslint-enabled', '?:', ':', '::']
                }
            }
        ],
        'space-before-blocks': ['error', 'always'],
        'space-before-function-paren': [
            'error',
            {
                anonymous: 'never',
                named: 'never',
                asyncArrow: 'always'
            }
        ],
        'space-in-parens': ['error', 'never'],
        // Require spaces around infix operators
        'space-infix-ops': 'error',
        'space-unary-ops': ['error', {words: true, nonwords: false}],
        // Turned off to make it work in the Flow context
        strict: ['off', 'global'],
        'switch-colon-spacing': ['error', {after: true, before: false}],
        // Enforce Usage of Spacing in Template Strings
        'template-curly-spacing': 'error',
        // Require or disallow the Unicode Byte Order Mark
        'unicode-bom': 'error',
        // Disallow comparisons with the value NaN
        'use-isnan': 'error'
    },
    settings: {
        jsdoc: {
            tagNamePreference: {
                function: 'function',
                file: 'file',
                link: 'link',
                property: 'property',
                throws: 'throws',
                param: 'param',
                returns: 'returns'
            },
            preferredTypes: {
                '.<>': '<>'
            }
        }
    }
};
