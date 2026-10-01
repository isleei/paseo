import { rename, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";
import { seedWorkspace } from "../support/helpers/seed-client";
import { createMockIdleAgent } from "../support/helpers/archive-tab";
import { openAgentRoute } from "../support/helpers/mock-agent";
import { expectComposerVisible } from "../support/helpers/composer";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { TEST_HOST_LABEL } from "../support/helpers/daemon-registry";
import { startIsolatedHostDaemon } from "../support/helpers/isolated-host-daemon";
import { getServerId } from "../support/helpers/server-id";
import {
  expectSettingsHeader,
  openSettingsHost,
  openHostSection,
  expectHostLabelDisplayed,
  clickEditHostLabel,
  expectHostLabelEditMode,
  expectHostConnectionsCard,
  expectHostInjectMcpCard,
  expectHostActionCards,
  expectHostProvidersCard,
  expectHostNoDaemonLifecycleRow,
  expectRetiredSidebarSectionsAbsent,
  expectHostPageVisible,
  seedSavedSettingsHosts,
  selectSettingsHost,
  expectHostRejectedWithReAddGuidance,
  expectNoHostPasswordControls,
  removeHostFromHostPage,
  addDirectHostFromSettings,
  expectHostOnlineWithoutError,
} from "../support/helpers/settings";

test.describe("Settings host page", () => {
  test("visits host settings and opens the label editor", async ({ page }) => {
    const serverId = getServerId();
    const port = getE2EDaemonPort();
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, serverId);
    await test.step("connections section shows the seeded connection endpoint", async () => {
      await expectSettingsHeader(page, "Connections");
      await expectHostConnectionsCard(page, port);
    });
    await test.step("agents section shows the inject MCP toggle", async () => {
      await openHostSection(page, serverId, "agents");
      await expectSettingsHeader(page, "Agents");
      await expectHostInjectMcpCard(page);
    });
    await test.step("providers section shows the providers card", async () => {
      await expectHostProvidersCard(page, serverId);
      await expectSettingsHeader(page, "Providers");
    });
    await test.step("host section shows the host label and restart/remove action cards", async () => {
      await openHostSection(page, serverId, "host");
      await expectSettingsHeader(page, "Overview");
      await expectHostLabelDisplayed(page);
      await expectHostActionCards(page, serverId);
    });
    await test.step("clicking the label pencil reveals the inline editor", async () => {
      await openHostSection(page, serverId, "host");

      await expectHostLabelDisplayed(page);
      await clickEditHostLabel(page);
      await expectHostLabelEditMode(page, TEST_HOST_LABEL);
      await page.keyboard.press("Escape");
    });
    await test.step("host section does not render daemon lifecycle controls for a remote daemon", async () => {
      await openHostSection(page, serverId, "host");

      await expectHostNoDaemonLifecycleRow(page);
    });
    await test.step("settings sidebar exposes the flat App and Host section rows", async () => {
      await expectRetiredSidebarSectionsAbsent(page);
    });
  });

  test("a failed remote daemon update remains visible in the host UI", async ({
    page,
    outdatedDaemon,
  }) => {
    await seedSavedSettingsHosts(page, [outdatedDaemon]);
    await page.reload();
    await openSettings(page);
    await openSettingsHost(page, outdatedDaemon.serverId);
    await openHostSection(page, outdatedDaemon.serverId, "host");

    page.once("dialog", (dialog) => dialog.accept());
    const updateButton = page.getByTestId("host-page-update-button");
    await updateButton.click();

    await expect(
      updateButton.filter({ hasText: /Preparing update|Downloading packages|Installing/ }),
    ).toBeDisabled();

    const updateFailure = page.getByTestId("host-page-update-error");
    await expect(updateFailure).toBeVisible();
    await expect(updateFailure).toContainText("Update failed");
    await expect(updateFailure).toContainText("Failed to update the daemon:");
    await expect(updateButton).toBeEnabled();
  });

  test("a host rejected for its password reconnects after being removed and added again with it", async ({
    page,
  }) => {
    const password = "e2e host password";
    const daemon = await startIsolatedHostDaemon("srv_e2e_password_host", {
      environment: { ...process.env, PASEO_PASSWORD: password },
    });
    try {
      await seedSavedSettingsHosts(page, [
        {
          serverId: getServerId(),
          label: TEST_HOST_LABEL,
          endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
        },
        {
          serverId: daemon.serverId,
          label: "Password host",
          endpoint: `127.0.0.1:${daemon.port}`,
        },
      ]);
      await page.reload();
      await openSettings(page);
      await selectSettingsHost(page, daemon.serverId);
      await openHostSection(page, daemon.serverId, "host");

      await test.step("the host page shows the reason and the re-add guidance, with no password UI", async () => {
        await expectHostRejectedWithReAddGuidance(page, "Password required");
        await expectNoHostPasswordControls(page);
      });

      await test.step("removing the host and adding it again with the password brings it online", async () => {
        await removeHostFromHostPage(page, daemon.serverId);
        await addDirectHostFromSettings(page, { host: "127.0.0.1", port: daemon.port, password });
        await openHostSection(page, daemon.serverId, "host");
        await expectHostOnlineWithoutError(page);
      });
    } finally {
      await daemon.close();
    }
  });

  test("navigating to /settings/hosts/[serverId] redirects to the connections section", async ({
    page,
  }) => {
    const serverId = getServerId();

    await gotoAppShell(page);
    await page.goto(`/settings/hosts/${encodeURIComponent(serverId)}`);

    await expectHostPageVisible(page, serverId);
    await expectSettingsHeader(page, "Connections");
    await openHostSection(page, serverId, "host");
    await expectHostLabelDisplayed(page);
    await expectHostActionCards(page, serverId);
  });
});

