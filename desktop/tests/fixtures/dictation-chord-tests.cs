using System;
using System.Collections.Generic;

internal static class ChordTests
{
    private static int starts, finishes, cancels;
    private static List<DictationChord.Key> replay;
    private static DictationChord Fresh()
    {
        starts = finishes = cancels = 0; replay = new List<DictationChord.Key>();
        return new DictationChord { Start = delegate { starts++; }, Finish = delegate { finishes++; },
            Cancel = delegate { cancels++; }, Replay = delegate(DictationChord.Key[] keys) { replay.AddRange(keys); } };
    }
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static bool Key(DictationChord c, int key, bool up, int ms, bool mods = false)
    { return c.Handle(new DictationChord.Key(key, up), ms, mods); }
    private static void Main()
    {
        foreach (int ctrl in new[] { 0xA2, 0xA3 }) foreach (int shift in new[] { 0xA0, 0xA1 })
        foreach (bool shiftFirst in new[] { false, true }) foreach (bool releaseShiftFirst in new[] { false, true })
        {
            DictationChord c = Fresh();
            int first = shiftFirst ? shift : ctrl, second = shiftFirst ? ctrl : shift;
            Check(Key(c, first, false, 0) == false, "the first modifier passes immediately");
            c.Tick(1000); Check(starts == 0, "one modifier never starts dictation");
            Check(Key(c, second, false, 1010) == true, "both key orders work without a timing race");
            c.Tick(1100); Check(starts == 0, "brief hold avoids starting on normal shortcuts");
            c.Tick(1160); c.Tick(1200); Check(starts == 1 && replay.Count == 0, "hold starts once, without modifier leakage");
            Key(c, ctrl, false, 1300); Key(c, shift, false, 1320);
            Check(starts == 1 && replay.Count == 0, "autorepeat cannot retrigger");
            int released = releaseShiftFirst ? shift : ctrl, remaining = releaseShiftFirst ? ctrl : shift;
            Key(c, released, true, 1400); Check(finishes == 1, "releasing either modifier finishes once");
            Key(c, released, false, 1410); c.Tick(1800); Key(c, released, true, 1810);
            Check(starts == 1 && finishes == 1, "must release both before another hold");
            Key(c, remaining, true, 1850); Check(replay.Count == 0, "release never opens Start");
            Key(c, ctrl, false, 1900); Key(c, shift, false, 1920); c.Tick(2070);
            Check(starts == 2, "next independent hold works");
        }
        foreach (bool active in new[] { false, true }) foreach (int third in new[] { 0x44, 0x25, 0x43, 0x56, 0x12 })
        {
            DictationChord c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 20);
            if (active) c.Tick(200);
            Check(Key(c, third, false, 220) == !active, "only a shortcut before dictation commits replays the deferred modifier");
            Check(active ? replay.Count == 0 : replay.Count == 2 && replay[0].Code == 0xA0 && replay[1].Code == third,
                "consumed dictation modifiers never become a Windows shortcut");
            Check(!Key(c, third, true, 240), "shortcut keyup passes");
            c.Tick(400); Key(c, 0xA0, true, 420); Key(c, 0xA2, true, 430);
            Check(finishes == 0 && starts == (active ? 1 : 0), "ordinary shortcut cancels without submitting or retriggering");
        }
        foreach (bool releaseFirst in new[] { false, true }) {
            DictationChord c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 20); c.Tick(200);
            if (releaseFirst) Key(c, 0xA0, true, 220);
            c.Complete(); c.Complete();
            Check(finishes == 1 && c.SuppressControl, "voice command finishes once even if a shortcut key remains held");
            int cancelled = cancels;
            for (int repeat = 0; repeat < 20; repeat++) Key(c, 0xA2, false, 240 + repeat);
            Check(finishes == 1 && cancels == cancelled, "held Ctrl repeats cannot cancel voice submission");
            Key(c, 0xA2, true, 300); if (!releaseFirst) Key(c, 0xA0, true, 310);
            Check(!c.SuppressControl && finishes == 1 && replay.Count == 0, "release after voice send neither submits again nor opens Start");
            Key(c, 0xA2, false, 400); Key(c, 0xA0, false, 420); c.Tick(600);
            Check(starts == 2, "a fresh hold works after voice submission");
        }
        {
            DictationChord c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 20); c.Tick(200); c.Complete();
            Check(!Key(c, 0x25, false, 220), "typing after voice send passes without replaying modifiers");
            Check(replay.Count == 0 && c.SuppressControl, "voice submission owns its modifiers until release");
        }
        {
            DictationChord c = Fresh();
            Check(!Key(c, 0x5A, false, 0) && !Key(c, 0x58, false, 20), "Z and X are ordinary typing again");
            c.Tick(1000); Check(starts == 0 && replay.Count == 0, "old binding removed");
            c = Fresh(); Key(c, 0x5B, false, 0); Key(c, 0x5B, true, 20);
            Check(replay.Count == 2 && !replay[0].Up && replay[1].Up, "Win alone keeps its original down/up pair");
            c = Fresh(); Key(c, 0x5B, false, 0); Key(c, 0x45, false, 20);
            Check(replay.Count == 2 && replay[0].Code == 0x5B && replay[1].Code == 0x45, "Win+E preserved");
            c = Fresh(); Check(!Key(c, 0xA2, false, 0), "Ctrl alone passes immediately"); c.Interrupt();
            Check(replay.Count == 0 && starts == 0, "Ctrl+click does not wait for a key replay");
            c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 20); Key(c, 0xA2, true, 60); Key(c, 0xA0, true, 80); c.Tick(300);
            Check(starts == 0 && finishes == 0 && replay.Count == 2, "quick Ctrl+Shift tap replays a balanced second modifier without recording");
            c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 20); c.Tick(200); c.Interrupt();
            Key(c, 0x1B, true, 240); Key(c, 0xA2, true, 250); Key(c, 0xA0, true, 260);
            Check(finishes == 0 && replay.Count == 0, "Escape or click cancels without opening Start, including Escape keyup");
            c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 20); Key(c, 0x1B, false, 40);
            Key(c, 0x1B, true, 50); Key(c, 0xA2, true, 60); Key(c, 0xA0, true, 70); c.Tick(300);
            Check(starts == 0 && finishes == 0 && replay.Count == 0, "Escape also cancels before microphone startup without leaking Win");
            c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 20); c.Tick(200); c.Flush();
            Check(replay.Count == 0, "shutdown never replays a consumed Win");
            c = Fresh(); Key(c, 0x5B, false, 0); Key(c, 0xA2, false, 10); Key(c, 0xA0, false, 20);
            Key(c, 0x5B, true, 30); Key(c, 0xA0, false, 40); c.Tick(300);
            Check(starts == 0 && replay.Count == 0, "releasing Win before the hold starts cannot fall back to ordinary dictation");
            c = Fresh(); Check(!Key(c, 0x5B, false, 0, true), "already-held Alt blocks dictation");
            Key(c, 0xA2, false, 10, true); c.Tick(300); Check(starts == 0, "extra modifier never starts");
        }
        foreach (int ctrl in new[] { 0xA2, 0xA3 }) foreach (int win in new[] { 0x5B, 0x5C })
        foreach (int shift in new[] { 0x10, 0xA0, 0xA1 })
        foreach (int[] order in new[] { new[]{ctrl,win,shift}, new[]{ctrl,shift,win}, new[]{win,ctrl,shift}, new[]{win,shift,ctrl}, new[]{shift,ctrl,win}, new[]{shift,win,ctrl} })
        foreach (int release in new[] { ctrl, win, shift }) {
            DictationChord c = Fresh();
            for (int i=0;i<3;i++) Key(c,order[i],false,i*20);
            c.Tick(250); Check(starts==1 && c.ScreenAware, "all key orders and sides select a single screen-aware hold");
            Key(c,release,true,300); Check(finishes==1, "releasing any of three keys finishes screen-aware recording");
            Key(c,release,false,320); c.Tick(600); Check(starts==1, "repressing one modifier cannot retrigger the same hold");
            foreach(int key in order) Key(c,key,true,700);
            Check(!c.ScreenAware && replay.Count==0, "release resets mode without opening Start");
        }
        {
            DictationChord c = Fresh(); int promotions = 0; c.Promote = delegate { promotions++; };
            Key(c,0xA2,false,0); Key(c,0xA0,false,20); c.Tick(200);
            Key(c,0x5B,false,300); Key(c,0x5B,false,400);
            Check(starts==1 && promotions==1 && c.ScreenAware && finishes==0, "late Win promotes without restarting audio or cancelling");
            Key(c,0x5B,true,450); Check(finishes==1, "promoted hold ends on Win release");
            c = Fresh(); Key(c,0xA0,false,0); Key(c,0xA2,false,20); Key(c,0x5B,false,40); Key(c,0x25,false,60); c.Tick(300);
            Check(starts==0 && replay.Count==3 && replay[0].Code==0xA2 && replay[1].Code==0x5B && replay[2].Code==0x25, "Ctrl+Shift+Win+Arrow remains an ordinary Windows shortcut");
        }
        foreach (int ctrl in new[] { 0xA2, 0xA3 }) foreach (bool click in new[] { false, true })
        {
            DictationChord c = Fresh(); Key(c, ctrl, false, 0); Key(c, 0xA0, false, 20); c.Tick(200);
            c.BeginTextInput(); c.BeginTextInput();
            Check(c.SuppressControl && starts == 1 && finishes == 0, "streaming keeps Ctrl neutral between previews without ending recording");
            if (click) {
                c.Interrupt();
                Check(replay.Count == 0, "cancelling dictation with a click cannot restore consumed modifiers");
            } else {
                Check(!Key(c, 0x25, false, 240), "typing after streaming cancels without a modifier replay");
                Check(replay.Count == 0, "streaming cancellation must never inject Win or Ctrl downs");
            }
            Check(c.SuppressControl, "consumed modifiers stay neutral until physical release");
            if (!click) Key(c, 0x25, true, 280);
            Key(c, ctrl, true, 300); Key(c, 0xA0, true, 310);
            Key(c, ctrl, false, 400); Key(c, 0xA0, false, 420); c.Tick(600);
            Check(starts == 2, "streaming cancellation does not block the next hold");
        }
        foreach (int ctrl in new[] { 0xA2, 0xA3 }) foreach (int shift in new[] { 0xA0, 0xA1 })
        foreach (bool shiftFirst in new[] { false, true }) foreach (bool screenAware in new[] { false, true })
        {
            DictationChord c = Fresh();
            var held = new HashSet<int>();
            c.IsKeyDown = delegate(int code) {
                Check(!DictationChord.IsControl(code) && !DictationChord.IsWindows(code) && !DictationChord.IsShift(code),
                    "consumed modifiers must not be reconciled against synthetic Windows state");
                return held.Contains(code);
            };
            // Reproduce an ordinary key-up lost while the hook stays installed.
            Key(c, 0x41, false, 0); Key(c, 0x42, false, 10);
            if (screenAware) Key(c, 0x5B, false, 20);
            Key(c, shiftFirst ? shift : ctrl, false, 30);
            Key(c, shiftFirst ? ctrl : shift, false, 50);
            c.Tick(250);
            Check(starts == 1 && c.ScreenAware == screenAware && replay.Count == 0,
                "missed ordinary key-ups must recover on the next hold, for either mode and key order");
            Key(c, ctrl, false, 260); Key(c, shift, false, 270); c.Tick(500);
            Check(starts == 1 && finishes == 0, "reconciliation cannot release consumed modifiers or retrigger a hold");
            Key(c, ctrl, true, 510); Key(c, shift, true, 520);
            if (screenAware) Key(c, 0x5B, true, 530);
            Check(finishes == 1 && replay.Count == 0, "recovered hold still finishes once without opening Start");
        }
        {
            DictationChord c = Fresh(); var held = new HashSet<int> { 0x41 };
            c.IsKeyDown = code => held.Contains(code);
            Key(c, 0x41, false, 0); Key(c, 0x42, false, 10);
            Key(c, 0xA2, false, 20); Check(!Key(c, 0xA0, false, 40), "a truly held typing key keeps the Windows shortcut available");
            c.Tick(300); Check(starts == 0 && replay.Count == 0, "remove only stale keys, not genuinely held keys");
            Key(c, 0xA0, true, 310); Key(c, 0xA2, true, 320);
            held.Clear(); // Lose the remaining typing key-up as well.
            Key(c, 0xA2, false, 400); Key(c, 0xA0, false, 420); c.Tick(600);
            Check(starts == 1, "a later hold works once the remaining typing key is released");
            Check(!Key(c, 0x25, false, 620), "typing still interrupts recovered dictation");
            Check(replay.Count == 0, "recovered dictation cannot replay a consumed Win down");
        }
        foreach (int shift in new[] { 0xA0, 0xA1 }) foreach (int ctrl in new[] { 0xA2, 0xA3 })
        foreach (bool completed in new[] { false, true }) foreach (bool click in new[] { false, true }) {
            DictationChord c = Fresh(); int releases = 0; c.ReleaseModifiers = delegate { releases++; };
            Key(c, ctrl, false, 0); Key(c, shift, false, 20); c.Tick(200);
            Check(releases == 1 && c.SuppressControl, "starting dictation neutralizes Ctrl and Shift before any audio or text");
            if (completed) c.Complete();
            if (click) c.Interrupt();
            foreach (int ordinary in new[] { 0x48, 0x45, 0x41 }) {
                Check(!Key(c, ordinary, false, 220), "post-dictation H/E/A passes as ordinary typing");
                Key(c, ordinary, true, 230);
                Check(Key(c, shift, false, 240), "Shift autorepeat after cancellation cannot leak into Windows");
            }
            Check(replay.Count == 0, "no Win+H or Win+E replay after dictation");
            Check(!Key(c, shift, true, 300), "Shift release always reaches Windows after an owned hold");
            Key(c, ctrl, true, 310);
            Check(!c.SuppressControl && c.ControlMask == 0 && c.ShiftMask == 0 && c.WindowsMask == 0, "all modifier ownership clears on release");
            Key(c, 0x5B, false, 400); Check(Key(c, 0x45, false, 410), "a fresh Win+E still works outside dictation");
            Check(replay.Count == 2 && replay[0].Code == 0x5B, "fresh Windows shortcuts keep their meaning");
        }
        {
            DictationChord c = Fresh(); c.IsKeyDown = key => false;
            Key(c, 0xA2, false, 0); // The secure desktop swallowed its release.
            c.Tick(20); Check(c.ControlMask == 0, "idle passed Ctrl recovers a missed release");
            Key(c, 0xA2, false, 30); Key(c, 0xA0, false, 40); c.Tick(200);
            Check(starts == 1 && c.ControlMask == 1, "neutralized held Ctrl is never reconciled against synthetic key-up state");
            int releases = 0; c.ReleaseModifiers = delegate { releases++; };
            c.Reset(); Check(releases == 1 && !c.SuppressControl && c.ControlMask == 0 && c.ShiftMask == 0 && c.WindowsMask == 0,
                "desktop/hook reset releases owned modifiers and forgets stale physical state");
            Key(c, 0x5B, false, 300); c.Flush(); Check(replay.Count == 0, "shutdown never emits an unpaired pending Win down");
        }
        {
            DictationChord c = Fresh();
            Check(!Key(c, 0xA0, false, 0), "Shift alone passes immediately for typing and selection");
            Check(!Key(c, 0x41, false, 10), "Shift+A remains ordinary typing");
            c.Tick(400); Check(starts == 0 && replay.Count == 0, "Shift typing never starts dictation");
            c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0x5B, false, 10); c.Tick(500);
            Check(starts == 0, "the old Ctrl+Win hold no longer starts dictation");
            Check(Key(c, 0x25, false, 510) && replay.Count == 2, "old Ctrl+Win+Arrow remains an ordinary shortcut");
            c = Fresh(); Key(c, 0xA2, false, 0); Key(c, 0xA0, false, 10); c.Interrupt(); c.Tick(500);
            Check(starts == 0 && replay.Count == 1 && replay[0].Code == 0xA0, "Ctrl+Shift+click before the hold commits restores Shift");
        }
        Console.WriteLine("Ctrl+Shift dictation chord regression checks passed.");
    }
}
