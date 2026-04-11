import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintTypecheckConfig from "./eslint-typecheck.config.mjs";
import eslintSecurityConfig from "./eslint-security.config.mjs";

export default tseslint.config(
  ...eslintTypecheckConfig,
  ...eslintSecurityConfig,
  {
    ignores: ["eslint.config.mjs", "dist/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  jsdoc.configs["flat/recommended-typescript"],
  eslintConfigPrettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: "commonjs",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unsafe-argument": "warn",
      "max-params": ["error", 5], // max-args = 5
      "max-statements": ["error", 30], // max-statements = 30
      "jsdoc/require-jsdoc": [
        "error",
        {
          contexts: [
            "FunctionDeclaration",
            "MethodDefinition",
            "ClassDeclaration",
          ],
        },
      ],
      "jsdoc/require-description": "error",
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "no-unreachable": "error",
      "default-case": "error", // Exhaustive switch cases
      "consistent-return": "error", // Explicit returns
      "prefer-const": "error", // Immutability like Rust
      "@typescript-eslint/switch-exhaustiveness-check": "error", // Match Rust pattern exhaustiveness
      // Anti-agent-bias rules
      complexity: ["error", 15], // Cognitive complexity limit
      // "no-magic-numbers": ["error", {"ignore": [0, 1, -1]}], // Disabled - no equivalent scope to Python PLR2004 (comparison-only)
      "id-length": ["error", { min: 2, max: 30 }], // Variable name length
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  }
);
