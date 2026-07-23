import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Existing Supabase/JazzHR response normalization uses dynamic records
      // extensively. Tighten these incrementally as generated DB types land.
      "@typescript-eslint/no-explicit-any": "off",
      // Product copy contains contractions throughout the existing JSX.
      "react/no-unescaped-entities": "off",
      // These React 19 compiler-oriented rules identify useful refactors, but
      // are not correctness failures for this non-compiler application.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
]);
