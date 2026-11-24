import { defineConfig } from "@pet-adopt/plugin-sdk";
import { adoptionTips } from "@pet-adopt/plugin-adoption-tips";
import { formBuilder } from "@pet-adopt/plugin-form-builder";
import { resendEmail } from "@pet-adopt/plugin-resend-email";

// Plugins are registered here. Each one can add screens (menu entry plus page under
// /admin/plugins/<name>/...) and dashboard widgets to the admin, with no other wiring.
// Each plugin is a workspace package in plugins/ (or an npm package) built on
// @pet-adopt/plugin-sdk. See plugins/adoption-tips for what a plugin looks like.
//
// Email: at most one plugin may send the site's email (password reset links). Resend is always
// registered so its admin page (/admin/plugins/resend-email) shows the setup; until RESEND_API_KEY
// and EMAIL_FROM are set it reports itself as not ready and the site offers no email. Replace it
// with another `email` plugin (SMTP, SES...) if you prefer.
export default defineConfig({
  plugins: [adoptionTips(), resendEmail(), formBuilder()],
});