test("automatic retry settings persist and expose save failures", async ({ page }, testInfo) => {
  const client = await connectDaemonClient<
    import("@getpaseo/client/internal/daemon-client").DaemonClient
  >({ clientIdPrefix: "retry-settings-e2e" });
  const previous = (await client.getDaemonConfig()).config.agentRetryAttempts;
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("Missing isolated test home");
  const configFile = path.join(home, "config.json");
  const backup = path.join(home, "retry-test-config-backup.json");
  let blocked = false;
  try {
    await client.patchDaemonConfig({ agentRetryAttempts: 2 });
    await gotoAppShell(page);
    await openSettings(page);
    await openSettingsHost(page, getServerId());
    await openHostSection(page, getServerId(), "agents");
    const card = page.getByTestId("agent-retry-settings");
    await expect(
      card.getByRole("button", { name: "Retry after failure: 2", exact: true }),
    ).toBeVisible();
    await card.getByRole("button").click();
    await page.getByRole("menuitem", { name: "Off", exact: true }).click();
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.agentRetryAttempts)
      .toBe(0);
    await page.reload();
    await expect(
      card.getByRole("button", { name: "Retry after failure: Off", exact: true }),
    ).toBeVisible();
    await rename(configFile, backup);
    await mkdir(configFile);
    blocked = true;
    await card.getByRole("button").click();
    await page.getByRole("menuitem", { name: "3", exact: true }).click();
    await expect(card.getByRole("alert")).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Retry after failure: Off", exact: true }),
    ).toBeEnabled();
    await rm(configFile, { recursive: true });
    await rename(backup, configFile);
    blocked = false;
    await card.getByRole("button").click();
    await page.getByRole("menuitem", { name: "3", exact: true }).click();
    await expect(card.getByRole("alert")).toHaveCount(0);
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.agentRetryAttempts)
      .toBe(3);
    await page.screenshot({ path: testInfo.outputPath("retry-settings.png") });
  } finally {
    if (blocked) {
      await rm(configFile, { recursive: true });
      await rename(backup, configFile);
    }
    await client.patchDaemonConfig({ agentRetryAttempts: previous ?? 2 });
    await client.close();
  }
});

test("automatic retry countdown survives reload, retries immediately, and can be canceled", async ({
  page,
}, testInfo) => {
  const workspace = await seedWorkspace({ repoPrefix: "retry-chat-" });
  const client = await connectDaemonClient<
    import("@getpaseo/client/internal/daemon-client").DaemonClient
  >({ clientIdPrefix: "retry-chat-e2e" });
  try {
    const agent = await createMockIdleAgent(workspace.client, {
      cwd: workspace.repoPath,
      workspaceId: workspace.workspaceId,
      title: "Retry test",
    });
    await gotoAppShell(page);
    await expect
      .poll(async () =>
        (await client.fetchWorkspaces()).entries.some(
          (entry) => entry.id === workspace.workspaceId,
        ),
      )
      .toBe(true);
    await openAgentRoute(page, { workspaceId: agent.workspaceId, agentId: agent.id });
    await expectComposerVisible(page);
    await client.sendAgentMessage(agent.id, "Emit a synthetic transient turn failure.");
    const banner = page.getByTestId("agent-retry-status");
    await expect(banner).toContainText("1/2");
    await page.reload();
    await expect(banner).toContainText("1/2");
    await page.screenshot({ path: testInfo.outputPath("retry-chat.png") });
    await banner.getByRole("button", { name: "Retry now", exact: true }).click();
    await expect(banner).toHaveCount(0);
    await expect
      .poll(async () => (await client.fetchAgent({ agentId: agent.id }))?.agent?.retry)
      .toBeNull();
    await client.cancelAgent(agent.id);
    await client.sendAgentMessage(agent.id, "Emit a synthetic transient turn failure.");
    await expect(banner).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath("retry-chat-compact.png") });
    await banner.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(banner).toHaveCount(0);
    await expect
      .poll(async () => (await client.fetchAgent({ agentId: agent.id }))?.agent?.status)
      .toBe("idle");
    await expect(client.retryAgentNow(agent.id)).rejects.toThrow("not waiting");
  } finally {
    await client.close();
    await workspace.cleanup();
  }
});
