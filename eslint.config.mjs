import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A disable comment that no longer disables anything fails: delete it
    // (eslint --fix does).
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    // Style and React Compiler advice (the compiler is not enabled): warnings,
    // so they stay visible without blocking a merge, and CI only stops their
    // count from growing.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      "@next/next/no-html-link-for-pages": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      // The compiler crashed on this component, so none of its other checks
      // ran there, the error-level ones included. Rewrite the construct it
      // points at, e.g. a catch binding used in a callback, or an IIFE in JSX.
      "react-hooks/invariant": "error",
      // A leading _ marks a binding unused on purpose; a rest sibling omits a key.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    files: ["tests/e2e/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='isVisible'] > ObjectExpression > Property[key.name='timeout']",
          message: "isVisible() ignores its timeout and answers at once: use visibleWithin() from tests/e2e/helpers.ts.",
        },
      ],
    },
  },
  {
    files: ["scripts/**"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // Plain <img> on purpose. Photos come through proxyImageUrl already sized,
    // and next/image would process them again. Uploaded avatars are served
    // from Supabase Storage, which images.remotePatterns doesn't list. The
    // hero doodles are small decorative webp.
    files: [
      "**/InviteAcceptClient.tsx",
      "**/TemplatesPageClient.tsx",
      "components/ActivityCard.tsx",
      "components/trip/AddActivityButton.tsx",
      "components/trip/EditableActivityCard.tsx",
      "components/trips/TripsPageClient.tsx",
      "components/ui/ActivityDetailSheet.tsx",
      "components/collaboration/CollaboratorAvatars.tsx",
      "components/collaboration/CollaboratorRow.tsx",
      "components/collaboration/VotingSection.tsx",
      "components/marketing/HeroDoodleBackground.tsx",
    ],
    rules: { "@next/next/no-img-element": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "android/**",
    "ios/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
