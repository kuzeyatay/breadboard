using System;
using System.Collections.Generic;

// The first Ctrl/Shift passes immediately. Defer the second modifier until a
// hold commits or a normal shortcut/click uses it. Win adds screen awareness.
internal sealed class DictationChord
{
    internal const int HoldMs = 150;
    internal struct Key
    {
        internal int Code, Scan;
        internal bool Up, Extended;
        internal Key(int code, bool up) { Code = code; Up = up; Scan = 0; Extended = false; }
    }
    internal Action<Key[]> Replay;
    internal Action Start, Finish, Cancel, Promote, ReleaseModifiers;
    internal Func<int, bool> IsKeyDown;
    internal bool ScreenAware { get; private set; }
    private readonly List<Key> pendingModifiers = new List<Key>();
    private readonly HashSet<int> down = new HashSet<int>();
    private long deadline;
    private bool latched, consumed, recording, bypass, completed;
    private volatile bool suppressControl;
    internal bool SuppressControl { get { return suppressControl; } }
    internal int ControlMask { get { return (down.Contains(0xA2) || down.Contains(0x11) ? 1 : 0) | (down.Contains(0xA3) ? 2 : 0); } }
    internal int ShiftMask { get { return (down.Contains(0xA0) || down.Contains(0x10) ? 1 : 0) | (down.Contains(0xA1) ? 2 : 0); } }
    internal int WindowsMask { get { return (down.Contains(0x5B) ? 1 : 0) | (down.Contains(0x5C) ? 2 : 0); } }

    internal static bool IsControl(int code) { return code == 0x11 || code == 0xA2 || code == 0xA3; }
    internal static bool IsWindows(int code) { return code == 0x5B || code == 0x5C; }
    internal static bool IsShift(int code) { return code == 0x10 || code == 0xA0 || code == 0xA1; }
    private bool ControlDown { get { foreach (int code in down) if (IsControl(code)) return true; return false; } }
    private bool WindowsDown { get { return down.Contains(0x5B) || down.Contains(0x5C); } }
    private bool ShiftDown { get { foreach (int code in down) if (IsShift(code)) return true; return false; } }
    private bool OtherDown { get { foreach (int code in down) if (!IsControl(code) && !IsWindows(code) && !IsShift(code)) return true; return false; } }

