import { expect, type Page } from "@playwright/test";
import { test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  closeSidebarDisplayPreferences,
  openSidebarDisplayPage,
  openSidebarProjectFilter,
  pinWorkspaceFromSidebar,
  selectAllProjectsFilter,
  selectSidebarStatusGrouping,
  toggleProjectFilter,
} from "../support/helpers/sidebar";

/** Pick a display option through the same menu on desktop and compact layouts. */
async function selectDisplayOption(page: Page, section: string, option: string): Promise<void> {
  await openSidebarDisplayPage(page, `sidebar-display-${section}`);
  await page.getByTestId(option).click();
  await closeSidebarDisplayPreferences(page);
}

test.describe("Sidebar project filter", () => {
  test.describe.configure({ timeout: 180_000 });

  test("project folders persist without replacing sidebar navigation", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "sidebar-folder-" });
    const rowId = `sidebar-project-row-${workspace.projectKey}`;
    try {
      await gotoAppShell(page);
      const row = page.getByTestId(rowId);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.hover();
      await page.getByTestId(`sidebar-project-kebab-${workspace.projectKey}`).click();
      await page.getByTestId(`sidebar-project-menu-folder-${workspace.projectKey}`).click();
      await page.getByTestId("sidebar-project-folder-create").click();
      await page.getByTestId("sidebar-project-folder-create-name").fill("Client work");
      await page.getByTestId("sidebar-project-folder-create-submit").click();
      const folder = page.locator('[data-testid^="sidebar-folder-row-"]');
      await expect(folder).toHaveCount(1);
      await expect(folder).toContainText("Client work");
      await expect(row).toBeVisible();
      await folder.click();
      await expect(row).toHaveCount(0);
      await folder.click();
      await expect(row).toBeVisible();
      await page.reload();
      await expect(folder).toContainText("Client work", { timeout: 30_000 });
      await expect(row).toBeVisible();
      await expect(page.getByRole("button", { name: "New workspace", exact: true })).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("filters independently of grouping and keeps empty projects reachable in status mode", async ({
    page,
  }, testInfo) => {
    const occupied = await seedWorkspace({ repoPrefix: "display-occupied-", title: "Active work" });
    const empty = await seedWorkspace({ repoPrefix: "display-empty-", title: "Archived work" });
    const serverId = getServerId();
    const emptyProjectRow = page.getByTestId(`sidebar-project-row-${empty.projectKey}`);
    const occupiedRow = page.getByTestId(
      `sidebar-workspace-row-${serverId}:${occupied.workspaceId}`,
    );
    try {
      const archived = await empty.client.archiveWorkspace(empty.workspaceId);
      expect(archived.error).toBeNull();
      await gotoAppShell(page);
      await expect(occupiedRow).toBeVisible({ timeout: 30_000 });
      await expect(emptyProjectRow).toBeVisible();

      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);
      await expect(emptyProjectRow).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();

      await selectDisplayOption(
        page,
        "project-visibility",
        "sidebar-project-visibility-unarchived",
      );
      await expect(emptyProjectRow).toHaveCount(0);
      await expect(occupiedRow).toBeVisible();
      await selectSidebarStatusGrouping(page);
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);

      await selectDisplayOption(page, "project-visibility", "sidebar-project-visibility-all");
      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();
      await expect(emptyProjectRow).toBeVisible();
      await expect(occupiedRow).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);
      await expect(emptyProjectRow).toBeVisible();
      await page.reload();
      await expect(emptyProjectRow).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("sidebar-empty-project-group")).toHaveCount(0);
      await selectDisplayOption(page, "grouping", "sidebar-grouping-empty-projects");
      await expect(page.getByTestId("sidebar-empty-project-group")).toBeVisible();
      await page.getByTestId("sidebar-status-group-no-unarchived-workspaces").click();
      await expect(emptyProjectRow).toHaveCount(0);
      await page.getByTestId("sidebar-status-group-no-unarchived-workspaces").click();
      await expect(emptyProjectRow).toBeVisible();
      await selectDisplayOption(page, "grouping", "sidebar-grouping-project");
      await selectDisplayOption(page, "sorting", "sidebar-sorting-project");
      await page.reload();
      await expect(emptyProjectRow).toBeVisible({ timeout: 30_000 });
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await expect(page.getByTestId("sidebar-display-grouping")).toContainText("Project");
      await expect(page.getByTestId("sidebar-display-sorting")).toContainText("Project name");
      await expect(page.getByTestId("sidebar-display-project-visibility")).toContainText(
        "All projects",
      );
      await page.screenshot({ path: testInfo.outputPath("sidebar-empty-project-group.png") });
      await closeSidebarDisplayPreferences(page);
    } finally {
      await empty.cleanup();
      await occupied.cleanup();
    }
  });

  test("pins the sidebar to one project across both grouping modes", async ({ page }) => {
    // Two temp repos means two projects, which is also what makes the `Project ›` row appear.
    const alpha = await seedWorkspace({ repoPrefix: "project-filter-alpha-", title: "Alpha work" });
    const beta = await seedWorkspace({ repoPrefix: "project-filter-beta-", title: "Beta work" });
    const serverId = getServerId();
    const alphaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${alpha.workspaceId}`);
    const betaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${beta.workspaceId}`);
    const filterTrigger = page.getByTestId("sidebar-display-project-filter");

    try {
      await gotoAppShell(page);
      await expect(alphaRow).toBeVisible({ timeout: 30_000 });
      await expect(betaRow).toBeVisible({ timeout: 30_000 });

      await openSidebarProjectFilter(page);
      await expect(page.getByTestId("sidebar-project-filter-all")).toBeVisible();
      await toggleProjectFilter(page, alpha.projectKey);
      await closeSidebarDisplayPreferences(page);

      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toHaveCount(0, { timeout: 10_000 });

      // The indicator reads the filter as it is applied, so it must be on here.
      await page.getByTestId("sidebar-display-preferences-menu").click();
      await expect(filterTrigger).toBeVisible();
      await expect(filterTrigger.getByTestId("menu-sub-indicator")).toBeVisible();
      await closeSidebarDisplayPreferences(page);

      // Status grouping builds its rows from the workspace entries rather than the projects
      // array, so a filter applied in only one of the two places passes every check above and
      // silently fails right here.
      await selectSidebarStatusGrouping(page);
      await closeSidebarDisplayPreferences(page);
      await expect(alphaRow).toBeVisible({ timeout: 15_000 });
      await expect(betaRow).toHaveCount(0);

      // The filter is view state and survives a cold load.
      await page.reload();
      await expect(alphaRow).toBeVisible({ timeout: 30_000 });
      await expect(betaRow).toHaveCount(0);

      await openSidebarProjectFilter(page);
      await selectAllProjectsFilter(page);
      await closeSidebarDisplayPreferences(page);
      await expect(alphaRow).toBeVisible();
      await expect(betaRow).toBeVisible({ timeout: 15_000 });
    } finally {
      await beta.cleanup();
      await alpha.cleanup();
    }
  });

  test("keeps the display menu reachable when the pinned section swallows the filtered project", async ({
    page,
  }) => {
    // A project filter still has to keep the display menu mounted when the visible set
    // shrinks. Pinning used to hoist the only matching chat out of the project list; it now
    // stays in the project, but the header must remain the way back to the filter page either
    // way.
    const alpha = await seedWorkspace({
      repoPrefix: "project-filter-pinned-",
      title: "Pinned work",
    });
    const beta = await seedWorkspace({ repoPrefix: "project-filter-other-", title: "Other work" });
    const serverId = getServerId();
    const alphaRow = page.getByTestId(`sidebar-workspace-row-${serverId}:${alpha.workspaceId}`);

    try {
      await gotoAppShell(page);
      await expect(alphaRow).toBeVisible({ timeout: 30_000 });

      await openSidebarProjectFilter(page);
      await toggleProjectFilter(page, alpha.projectKey);
      await closeSidebarDisplayPreferences(page);

      await pinWorkspaceFromSidebar(page, alpha.workspaceId);
      await expect(alphaRow).toBeVisible();

      // The way out of the filter is still on screen.
      await expect(page.getByTestId("sidebar-display-preferences-menu")).toBeVisible();
      await openSidebarProjectFilter(page);
      await selectAllProjectsFilter(page);
      await closeSidebarDisplayPreferences(page);
      await expect(
        page.getByTestId(`sidebar-workspace-row-${serverId}:${beta.workspaceId}`),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await beta.cleanup();
      await alpha.cleanup();
    }
  });

  test("hides the filter row when there is only one project", async ({ page }) => {
    const only = await seedWorkspace({ repoPrefix: "project-filter-solo-", title: "Solo work" });
    const serverId = getServerId();

    try {
      await gotoAppShell(page);
      await expect(
        page.getByTestId(`sidebar-workspace-row-${serverId}:${only.workspaceId}`),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByTestId("sidebar-display-preferences-menu").click();
      await expect(page.getByTestId("sidebar-display-preferences-content")).toBeVisible();
      await expect(page.getByTestId("sidebar-display-project-filter")).toHaveCount(0);
    } finally {
      await only.cleanup();
    }
  });
});
