// Breadboard board binding.
//
// A Breadboard whiteboard card frames this page with `?board=<id>`. The card is
// a window onto one persistent board rather than a fresh canvas: the board is
// read out of PenEcho's own server canvas storage when the page opens, and
// written back whenever it changes — ink, images, widgets, text and the
// viewport itself — so reopening the card returns to exactly where it was left.
//
// Nothing here runs unless `?board=` is present and well formed, so a plain
// PenEcho page behaves exactly as it did before.
//
// Writes are debounced rather than immediate: serializing a canvas means
// encoding every painted tile, which is far too much work to do per stroke.
// An edit is written once the board has been quiet for a moment, and never
// later than BOARD_SAVE_MAX_WAIT_MS after the first unsaved change.
  const BOARD_ID_PATTERN = /^\d{10,16}-[a-zA-Z0-9-]{8,64}$/,
    BREADBOARD_BOARD_READY_MESSAGE = "penecho:board-ready",
    BOARD_SAVE_IDLE_MS = 2000,
    BOARD_SAVE_MAX_WAIT_MS = 15000,
    BOARD_VIEW_POLL_MS = 4000,
    board = {
      id: "",
      name: "",
      // Whether the server already holds this board. A first write has to POST
      // (PenEcho's PUT is an overwrite, not an upsert); later ones PUT.
      stored: false,
      bound: false,
      dirty: false,
      writing: false,
      timer: 0,
      deadline: 0,
      view: "",
    };
  function boardRequested() {
    return BOARD_ID_PATTERN.test(new URL(location.href).searchParams.get("board") || "");
  }
  function boardViewSignature() {
    return `${state.scale.toFixed(4)}:${Math.round(state.panX)}:${Math.round(state.panY)}`;
  }
  function announceBreadboardBoardReady() {
    if (window.parent === window) return;
    // The parent validates both this window and its origin. The payload only
    // identifies the already-requested board and contains no canvas content.
    window.parent.postMessage({ type:BREADBOARD_BOARD_READY_MESSAGE, boardId:board.id }, "*");
  }
  /**
   * Called from the canvas history layer on every committed change. Marks the
   * board unsaved and schedules the write.
   */
  function breadboardBoardChanged() {
    if (!board.bound) return;
    board.dirty = true;
    scheduleBoardWrite();
  }
  function scheduleBoardWrite() {
    if (!board.dirty || board.writing) return;
    const now = Date.now();
    if (!board.deadline) board.deadline = now + BOARD_SAVE_MAX_WAIT_MS;
    clearTimeout(board.timer);
    board.timer = setTimeout(flushBoard, Math.max(0, Math.min(BOARD_SAVE_IDLE_MS, board.deadline - now)));
  }
  async function writeBoard() {
    // An emptied board is a real state, not an absence of one: drop the stored
    // canvas so an erased card stays erased instead of resurrecting on reload.
    if (canvasIsEmpty()) {
      if (board.stored) {
        await deleteServerSnapshot(board.id);
        board.stored = false;
      }
      return;
    }
    const request = () =>
      saveSnapshot({
        ...(board.stored ? { overwriteId:board.id } : { createId:board.id }),
        name:board.name,
        location:"server",
        quiet:true,
      });
    let saved;
    try {
      saved = await request();
    } catch (error) {
      // The board was deleted underneath us (404 on overwrite) or created by
      // another tab (409 on create). Either way the other side of the flag is
      // the truth; take it and write once more.
      if (!/HTTP (404|409)|not found|already exists/i.test(String(error?.message || ""))) throw error;
      board.stored = !board.stored;
      saved = await request();
    }
    // PenEcho declines to snapshot while it is still resolving an AI draft.
    // Nothing was written, so the board stays unsaved and retries.
    if (!saved) {
      board.dirty = true;
      return;
    }
    board.stored = true;
    board.view = boardViewSignature();
  }
  async function flushBoard() {
    if (!board.bound || !board.dirty || board.writing) return;
    clearTimeout(board.timer);
    board.writing = true;
    board.dirty = false;
    board.deadline = 0;
    try {
      await writeBoard();
    } catch (error) {
      // Keep the change pending and let the next edit or view change retry it,
      // rather than reporting a saved board that only exists in this tab.
      board.dirty = true;
      setStatus(`${t("snapshotError")}${error?.message || error}`);
    } finally {
      board.writing = false;
      scheduleBoardWrite();
    }
  }
  /**
   * Bind this page to the board named in the URL: restore it if the server has
   * it, then keep it written back. Errors leave a usable blank canvas rather
   * than an empty page.
   */
  async function startBreadboardBoard() {
    if (!boardRequested()) return;
    const params = new URL(location.href).searchParams;
    board.id = params.get("board");
    board.name = String(params.get("title") || "").trim().slice(0, 48);
    document.body.classList.add("breadboard-board");
    // The board lives on the server, so the history panel and the new-canvas
    // dialog should be talking about server storage too.
    state.snapshotLocation = "server";
    try {
      await loadSnapshot(board.id, "server");
      board.stored = state.currentSnapshotId === board.id;
    } catch (error) {
      // A board that has never been drawn on has nothing stored yet, which is
      // the normal first open of a new card and not a failure.
      if (!/HTTP 404|not found/i.test(String(error?.message || ""))) {
        setStatus(`${t("snapshotError")}${error?.message || error}`);
      }
    }
    state.currentSnapshotId = board.id;
    state.currentSnapshotName = board.name;
    state.currentSnapshotLocation = "server";
    updateSnapshotLocationUi();
    board.view = boardViewSignature();
    board.bound = true;
    announceBreadboardBoardReady();
    // Panning and zooming never touch the undo history, but where the reader
    // left the board is part of what the card has to remember. Sampling the
    // viewport is cheap; serializing the canvas to compare it would not be.
    setInterval(() => {
      const signature = boardViewSignature();
      if (signature === board.view) return;
      board.view = signature;
      breadboardBoardChanged();
    }, BOARD_VIEW_POLL_MS);
    // Leaving the page is the last chance to write, and a hidden tab is the
    // common way a card is left behind.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) flushBoard();
    });
    window.addEventListener("pagehide", flushBoard);
  }
