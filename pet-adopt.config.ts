import { defineConfig } from "@/plugins/define";
import { adoptionTips } from "@/plugins/example";

// Plugins are registered here. Each one can add screens (menu entry plus page under
// /admin/plugins/<name>/...) and dashboard widgets to the admin, with no other wiring.
// See src/plugins/example.tsx for what a plugin looks like.
export default defineConfig({
  plugins: [adoptionTips()],
});
