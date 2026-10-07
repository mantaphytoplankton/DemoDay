import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", ".next-e2e/**", "node_modules/**", "specs/**", "coverage/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  {
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }] },
  },
  {
    files: ["tests/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    // Client code must never import server modules (API keys, filesystem).
    files: ["src/components/**", "src/hooks/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/server/*", "**/server/*"], message: "Server-only module" }] }],
    },
  },
  {
    // User-facing text goes through t() (i18n).
    files: ["src/components/**/*.tsx", "src/app/**/*.tsx"],
    rules: { "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, allowedStrings: ["·", "/", "%", "–", "(", ")", ":", "…", ",", ".", "E", "J", "K", "?", "Esc"] }] },
  },
];

export default config;
