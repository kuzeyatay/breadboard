import BrowserSelectionPopover from "./selection-popover";

export default async function SelectionPopoverPage({ searchParams }: { searchParams: Promise<{ entry?: string }> }) {
  const params = await searchParams;
  let entry: unknown = null;
  try { entry = JSON.parse(params.entry ?? "null"); } catch { /* The client closes an invalid selection. */ }
  return <BrowserSelectionPopover entry={entry} />;
}
