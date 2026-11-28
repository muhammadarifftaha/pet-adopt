import { defineBlocks } from "@pet-adopt/plugin-sdk";
import { formBlock } from "@pet-adopt/plugin-form-builder/block";
import { instagramFeedBlock } from "@pet-adopt/plugin-instagram-feed/block";

// Page builder blocks that plugins add. Each one shows up in the page builder under "Plugins".
//
// This file is loaded by the browser (the page builder runs there), so import only a plugin's
// block module, never the plugin itself:
//
//   import { exampleBlock } from "pet-adopt-plugin-example/block";
//   export default defineBlocks([exampleBlock]);
//
// The plugin still goes in pet-adopt.config.ts as usual: that is where its screens, its storage
// and the server half of its blocks (what they load) come from.
export default defineBlocks([formBlock, instagramFeedBlock]);
