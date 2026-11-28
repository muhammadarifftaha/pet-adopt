// Lints this package with the app's rules (apps/web/eslint.config.mjs), so the whole workspace
// follows one set. Packages are not Next.js apps: the rule that looks for a `pages` folder is off.
import app from "../../apps/web/eslint.config.mjs";

const config = [...app, { rules: { "@next/next/no-html-link-for-pages": "off" } }];

export default config;
