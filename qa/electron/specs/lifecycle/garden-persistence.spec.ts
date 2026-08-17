import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "../../fixtures";
import { locate, SELECTORS } from "../../selectors";
import {
  assertGardenWorkspace,
  createGarden,
  ensureAuthenticatedDashboard,
  gardenCard,
  openGardenWorkspace,
  registerAndSignIn,
  type GardenInfo,
} from "../../user-journeys";

/**
 * Week 2 Phases 3 and 8: garden lifecycle and the persistence torture matrix.
 *
 * Two rules shape this file.
 *
 * First, the UI is not the oracle for persistence. Every persisted claim is
 * checked against state the renderer cannot fake: the slug the server minted,
 * the Quartz content the supervisor wrote to disk, and — most importantly —
 * what survives a full Electron relaunch into the same isolated profile.
 *
 * Second, these tests are deliberately *not* `describe.serial`. Week 1 showed a
 * serial group converting one failure into a row of unobserved scenarios, which
 * both hides defects and inflates apparent pass rates. Each test here builds the
 * state it needs, so a failure costs one result rather than the file.
 */

const HOSTILE_NAMES = [
  { label: "unicode", name: "Physique Quantique — Résumé" },
  { label: "emoji", name: "Rocket 🚀 Notes" },
  { label: "apostrophe", name: "Kuzey's Garden" },
  { label: "double-quote", name: 'The "Firefly" Brief' },
  { label: "slash", name: "Physics / Optics" },
  { label: "backslash", name: "Windows\\Paths" },
  { label: "punctuation", name: "Notes: v2.0 (draft) #1 & more!" },
  { label: "long", name: `Long ${"garden ".repeat(20)}name`.slice(0, 180) },
] as const;

function quartzContentRoot(dataDir: string): string {
  return path.join(dataDir, "quartz", "content");
}

/** Directory names Quartz wrote for this user's gardens, if any exist yet. */
function quartzEntries(dataDir: string): readonly string[] {
  const root = quartzContentRoot(dataDir);
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  const visit = (directory: string, depth: number): void => {
    if (depth > 3) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      found.push(path.relative(root, absolute).replaceAll("\\", "/"));
      if (entry.isDirectory()) visit(absolute, depth + 1);
    }
  };
  visit(root, 0);
  return found;
}

/**
 * The disposable QA account exists once per run root, not once per test.
 * Registering again re-submits a taken username and simply never navigates,
 * which reads as a product hang when it is really the test's own mistake.
 */
let accountRegistered = false;

async function signedInDashboard(
  qa: import("../../fixtures").ElectronQaHarness,
): Promise<import("playwright").Page> {
  const page = await qa.dismissWelcome();
  if (!accountRegistered) {
    await registerAndSignIn(page, qa.run.bootstrap.auth);
    accountRegistered = true;
  }
  await ensureAuthenticatedDashboard(page, qa.run.bootstrap.auth);
  return page;
}

