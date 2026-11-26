import { defineConfig } from "@pet-adopt/plugin-sdk";
import { adoptionTips } from "@pet-adopt/plugin-adoption-tips";
import { formBuilder } from "@pet-adopt/plugin-form-builder";

// Plugins are registered here. Each one can add screens (menu entry plus page under
// /admin/plugins/<name>/...) and dashboard widgets to the admin, with no other wiring.
// Each plugin is a workspace package in plugins/ (or an npm package) built on
// @pet-adopt/plugin-sdk. See plugins/adoption-tips for what a plugin looks like.
//
// Email is built in (SMTP, set up in Settings > Email). A plugin with `email: { send }` can replace it,
// for example to send through a provider's HTTP API where SMTP ports are blocked; at most one may.
export default defineConfig({
  plugins: [adoptionTips(), formBuilder()],
});
