import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import inngest from "@inngest/eslint-plugin";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Inngest's own rules. no-nested-steps is the one that matters: a step inside a step does
  // not throw, it hangs the run with no error anywhere - which is exactly how it was found.
  {
    files: ["src/lib/heal/workflow.ts", "src/lib/**/*.ts", "src/app/api/inngest/**/*.ts"],
    plugins: { "@inngest": inngest },
    rules: {
      "@inngest/no-nested-steps": "error",
      "@inngest/no-variable-mutation-in-step": "error",
      "@inngest/await-inngest-send": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
