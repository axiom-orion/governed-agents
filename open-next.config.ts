// OpenNext adapter config for Cloudflare Workers. The app renders dynamically and keeps
// no ISR state, so the default (no incremental cache) is enough.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
