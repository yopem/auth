import baseConfig from "@yopem/oxlint-config"
import effectConfig from "@yopem/oxlint-config/effect"
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite-plus"

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  lint: {
    extends: [baseConfig, effectConfig],
    plugins: ["eslint", "import", "oxc", "promise", "typescript", "unicorn"],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: baseConfig.options,
  },
  fmt: {
    bracketSpacing: true,
    jsxSingleQuote: false,
    printWidth: 80,
    proseWrap: "always",
    semi: false,
    singleQuote: false,
    tabWidth: 2,
    trailingComma: "all",
    sortImports: {
      newlinesBetween: true,
      groups: [
        "type-import",
        ["value-builtin", "value-external"],
        "type-internal",
        "value-internal",
        ["type-parent", "type-sibling", "type-index"],
        ["value-parent", "value-sibling", "value-index"],
        "unknown",
      ],
    },
    experimentalSortPackageJson: true,
    ignorePatterns: ["**/pnpm-lock.yaml", "**/AGENTS.md"],
  },
})
