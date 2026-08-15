import { test, expect } from "../../fixtures";

const induceFailure = process.env["BREADBOARD_QA_INDUCE_FAILURE"] === "1";

test.skip(
  !induceFailure,
  "Set BREADBOARD_QA_INDUCE_FAILURE=1 only when validating failure artifact capture.",
);

test("intentional QA failure retains screenshot trace and diagnostics", async ({
  qa,
}) => {
  const page = await qa.dismissWelcome();
  await expect(
    page.getByRole("heading", {
      name: "INTENTIONAL QA FAILURE ARTIFACT SENTINEL",
      exact: true,
    }),
  ).toBeVisible({ timeout: 2_000 });
});
