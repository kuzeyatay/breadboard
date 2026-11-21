/** Import-free: the per-turn registry names the Design connection without loading its client. */
export const DOORY_CONNECTION = "doory";

// The design open in each user's Design page, so Bread knows what "this design" means.
const focused: Map<number, string> = ((globalThis as { __breadboardDooryFocus?: Map<number, string> }).__breadboardDooryFocus ??= new Map());
export const focusDesign = (userId: number, designId: string | null) => { if (designId) focused.set(userId, designId); else focused.delete(userId); };
export const focusedDesign = (userId: number) => focused.get(userId) ?? null;

const c = JSON.stringify(DOORY_CONNECTION);

export function dooryContext(userId: number): string {
  const open = focusedDesign(userId);
  return [
    `# design_editor`,
    `Breadboard's Design page is a full design editor (Doory: posters, social posts, slides, photo editing with layers, text, shapes, filters, background removal). Bread drives it through mcp_call connection=${c}. Call tool="__breadboard_list_tools" args={} first for the exact tools and argument schemas (list_designs, get_design, create_design, edit_design, export_design, search_elements, search_stock_photos, remove_asset_background, ...). Read a design with get_design before edit_design so you know its page and object ids; edits show live in the open editor and every edit is undoable from version history.`,
    open
      ? `The user has design ${JSON.stringify(open)} open in the Design editor right now: "this design/image/picture" means that one.`
      : `When the user asks to edit or design an image, use this connection; if they want to see it, tell them it is open on the Design page (the Design shortcut next to Crumbs).`,
  ].join("\n");
}
