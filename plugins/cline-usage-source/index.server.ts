import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema } from "./shared/input.js";
import { fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "cline",
    label: "Cline",
    icon: "icon.svg",
    input: inputSchema,
    discover: async () => [{ key: "default", input: {} }],
    fetch: fetchUsage,
  });
  return () => {};
}
