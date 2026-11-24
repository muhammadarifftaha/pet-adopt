import { defineConfig } from "@/plugins/define";
import { adoptionTips } from "@/plugins/example";
import { resendEmail } from "@/plugins/resend";

// Plugins are registered here. Each one can add screens (menu entry plus page under
// /admin/plugins/<name>/...) and dashboard widgets to the admin, with no other wiring.
// See src/plugins/example.tsx for what a plugin looks like.
//
// Email: at most one plugin may send the site's email (password reset links). Resend is used when
// RESEND_API_KEY is set; replace it with another `email` plugin (SMTP, SES...) if you prefer.
export default defineConfig({
  plugins: [adoptionTips(), ...(process.env.RESEND_API_KEY ? [resendEmail()] : [])],
});
