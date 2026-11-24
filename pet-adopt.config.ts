import { defineConfig } from "@/plugins/define";
import { adoptionTips } from "@/plugins/example";
import { formBuilder } from "@/plugins/form-builder";
import { resendEmail } from "@/plugins/resend";

// Plugins are registered here. Each one can add screens (menu entry plus page under
// /admin/plugins/<name>/...) and dashboard widgets to the admin, with no other wiring.
// See src/plugins/example.tsx for what a plugin looks like.
//
// Email: at most one plugin may send the site's email (password reset links). Resend is always
// registered so its admin page (/admin/plugins/resend-email) shows the setup; until RESEND_API_KEY
// and EMAIL_FROM are set it reports itself as not ready and the site offers no email. Replace it
// with another `email` plugin (SMTP, SES...) if you prefer.
export default defineConfig({
  plugins: [adoptionTips(), resendEmail(), formBuilder()],
});
