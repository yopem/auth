import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem"
import baseConfig from "@yopem/oxlint-config"
import effectConfig from "@yopem/oxlint-config/effect"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite-plus"

export default defineConfig(async ({ command }) => {
  const appName =
    command === "build"
      ? await Effect.runPromise(
          Config.NonEmptyString("APP_NAME").pipe(
            Effect.provide(
              ConfigProvider.layerAdd(
                ConfigProvider.fromDotEnv({
                  path: ".env",
                  preserveEmptyStrings: true,
                }),
                { asPrimary: false },
              ),
            ),
            Effect.provide(NodeFileSystem.layer),
          ),
        )
      : undefined

  return {
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      conditions: command === "build" ? ["browser"] : undefined,
    },
    define:
      command === "build" ? { "globalThis.__ALCHEMY_RUNTIME__": "true" } : {},
    plugins: [
      {
        name: "native-worker-entry",
        apply: "build",
        resolveId(id) {
          if (id.endsWith("native-worker-entry")) return "\0native-worker-entry"
        },
        load(id) {
          if (id === "\0native-worker-entry") {
            return `
            import { WorkerEntrypoint } from "cloudflare:workers"
            import { makeWorkerBridge } from "alchemy/Cloudflare/Bridge"
            import entrypoint from "@/index"
            export default makeWorkerBridge(WorkerEntrypoint, {
              entrypoint,
              stack: { name: ${JSON.stringify(appName)}, stage: "prod" },
            })
          `
          }
        },
      },
    ],
    build: {
      lib: {
        entry: "native-worker-entry",
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: {
        external: /^(node:|cloudflare:)/,
        output: { codeSplitting: false },
      },
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
  }
})
