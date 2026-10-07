import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
  recommendedConfig: js.configs.recommended,
});

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "graphify-out/**",
      ".superpowers/**",
      ".worktrees/**",
      "eslint.config.js",
    ],
  },
  ...compat.extends("airbnb-base"),
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true, project: "./tsconfig.json" },
        node: { extensions: [".js", ".ts"] },
      },
      "import/extensions": [".js", ".ts"],
    },
    rules: {
      "no-console": ["error", { allow: ["error", "log"] }],
      "no-continue": "off",
      "no-await-in-loop": "off",
      "no-plusplus": ["error", { allowForLoopAfterthoughts: true }],
      "no-void": ["error", { allowAsStatement: true }],
      "consistent-return": "off",
      "object-curly-newline": ["error", { consistent: true }],
      "max-len": [
        "error",
        {
          code: 120,
          ignoreStrings: true,
          ignoreTemplateLiterals: true,
          ignoreComments: true,
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ForInStatement",
          message: "for-in enumerates inherited keys; use Object.keys or for-of",
        },
        {
          selector: "LabeledStatement",
          message: "Labels are a form of GOTO",
        },
        {
          selector: "WithStatement",
          message: "`with` is disallowed",
        },
      ],
      "no-underscore-dangle": ["error", { allow: ["_never"] }],
      "no-use-before-define": "off",
      quotes: ["error", "double", { avoidEscape: true }],
      "import/extensions": ["error", "ignorePackages", { ts: "always", js: "always" }],
      "import/prefer-default-export": "off",
      "import/no-extraneous-dependencies": [
        "error",
        { devDependencies: ["tests/**", "vitest.config.ts"] },
      ],
      "import/no-unresolved": ["error", { ignore: ["^bun:"] }],
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/no-use-before-define": ["error", { functions: false }],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-dynamic-delete": "off",
      "@typescript-eslint/no-base-to-string": "off",
    },
  },
);
