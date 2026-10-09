import { expect, test, type Page } from "../support/fixtures";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import {
  expectSettingsHeader,
  openHostSection,
  openSettingsHost,
} from "../support/helpers/settings";

async function openMetadataGenerationSettings(page: Page) {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openHostSection(page, serverId, "metadata");
  await expectSettingsHeader(page, "Metadata");
}

async function openManualMetadataModelPicker(page: Page) {
  const section = page.getByTestId("metadata-generation-settings");
  await section.getByRole("button", { name: "Manual", exact: true }).click();
  await section.getByRole("button", { name: /Select model/ }).click();
}

test("chooses a metadata model and can return to automatic selection", async ({
  page,
}, testInfo) => {
  await openMetadataGenerationSettings(page);

  // The section explains itself through the header's info tooltip, not a paragraph.
  await expect(page.getByTestId("metadata-generation-settings-info")).toHaveAccessibleName(
    "About Metadata generation",
  );
  await expect(
    page
      .getByTestId("metadata-generation-settings")
      .getByRole("button", { name: "Automatic", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: testInfo.outputPath("metadata-automatic.png"),
    fullPage: true,
  });

  await openManualMetadataModelPicker(page);
  await page.getByText("Mock Load Test", { exact: true }).click();
  await expect(page.getByText("Ten second stream", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("metadata-model-picker.png"),
    fullPage: true,
  });
  await page.getByText("Ten second stream", { exact: true }).click();

  await expect(page.getByRole("button", { name: /Ten second stream/ })).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByTestId("metadata-generation-settings")
      .getByRole("button", { name: "Manual", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /Ten second stream/ })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("metadata-manual-persisted.png"),
    fullPage: true,
  });

  await page
    .getByTestId("metadata-generation-settings")
    .getByRole("button", { name: "Automatic", exact: true })
    .click();
  await page.reload();

  await expect(
    page
      .getByTestId("metadata-generation-settings")
      .getByRole("button", { name: "Automatic", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: /Ten second stream/ })).toHaveCount(0);
});

test("replaces only the first configured metadata model", async ({ page }) => {
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previousConfig = await client.getDaemonConfig();

  try {
    await client.patchDaemonConfig({
      metadataGeneration: {
        providers: [
          { provider: "mock", model: "five-minute-stream" },
          { provider: "mock", model: "thirty-minute-stream" },
        ],
      },
    });
    await openMetadataGenerationSettings(page);

    await expect(
      page
        .getByTestId("metadata-generation-settings")
        .getByRole("button", { name: "Manual", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await openManualMetadataModelPicker(page);
    await page.getByText("Ten second stream", { exact: true }).click();

    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration.providers)
      .toEqual([
        { provider: "mock", model: "ten-second-stream" },
        { provider: "mock", model: "thirty-minute-stream" },
      ]);
  } finally {
    try {
      await client.patchDaemonConfig({
        metadataGeneration: {
          providers: previousConfig.config.metadataGeneration.providers,
        },
      });
    } finally {
      await client.close().catch(() => undefined);
    }
  }
});

test("suggestion models persist independently and expose save failures", async ({ page }) => {
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = await client.getDaemonConfig();
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("Missing isolated test home");
  const configFile = path.join(home, "config.json");
  const backup = path.join(home, "suggestion-model-test-config-backup.json");
  let blocked = false;
  const shared = [{ provider: "mock", model: "thirty-minute-stream" }];
  try {
    await client.patchDaemonConfig({
      metadataGeneration: { providers: shared, promptSuggestions: { providers: [] } },
    });
    await openMetadataGenerationSettings(page);
    const section = page.getByTestId("suggestion-model-settings");
    const automatic = section.getByRole("button", { name: "Automatic", exact: true });
    const manual = section.getByRole("button", { name: "Manual", exact: true });
    await expect(automatic).toHaveAttribute("aria-selected", "true");
    await manual.click();
    await section.getByRole("button", { name: /Select model/ }).click();
    await page.getByText("Mock Load Test", { exact: true }).click();
    await page.getByText("Ten second stream", { exact: true }).click();
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration)
      .toMatchObject({
        providers: shared,
        promptSuggestions: { providers: [{ provider: "mock", model: "ten-second-stream" }] },
      });
    await page.reload();
    await expect(manual).toHaveAttribute("aria-selected", "true");
    await expect(section.getByRole("button", { name: /Ten second stream/ })).toBeVisible();
    await rename(configFile, backup);
    await mkdir(configFile);
    blocked = true;
    await automatic.click();
    const error = page.getByTestId("suggestion-model-save-error");
    await expect(error).toBeVisible();
    await expect(manual).toHaveAttribute("aria-selected", "true");
    await expect(automatic).toBeEnabled();
    await rm(configFile, { recursive: true });
    await rename(backup, configFile);
    blocked = false;
    await automatic.click();
    await expect(error).toHaveCount(0);
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration)
      .toMatchObject({ providers: shared, promptSuggestions: { providers: [] } });
  } finally {
    if (blocked) {
      await rm(configFile, { recursive: true });
      await rename(backup, configFile);
    }
    await client.patchDaemonConfig({ metadataGeneration: previous.config.metadataGeneration });
    await client.close();
  }
});
