import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // The Android app's generated project and copied files (mobile/README.md).
      "mobile/node_modules/**",
      "mobile/android/**",
      "mobile/www/**",
    ],
  },
];

export default eslintConfig;