test.describe("garden lifecycle", () => {
  test("gardens accept hostile names and mint distinct slugs", async ({ qa }) => {
    const page = await signedInDashboard(qa);
    const created: GardenInfo[] = [];

    for (const entry of HOSTILE_NAMES) {
      const garden = await createGarden(page, {
        name: entry.name,
        description: `hostile-name case: ${entry.label}`,
      });
      created.push(garden);

      // The card must carry the name the user typed, byte for byte. A product
      // that silently normalises punctuation is losing the user's intent.
      await expect(
        gardenCard(page, entry.name),
        `${entry.label}: the garden card must show the exact name typed`,
      ).toHaveCount(1);
      expect(garden.slug, `${entry.label}: a slug must be minted`).toMatch(/^[a-z0-9-]+$/);
    }

    const slugs = created.map((garden) => garden.slug);
    expect(
      new Set(slugs).size,
      `slugs must be unique across hostile names, saw: ${slugs.join(", ")}`,
    ).toBe(slugs.length);
  });

  test("an empty or whitespace-only garden name cannot create a garden", async ({ qa }) => {
    const page = await signedInDashboard(qa);
    const before = await gardenCard(page, "").count().catch(() => 0);
    void before;

    await locate(page, SELECTORS.gardens.newGarden).click();
    const modal = page.locator(".bb-modal-panel").filter({
      has: locate(page, SELECTORS.gardens.newGardenHeading),
    });
    await expect(modal).toBeVisible();

    const create = modal.getByRole("button", { name: "Create", exact: true });
    const name = modal.getByPlaceholder("My garden", { exact: true });

    // Empty.
    await expect(create, "Create must be disabled with an empty name").toBeDisabled();

    // Whitespace only. This is the case a trim() bug lets through.
    await name.fill("   ");
    await expect(
      create,
      "Create must stay disabled for a whitespace-only name",
    ).toBeDisabled();

    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(modal).toBeHidden();
  });

  test("a renamed garden keeps its rename across refresh and Electron restart", async ({ qa }) => {
    const page = await signedInDashboard(qa);
    const original = `Rename source ${Date.now().toString(36)}`;
    const renamed = `${original} — renamed`;
    const garden = await createGarden(page, {
      name: original,
      description: "week 2 rename persistence",
    });

    await openGardenWorkspace(page, garden);
    await page.goto(new URL("/dashboard", page.url()).toString(), {
      waitUntil: "domcontentloaded",
    });

    const card = gardenCard(page, original);
    await expect(card).toHaveCount(1);
    await card.getByRole("button", { name: "Edit garden", exact: true }).click();

    // The dashboard's own edit modal, not the garden settings dialog: it is a
    // `.bb-modal-panel` headed "Edit garden", and its name input is properly
    // associated with a "Name" label, so the scenario drives it semantically.
    const editModal = page.locator(".bb-modal-panel").filter({
      has: page.getByRole("heading", { name: "Edit garden", exact: true }),
    });
    await expect(editModal).toBeVisible();
    await editModal.getByLabel("Name", { exact: true }).fill(renamed);
    await editModal.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editModal).toBeHidden();

    await expect(gardenCard(page, renamed)).toHaveCount(1);
    await expect(gardenCard(page, original)).toHaveCount(0);

    // Renderer refresh.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      gardenCard(page, renamed),
      "the rename must survive a renderer refresh",
    ).toHaveCount(1);
    await expect(gardenCard(page, original)).toHaveCount(0);

    // Full Electron relaunch into the same isolated profile.
    await qa.restart();
    const relaunched = await qa.dismissWelcome();
    await ensureAuthenticatedDashboard(relaunched, qa.run.bootstrap.auth);
    await expect(
      gardenCard(relaunched, renamed),
      "the rename must survive an Electron restart",
    ).toHaveCount(1);
    await expect(gardenCard(relaunched, original)).toHaveCount(0);
  });

  test("a created garden is durable across an Electron restart and reaches disk", async ({
    qa,
  }) => {
    const page = await signedInDashboard(qa);
    const name = `Durable ${Date.now().toString(36)}`;
    const garden = await createGarden(page, {
      name,
      description: "week 2 durability probe",
    });
    await openGardenWorkspace(page, garden);
    await assertGardenWorkspace(page, garden);

    await qa.restart();
    const relaunched = await qa.dismissWelcome();
    await ensureAuthenticatedDashboard(relaunched, qa.run.bootstrap.auth);
    await expect(
      gardenCard(relaunched, name),
      "the garden must still exist after an Electron restart",
    ).toHaveCount(1);

    // The workspace must still open on the same slug the server originally
    // minted, which is what a stale-selection or reindex bug would break.
    await openGardenWorkspace(relaunched, garden);
    await assertGardenWorkspace(relaunched, garden);

    // Disk is the authority the renderer cannot fake.
    const entries = quartzEntries(qa.run.paths.dataDir);
    expect(
      entries.some((entry) => entry.includes(garden.slug)),
      `Quartz content should mention ${garden.slug}; saw ${entries.slice(0, 20).join(", ") || "(empty)"}`,
    ).toBe(true);
  });

  test("rapid switching between gardens never shows another garden's workspace", async ({
    qa,
  }) => {
    const page = await signedInDashboard(qa);
    const first = await createGarden(page, { name: `Switch A ${Date.now().toString(36)}`, description: "a" });
    const second = await createGarden(page, { name: `Switch B ${Date.now().toString(36)}`, description: "b" });

    // Alternate without waiting for idle between hops: the wrong-context bug
    // this looks for is a stale render surviving a fast navigation.
    for (let round = 0; round < 4; round += 1) {
      const target = round % 2 === 0 ? first : second;
      await page.goto(new URL(target.workspaceHref, page.url()).toString(), {
        waitUntil: "domcontentloaded",
      });
      await assertGardenWorkspace(page, target);
      const other = round % 2 === 0 ? second : first;
      await expect(
        page.getByRole("heading", { name: other.name, exact: true }),
        `round ${round}: ${other.name} must not be rendered while viewing ${target.name}`,
      ).toHaveCount(0);
    }
  });
});
