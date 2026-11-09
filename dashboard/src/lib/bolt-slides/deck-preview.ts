/** Keep relative Vite assets inside this run after slash canonicalization. */
export function withBoltDeckBase(html: string, runId: string): string {
  // Match the existing owned-run contract, including older safe identifiers.
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(runId)) throw new Error("invalid_run_id");
  const base = `<base href="/api/bolt-slides/runs/${runId}/deck/">`;
  const head = /<head(?:\s[^>]*)?>/i;
  // The first base controls resolution, including if authored HTML has one.
  return head.test(html) ? html.replace(head, opening => `${opening}\n${base}`) : `${base}\n${html}`;
}
