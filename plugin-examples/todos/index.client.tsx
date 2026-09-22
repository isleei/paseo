import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TasksBoard } from "./client/board";
import { TasksPanel } from "./client/panel";
import { createTaskRpc } from "./shared/todo";

export default function contribute(client: PluginClientContext) {
  client.addSurface("todos", TasksBoard);
  client.addSidebarItem({ id: "todos", title: "Tasks", icon: "ListChecks", surface: "todos" });
  client.addWorkspacePanel({
    id: "todos-panel",
    title: "Tasks",
    icon: "ListChecks",
    context: "workspace",
    locations: ["workspace"],
    Component: TasksPanel,
  });
  client.addCommandCenterItem({
    id: "open-todos",
    title: "Open Tasks",
    icon: "ListChecks",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("todos");
    },
  });
  client.addSlashCommand({
    name: "task",
    description: "Create a task",
    argumentHint: "[title]",
    context: "workspace",
    async onSubmit({ args, rpc }) {
      const title = args.trim();
      if (title) await rpc(createTaskRpc, { title });
    },
  });
  client.addSlashCommand({
    name: "todo",
    description: "Create a task (legacy alias)",
    argumentHint: "[title]",
    context: "workspace",
    async onSubmit({ args, rpc }) {
      const title = args.trim();
      if (title) await rpc(createTaskRpc, { title });
    },
  });
  return () => {};
}
