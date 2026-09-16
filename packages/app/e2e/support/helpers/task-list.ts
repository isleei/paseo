import { expect, type Page } from "@playwright/test";

export async function openCompletedTaskList(page: Page, count: number): Promise<void> {
  const composerPill = page.getByRole("button", { name: `${count}/${count} tasks` });
  const railProgress = page.getByTestId("workspace-rail-task-progress");

  // Wide layouts read tasks from the workspace rail; compact layouts expand the composer pill.
  await expect
    .poll(async () => (await railProgress.count()) > 0 || (await composerPill.count()) > 0, {
      timeout: 60_000,
    })
    .toBe(true);

  if ((await railProgress.count()) > 0) {
    await expect(railProgress).toContainText(`${count}/${count}`);
    return;
  }
  await composerPill.click();
}

export async function expectTaskListEntries(page: Page, entries: readonly string[]): Promise<void> {
  for (const entry of entries) {
    await expect(page.getByLabel(entry, { exact: true })).toBeVisible();
  }
}

export async function expectCompletedTaskActivity(
  page: Page,
  entries: readonly string[],
): Promise<void> {
  for (const entry of entries) {
    await expect(
      page.getByRole("button", { name: `Completed ${entry}`, exact: true }),
    ).toBeVisible();
  }
}