    internal bool Handle(Key key, long now, bool otherModifiers)
    {
        bool control = IsControl(key.Code), windows = IsWindows(key.Code), shift = IsShift(key.Code);
        if (!key.Up && (control || windows || shift) && IsKeyDown != null)
        {
            // Another hook or a desktop switch can hide an ordinary key-up
            // without removing our hooks. A stale typing key must not block
            // every later hold. Check before considering a new modifier down:
            // Windows has updated the state of those earlier typing events.
            // Never poll our chord modifiers here: consumed modifiers and the synthetic
            // releases used for typing deliberately differ from physical holds.
            down.RemoveWhere(code => !IsControl(code) && !IsWindows(code) && !IsShift(code) && !IsKeyDown(code));
        }
        bool repeated = !key.Up && down.Contains(key.Code);
        if (key.Up) down.Remove(key.Code); else down.Add(key.Code);
        if (!control && !windows && !shift)
        {
            if (key.Up) return false;
            if (key.Code == 0x1B && latched) { pendingModifiers.Clear(); Interrupt(); return true; }
            recording = false; deadline = 0; Cancel();
            bypass = ControlDown || ShiftDown || WindowsDown;
            if (consumed || suppressControl) {
                // A hold that started dictation owns these modifiers until
                // release. Replaying its Ctrl/Shift/Win downs on cancellation can
                // turn ordinary typing into Win+H, Win+E, or Ctrl shortcuts.
                pendingModifiers.Clear(); return false;
            }
            if (pendingModifiers.Count == 0) return false;
            // Restore the exact modifier downs before the third key, in ONE
            // SendInput batch. Ctrl+Shift+C/V/Arrow/etc. keep their original meaning.
            pendingModifiers.Add(key); ReplayPending(); return true;
        }

        int pending = pendingModifiers.FindIndex(item => item.Code == key.Code);
        bool handled = false;
        if (windows || pending >= 0 || (control && ShiftDown) || (shift && ControlDown))
        {
            if (consumed) {
                if (pending >= 0 && key.Up) pendingModifiers.RemoveAt(pending);
                // Always let releases clear Windows' state, even if another
                // hook or a delayed event previously let a key-down through.
                handled = !key.Up;
            }
            else if (key.Up && pending >= 0)
            {
                Key first = pendingModifiers[pending]; pendingModifiers.RemoveAt(pending);
                if (!windows || !latched) Replay(new[] { first, key });
                handled = true;
            }
            else if (!key.Up && pending >= 0) handled = true; // Ignore deferred modifier autorepeat.
            else if (!key.Up && !repeated && !bypass && !OtherDown && !otherModifiers)
            {
                pendingModifiers.Add(key); handled = true;
            }
        }
        // Once committed, neither modifier may reactivate between streamed
        // fragments or after cancellation. Physical key-ups always pass.
        if (consumed && (control || shift) && !key.Up) handled = true;
        if (key.Up)
        {
            if (!ControlDown || !ShiftDown || (ScreenAware && !WindowsDown))
            {
                deadline = 0;
                if (recording) { recording = false; Finish(); }
            }
            if (!ControlDown && !WindowsDown && !ShiftDown) { latched = consumed = bypass = completed = suppressControl = ScreenAware = false; }
        }
        else if (!repeated)
        {
            if (windows && latched && !completed && !ScreenAware && (recording || deadline != 0)) {
                ScreenAware = true;
                if (recording && Promote != null) Promote();
            }
            if (!recording) Cancel();
            if (!latched && !bypass && !OtherDown && !otherModifiers && ControlDown && ShiftDown && pendingModifiers.Count > 0)
            {
                latched = true; ScreenAware = WindowsDown; deadline = now + HoldMs;
            }
        }
        return handled;
    }
    internal void Tick(long now)
    {
        if (!latched && !suppressControl && IsKeyDown != null) {
            // Outside an owned chord these keys pass through unchanged, so
            // asynchronous state can recover releases lost on a secure desktop.
            // Never use it for a deferred or neutralized modifier.
            down.RemoveWhere(code => (IsControl(code) || IsShift(code)) && !IsKeyDown(code));
            if (!ControlDown && !ShiftDown && !WindowsDown) bypass = false;
        }
        if (deadline == 0 || now < deadline) return;
        deadline = 0;
        if (!bypass && ControlDown && ShiftDown) {
            consumed = recording = suppressControl = true;
            if (ReleaseModifiers != null) ReleaseModifiers(); Start();
        }
    }
    internal void Complete()
    {
        // A spoken send command finishes without requiring a physical release.
        // Keep the chord consumed until both keys come up, including repeats.
        completed = true; suppressControl = ControlDown || ShiftDown || WindowsDown; deadline = 0;
        if (recording) { recording = false; Finish(); }
    }
    internal void BeginTextInput()
    {
        // Repeated up/restore pairs race Chromium's delayed key dispatch.
        // This flag is volatile because insertion runs on the text worker.
        suppressControl = true;
    }
    private void ReplayPending()
    {
        Key[] keys = pendingModifiers.ToArray(); pendingModifiers.Clear();
        if (keys.Length > 0) Replay(keys);
    }
    internal void Flush()
    {
        if ((consumed || suppressControl) && ReleaseModifiers != null) ReleaseModifiers();
        // Shutdown cannot promise to observe the corresponding physical up.
        // Never leave an unpaired synthetic modifier down behind in another app.
        pendingModifiers.Clear();
    }
    internal void Reset()
    {
        // A removed hook may have missed arbitrary key-up events. Do not
        // replay those old modifier downs into the newly focused application.
        if ((consumed || suppressControl) && ReleaseModifiers != null) ReleaseModifiers();
        down.Clear(); pendingModifiers.Clear(); deadline = 0;
        latched = consumed = recording = bypass = completed = suppressControl = ScreenAware = false;
    }
    internal void Interrupt()
    {
        if (consumed || suppressControl) pendingModifiers.Clear();
        if (!consumed && !suppressControl) ReplayPending();
        recording = false; deadline = 0; bypass = ControlDown || ShiftDown || WindowsDown; Cancel();
    }
}
