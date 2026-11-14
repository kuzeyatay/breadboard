using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Automation.Text;
using System.Windows.Forms;

internal static class BreadboardDictation
{
    private delegate IntPtr Hook(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] private struct Keyboard { public uint Key, Scan, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct KeyInput { public ushort Key, Scan; public uint Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Explicit)] private struct InputData { [FieldOffset(0)] public KeyInput Key; [FieldOffset(0)] public MouseInput Mouse; }
    [StructLayout(LayoutKind.Sequential)] private struct Input { public uint Type; public InputData Data; }
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct GuiInfo { public int Size; public uint Flags; public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret; public Rect CaretRect; }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr module, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, Input[] input, int size);
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetGUIThreadInfo(uint thread, ref GuiInfo info);
    [DllImport("user32.dll")] private static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Rect points, uint count);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible accessible);
    [DllImport("kernel32.dll")] private static extern IntPtr GetModuleHandle(string name);
    private static readonly Hook keyboardHook = OnKeyboard, mouseHook = OnMouse;
    private static readonly Stopwatch clock = Stopwatch.StartNew();
    private static readonly BlockingCollection<Action> work = new BlockingCollection<Action>();
    private static readonly BlockingCollection<object> output = new BlockingCollection<object>();
    private static readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private static readonly object gate = new object();
    private static readonly UIntPtr restoreControlMarker = new UIntPtr(0xBBD1000000000000UL | (uint)Process.GetCurrentProcess().Id);
    private static readonly UIntPtr deferredModifierMarker = new UIntPtr(0xBBD2000000000000UL | (uint)Process.GetCurrentProcess().Id);
    // Matches Mausely's voice-only SendInput tag; never treat our own typed text as a chord.
    private static readonly UIntPtr mauselyVoiceMarker = new UIntPtr(0x4D415553u);
    private static volatile int physicalControls;
    private static volatile int physicalShifts;
    private static volatile int physicalWindows;
    private static volatile bool previewInputPending;
    private static readonly DictationChord chord = new DictationChord();
    private static Control dispatcher;
    private static IntPtr keyboard, mouse;
    private static int sequence;
    private static int editSequence;
    private static Session current;
    private static bool anchorQueued;
    private static long lastAnchorPoll;
    private static long nextHookRefresh;
    private const int HookRefreshMs = 2000;
    private sealed class Anchor
    {
        public int x, y, width, height;
        internal Anchor(double left, double top, double w, double h)
        { x = (int)Math.Round(left); y = (int)Math.Round(top); width = Math.Max(1, (int)Math.Round(w)); height = Math.Max(1, (int)Math.Round(h)); }
    }
    private sealed class Session
    {
        internal int Id;
        internal IntPtr Window, Focus;
        internal AutomationElement Element;
        internal DictationAccessibleTarget Accessible;
        internal bool Released;
        internal bool VoiceFinished;
        internal bool Started;
        internal bool ScreenAware;
        internal string PendingText;
        internal bool PendingSubmit;
        internal Anchor Anchor;
        internal int PreviewStart = -1, PreviewEnd;
        internal string OriginalSelection, PreviewText, NextPreview;
        internal bool PreviewQueued;
        internal bool RendererInput;
        internal RendererEdit Edit;
    }
    private sealed class RendererEdit { internal int Id; internal bool? Applied; }
    private static IntPtr Focus()
    {
        GuiInfo info = new GuiInfo(); info.Size = Marshal.SizeOf(typeof(GuiInfo));
        return GetGUIThreadInfo(0, ref info) ? info.Focus : IntPtr.Zero;
    }
    private static bool Modifiers()
    {
        foreach (int key in new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
            if ((GetAsyncKeyState(key) & 0x8000) != 0) return true;
        return false;
    }
    private static void Emit(object value) { output.Add(value); }
    private static bool InstallHooks()
    {
        // Windows can silently remove a low-level hook after a timeout while
        // leaving its owner process alive. Renew on the message-loop thread;
        // install replacements first so there is no unhooked input interval.
        // https://learn.microsoft.com/windows/win32/winmsg/lowlevelkeyboardproc
        IntPtr nextKeyboard = SetWindowsHookEx(13, keyboardHook, GetModuleHandle(null), 0);
        IntPtr nextMouse = SetWindowsHookEx(14, mouseHook, GetModuleHandle(null), 0);
        if (nextKeyboard == IntPtr.Zero || nextMouse == IntPtr.Zero)
        {
            if (nextKeyboard != IntPtr.Zero) UnhookWindowsHookEx(nextKeyboard);
            if (nextMouse != IntPtr.Zero) UnhookWindowsHookEx(nextMouse);
            return false; // Keep the existing pair and retry on the next tick.
        }
        IntPtr oldKeyboard = keyboard, oldMouse = mouse;
        keyboard = nextKeyboard; mouse = nextMouse;
        bool lostKeyboard = oldKeyboard != IntPtr.Zero && !UnhookWindowsHookEx(oldKeyboard);
        bool lostMouse = oldMouse != IntPtr.Zero && !UnhookWindowsHookEx(oldMouse);
        if (lostKeyboard || lostMouse)
        {
            CancelFor("hooks-restored"); chord.Reset(); physicalControls = physicalShifts = physicalWindows = 0;
            Emit(new { type = "hooks-restored" });
        }
        return true;
    }
    private static bool OtherModifiers()
    {
        return (GetAsyncKeyState(0x10) & 0x8000) != 0 || (GetAsyncKeyState(0x12) & 0x8000) != 0;
    }
    private static Input Key(ushort code, ushort scan, uint flags)
    {
        Input result = new Input(); result.Type = 1;
        result.Data.Key.Key = code; result.Data.Key.Scan = scan; result.Data.Key.Flags = flags;
        return result;
    }
    private static int ControlBit(int key) { return key == 0xA3 ? 2 : key == 0xA2 || key == 0x11 ? 1 : 0; }
    private static void RecordPhysicalControl(int key, bool up)
    {
        int bit = ControlBit(key);
        if (bit != 0) physicalControls = up ? physicalControls & ~bit : physicalControls | bit;
    }
    private static void RecordPhysicalWindows(int key, bool up)
    {
        int bit = key == 0x5B ? 1 : key == 0x5C ? 2 : 0;
        if (bit != 0) physicalWindows = up ? physicalWindows & ~bit : physicalWindows | bit;
    }
    private static void RecordPhysicalShift(int key, bool up)
    {
        int bit = key == 0xA1 ? 2 : key == 0xA0 || key == 0x10 ? 1 : 0;
        if (bit != 0) physicalShifts = up ? physicalShifts & ~bit : physicalShifts | bit;
    }
    private static bool SuppressReleasedModifier(Keyboard key)
    {
        int code = (int)key.Key, bit, held;
        if (DictationChord.IsControl(code)) { bit = ControlBit(code); held = physicalControls; }
        else if (DictationChord.IsShift(code)) { bit = code == 0xA1 ? 2 : 1; held = physicalShifts; }
        else { bit = code == 0x5B ? 1 : code == 0x5C ? 2 : 0; held = physicalWindows; }
        return key.Extra == deferredModifierMarker && (key.Flags & 0x80) == 0 && bit != 0
            && (chord.SuppressControl || (held & bit) == 0);
    }
    private static void ReleaseDictationModifiers()
    {
        // A committed hold owns both modifiers. Only inject releases: no
        // delayed restore may resurrect a Windows shortcut after dictation.
        Input[] keys = { Key(0xA2, 0, 2), Key(0xA3, 0, 3), Key(0xA0, 0, 2), Key(0xA1, 0, 2), Key(0x5B, 0, 3), Key(0x5C, 0, 3) };
        SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(Input)));
    }
    private static bool SuppressReleasedControl(Keyboard key)
    {
        return key.Extra == restoreControlMarker && (key.Flags & 0x80) == 0
            && ControlBit((int)key.Key) != 0 && (previewInputPending || chord.SuppressControl || (physicalControls & ControlBit((int)key.Key)) == 0);
    }
    private static void Replay(DictationChord.Key[] keys)
    {
        Input[] inputs = new Input[keys.Length];
        for (int i = 0; i < keys.Length; i++) {
            inputs[i] = Key((ushort)keys[i].Code, (ushort)keys[i].Scan, (keys[i].Up ? 2u : 0u) | (keys[i].Extended ? 1u : 0u));
            if ((DictationChord.IsWindows(keys[i].Code) || DictationChord.IsControl(keys[i].Code) || DictationChord.IsShift(keys[i].Code)) && !keys[i].Up) {
                bool paired = false;
                for (int j = i + 1; j < keys.Length; j++) if (keys[j].Code == keys[i].Code && keys[j].Up) paired = true;
                // A complete modifier tap is one balanced batch. An ordinary
                // shortcut's deferred down must still belong to a held key.
                if (!paired) inputs[i].Data.Key.Extra = deferredModifierMarker;
            }
        }
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != inputs.Length) {
            var releases = new System.Collections.Generic.List<Input>();
            foreach (var key in keys) if (!key.Up && (DictationChord.IsWindows(key.Code) || DictationChord.IsControl(key.Code) || DictationChord.IsShift(key.Code)))
                releases.Add(Key((ushort)key.Code, 0, key.Extended ? 3u : 2u));
            if (releases.Count > 0) SendInput((uint)releases.Count, releases.ToArray(), Marshal.SizeOf(typeof(Input)));
            Emit(new { type = "error", message = "Windows blocked the dictation keyboard helper. Restart Breadboard." });
        }
    }
    private static void Cancel() { CancelFor("input"); }
    private static void CancelFor(string reason)
    {
        Session old;
        lock (gate) { old = current; current = null; }
        if (old != null) Emit(new { type = "cancel", id = old.Id, reason = reason });
    }
    // All coordinates sent to Electron are physical screen pixels. Never read
    // the mouse: native carets, accessible carets and text selection describe
    // the actual insertion point, including Chromium and custom text editors.
    private static Anchor ReadAnchor(Session session)
    {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try
        {
            GuiInfo info = new GuiInfo(); info.Size = Marshal.SizeOf(typeof(GuiInfo));
            if (GetGUIThreadInfo(0, ref info) && info.Focus == session.Focus && info.Caret != IntPtr.Zero
                && info.CaretRect.Bottom > info.CaretRect.Top)
            {
                Rect bounds = info.CaretRect; MapWindowPoints(info.Caret, IntPtr.Zero, ref bounds, 2);
                return new Anchor(bounds.Left, bounds.Top, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
            }
            foreach (IntPtr window in new[] { session.Focus, session.Window })
            {
                Accessibility.IAccessible caret = null;
                try
                {
                    Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
                    if (AccessibleObjectFromWindow(window, unchecked((uint)-8), ref iid, out caret) == 0 && caret != null)
                    {
                        int x, y, width, height; caret.accLocation(out x, out y, out width, out height, 0);
                        if (height > 0) return new Anchor(x, y, width, height);
                    }
                }
                catch { /* This app may only expose UI Automation. */ }
                finally { if (caret != null && Marshal.IsComObject(caret)) Marshal.ReleaseComObject(caret); }
            }
            if (session.Accessible != null)
            {
                int[] caret = session.Accessible.Caret();
                if (caret != null) return new Anchor(caret[0], caret[1], caret[2], caret[3]);
                int[] bounds = session.Accessible.Bounds();
                if (bounds != null) return new Anchor(bounds[0] + Math.Min(8, bounds[2] / 2), bounds[1], 1, Math.Min(24, bounds[3]));
            }
            if (session.Element == null) return null;
            object value;
            if (session.Element.TryGetCurrentPattern(TextPattern.Pattern, out value))
            {
                TextPatternRange[] selection = ((TextPattern)value).GetSelection();
                if (selection.Length > 0)
                {
                    TextPatternRange range = selection[0].Clone();
                    range.MoveEndpointByRange(TextPatternRangeEndpoint.Start, range, TextPatternRangeEndpoint.End);
                    System.Windows.Rect[] bounds = range.GetBoundingRectangles();
                    if (bounds.Length > 0 && bounds[0].Height > 0) return new Anchor(bounds[0].X, bounds[0].Y, 1, bounds[0].Height);
                    bool previousCharacter = range.MoveEndpointByUnit(TextPatternRangeEndpoint.End, TextUnit.Character, 1) == 0;
                    if (previousCharacter) range.MoveEndpointByUnit(TextPatternRangeEndpoint.Start, TextUnit.Character, -1);
                    bounds = range.GetBoundingRectangles();
                    if (bounds.Length > 0)
                    {
                        System.Windows.Rect rect = bounds[previousCharacter ? bounds.Length - 1 : 0];
                        if (rect.Height > 0) return new Anchor(previousCharacter ? rect.Right : rect.Left, rect.Top, 1, rect.Height);
                    }
                }
            }
            // Some editors hide their caret from accessibility. Stay above the
            // focused field in that case, rather than following the mouse.
            System.Windows.Rect field = session.Element.Current.BoundingRectangle;
            if (!field.IsEmpty && field.Width > 0 && field.Height > 0)
                return new Anchor(field.Left + Math.Min(8, field.Width / 2), field.Top, 1, Math.Min(24, field.Height));
        }
        catch { /* A closing or temporarily unavailable editor must not stop recording. */ }
        finally { if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous); }
        return null;
    }
    private static void RefreshAnchor(Session session)
    {
        try
        {
            Anchor anchor = ReadAnchor(session);
            lock (gate)
            {
                if (current != session || anchor == null) return;
                Anchor old = session.Anchor;
                if (old != null && old.x == anchor.x && old.y == anchor.y && old.width == anchor.width && old.height == anchor.height) return;
                session.Anchor = anchor; Emit(new { type = "anchor", id = session.Id, anchor = anchor });
            }
        }
        finally { lock (gate) anchorQueued = false; }
    }
    private static void Begin()
    {
        CancelFor("replaced");
        Session session = new Session { Id = ++sequence, Window = GetForegroundWindow(), Focus = Focus(), ScreenAware = chord.ScreenAware };
        lock (gate) current = session;
        // UI Automation must NEVER run in a low-level hook: a slow target app
        // would make Windows silently remove the keyboard hook.
        work.Add(delegate {
            try
            {
                // Inspect the actual focused descendant. The legacy Chromium
                // UIA bridge can return its document instead of the editor.
                for (int attempt = 0; attempt < 6; attempt++)
                {
                    lock (gate) { if (current != session) return; }
                    if (session.Window != GetForegroundWindow() || session.Focus != Focus()) { CancelFor("focus"); return; }
                    session.Accessible = DictationAccessibleTarget.FromWindow(session.Focus)
                        ?? DictationAccessibleTarget.FromWindow(session.Window);
                    if (session.Accessible != null) break;
                    AutomationElement element = AutomationElement.FocusedElement;
                    if (element != null && !element.Current.IsPassword && element.Current.IsEnabled)
                    {
                        object value, text;
                        bool writable = element.TryGetCurrentPattern(ValuePattern.Pattern, out value)
                            && !((ValuePattern)value).Current.IsReadOnly;
                        bool textEditor = element.TryGetCurrentPattern(TextPattern.Pattern, out text)
                            && Object.Equals(((TextPattern)text).DocumentRange.GetAttributeValue(TextPattern.IsReadOnlyAttribute), false);
                        if (writable || textEditor) { session.Element = element; break; }
                    }
                    Thread.Sleep(40); // Give a cold accessibility tree time to publish focus.
                }
                if (session.Accessible == null && session.Element == null)
                    throw new InvalidOperationException("Click an editable text field, then hold Ctrl + Shift.");
                CapturePreview(session);
                Anchor anchor = ReadAnchor(session);
                lock (gate)
                {
                    if (current != session) return;
                    if (session.Window != GetForegroundWindow() || session.Focus != Focus()) { CancelFor("focus"); return; }
                    session.Anchor = anchor;
                    session.Started = true;
                    Emit(new { type = "start", id = session.Id, window = session.Window.ToInt64(), anchor = anchor, mode = session.ScreenAware ? "reply" : "dictate" });
                    if (session.Released) Emit(new { type = "stop", id = session.Id });
                }
            }
            catch (Exception error)
            {
                lock (gate)
                {
                    if (current != session) return;
                    current = null;
                    Emit(new { type = "error", id = session.Id, message = error.Message });
                }
            }
        });
    }
    private static void Finish()
    {
        lock (gate)
        {
            if (current == null || current.Released) return;
            current.Released = true;
            if (current.Started) Emit(new { type = "stop", id = current.Id });
        }
    }
    private static void Promote()
    {
        lock (gate) {
            if (current == null || current.Released || current.ScreenAware) return;
            current.ScreenAware = true;
            if (current.Started) Emit(new { type = "mode", id = current.Id, mode = "reply", anchor = current.Anchor });
        }
    }
    private static bool IsMauselyVoiceInput(Keyboard input)
    {
        return (input.Flags & 0x10) != 0 && input.Extra == mauselyVoiceMarker
            && (DictationChord.IsControl((int)input.Key) || DictationChord.IsShift((int)input.Key));
    }
    private static IntPtr OnKeyboard(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(keyboard, code, message, data);
        Keyboard input = (Keyboard)Marshal.PtrToStructure(data, typeof(Keyboard));
        if ((input.Flags & 0x10) != 0 && !IsMauselyVoiceInput(input)) {
            // A physical release can reach the hook after a batch is queued but
            // before its restore event. Never resurrect a released Ctrl key.
            if (SuppressReleasedControl(input) || SuppressReleasedModifier(input)) return new IntPtr(1);
            return CallNextHookEx(keyboard, code, message, data);
        }
        RecordPhysicalControl((int)input.Key, (input.Flags & 0x80) != 0);
        RecordPhysicalShift((int)input.Key, (input.Flags & 0x80) != 0);
        RecordPhysicalWindows((int)input.Key, (input.Flags & 0x80) != 0);
        DictationChord.Key key = new DictationChord.Key((int)input.Key, (input.Flags & 0x80) != 0);
        key.Scan = (int)input.Scan; key.Extended = (input.Flags & 1) != 0;
        if (key.Code == 0x1B && !key.Up)
        {
            lock (gate) { if (current != null) { chord.Interrupt(); return new IntPtr(1); } }
        }
        // Any ordinary key invalidates a pending insertion. Ctrl and Shift
        // stay available to the target app until the dictation hold commits.
        bool handled = chord.Handle(key, clock.ElapsedMilliseconds, (GetAsyncKeyState(0x12) & 0x8000) != 0);
        // A held physical Ctrl or Shift can repeat while Chromium is dispatching
        // queued Unicode. Keep that repeat, and older queued restores, from
        // turning the rest of this preview into shortcuts. Key-up always passes.
        if ((previewInputPending || chord.SuppressControl)
            && (DictationChord.IsControl(key.Code) || DictationChord.IsShift(key.Code)) && !key.Up) handled = true;
        return handled ? new IntPtr(1) : CallNextHookEx(keyboard, code, message, data);
    }
    private static IntPtr OnMouse(int code, IntPtr message, IntPtr data)
    {
        int kind = message.ToInt32();
        if (code >= 0 && (kind == 0x201 || kind == 0x204 || kind == 0x207 || kind == 0x20B || kind == 0x20A)) chord.Interrupt();
        return CallNextHookEx(mouse, code, message, data);
    }
    private static bool OwnsField(Session session)
    {
        lock (gate) { if (current != session || session.Window != GetForegroundWindow() || session.Focus != Focus()) return false; }
        return session.Accessible != null ? session.Accessible.IsFocused()
            : session.Element != null && Automation.Compare(session.Element, AutomationElement.FocusedElement);
    }
    private static bool CapturePreview(Session session)
    {
        if (session.PreviewStart >= 0) return true;
        if (!OwnsField(session)) return false;
        // Chromium can publish editability before its text/selection bridge.
        // Retry when words arrive instead of making one cold accessibility
        // read decide that this entire hold must wait for final insertion.
        // Resolve only while the originally captured editor still owns focus.
        var target = DictationAccessibleTarget.FromWindow(session.Focus)
            ?? DictationAccessibleTarget.FromWindow(session.Window) ?? session.Accessible;
        if (target == null || !target.IsFocused() || !target.SupportsStreaming) return false;
        int[] selection = target.Selection();
        if (selection == null || selection[0] < 0 || selection[1] < selection[0] || selection[1] - selection[0] > 32000) return false;
        string selected = target.Text(selection[0], selection[1]);
        if (selected == null) return false;
        session.Accessible = target;
        session.PreviewStart = selection[0]; session.PreviewEnd = selection[1]; session.OriginalSelection = selected;
        return true;
    }
    private static bool SelectionIs(Session session, int start, int end)
    {
        int[] selected = session.Accessible.Selection();
        return selected != null && selected[0] == start && selected[1] == end;
    }
    private static bool SamePreview(string observed, string expected)
    {
        if (observed == expected) return true;
        if (observed == null || expected == null || observed.Length != expected.Length) return false;
        // Chromium uses NBSP to keep typed spaces visible in contenteditable.
        // This is a one-code-unit substitution, so the owned IA2 offsets stay
        // exact. Never trim, collapse whitespace or accept a partial result.
        for (int i = 0; i < expected.Length; i++)
            if (observed[i] != expected[i] && !(expected[i] == ' ' && observed[i] == '\u00a0')) return false;
        return true;
    }
    private static bool RebaseInitialPreview(Session session, string expected, string prefix, string suffix)
    {
        if (prefix == null || suffix == null || (prefix.IndexOf('\ufffc') < 0 && suffix.IndexOf('\ufffc') < 0)) return false;
        // Removing an empty-editor decoration can also change which IA2 node
        // owns the text. Resolve that node again within the captured window.
        var target = DictationAccessibleTarget.FromWindow(session.Window) ?? session.Accessible;
        int[] selection = target.Selection();
        if (selection == null || selection[0] != selection[1] || selection[0] < expected.Length) return false;
        int end = selection[0], start = end - expected.Length;
        if (!SamePreview(target.Text(start, end), expected)) return false;
        string before = target.Text(0, start), after = target.Text(end, -1);
        if (before == null || after == null) return false;
        // Empty rich composers remove their read-only placeholder when the
        // first characters arrive. Confirm the entire inserted span and all
        // surrounding text before adopting its shifted character offsets.
        prefix = prefix.Replace("\ufffc", ""); suffix = suffix.Replace("\ufffc", "");
        before = before.Replace("\ufffc", ""); after = after.Replace("\ufffc", "");
        if (!SamePreview(before, prefix)) return false;
        // The empty paragraph's <br> can disappear along with its placeholder.
        if (!SamePreview(after, suffix) && !(prefix.Length == 0 && suffix == "\n" && after.Length == 0)) return false;
        if (!session.Accessible.IsFocused() || !target.IsFocused()) return false;
        session.Accessible = target; session.PreviewStart = start; session.PreviewEnd = end;
        return true;
    }
    private static void WaitSelection(Session session, int start, int end, string expected, string prefix = null, string suffix = null)
    {
        // SendInput queues keystrokes; React and the accessibility tree may
        // process them over several frames. A short fixed 300ms window aborted
        // recording in the middle of valid edits. Return as soon as confirmed,
        // while allowing a busy editor time to publish its completed update.
        long deadline = clock.ElapsedMilliseconds + 2000;
        do {
            if (!OwnsField(session)) throw new InvalidOperationException("The text field changed. Hold Ctrl + Shift to dictate again.");
            if (SelectionIs(session, start, end) && (expected == null || SamePreview(session.Accessible.Text(session.PreviewStart, session.PreviewEnd), expected))) return;
            if (expected != null && RebaseInitialPreview(session, expected, prefix, suffix)) return;
            Thread.Sleep(10);
        } while (clock.ElapsedMilliseconds < deadline);
        int[] actualSelection = session.Accessible.Selection();
        string actual = expected == null ? null : session.Accessible.Text(session.PreviewStart, session.PreviewEnd);
        Emit(new { type = "preview-unconfirmed", id = session.Id, phase = expected == null ? "selection" : "text",
            selection = actualSelection, expectedStart = start, expectedEnd = end,
            expectedCharacters = expected == null ? -1 : expected.Length, observedCharacters = actual == null ? -1 : actual.Length,
            textMatches = expected == null || SamePreview(actual, expected) });
        throw new InvalidOperationException("The editor could not confirm the dictated text. The visible draft has been kept.");
    }
    private static void EnableRendererInput(int id)
    {
        lock (gate) { if (current != null && current.Id == id) current.RendererInput = true; }
    }
    private static void CompleteRendererEdit(int id, int request, bool applied)
    {
        lock (gate) {
            if (current == null || current.Id != id || current.Edit == null || current.Edit.Id != request || current.Edit.Applied.HasValue) return;
            current.Edit.Applied = applied; Monitor.PulseAll(gate);
        }
    }
    private static void EditRenderer(Session session, string text)
    {
        lock (gate) {
            if (current != session || session.Window != GetForegroundWindow() || session.Focus != Focus() || OtherModifiers())
                throw new InvalidOperationException("The text field changed. The visible dictation draft has been kept.");
            var edit = new RendererEdit { Id = ++editSequence };
            session.Edit = edit;
            try {
                Emit(new { type = "edit", id = session.Id, request = edit.Id, text = text });
                long deadline = clock.ElapsedMilliseconds + 5000;
                // The pipe reader acknowledges independently of this worker.
                // Release the hook's lock while waiting; cancellation wins.
                while (current == session && !edit.Applied.HasValue && clock.ElapsedMilliseconds < deadline) Monitor.Wait(gate, 50);
                if (current != session || edit.Applied != true)
                    throw new InvalidOperationException("The editor could not insert the dictated text. The visible draft has been kept.");
            } finally { session.Edit = null; }
        }
    }
    // Select only this hold's inserted span. IA2 offsets preserve Unicode and
    // surrounding rich-text markup; no select-all or guessed backspace count.
    private static bool UpdatePreview(Session session, string text)
    {
        if (!session.Started || !CapturePreview(session)) return false;
        if (text.Length > 32000 || text.IndexOf('\0') >= 0) throw new InvalidOperationException("The dictation is too long to insert.");
        if (text == session.PreviewText || (session.PreviewText == null && text.Length == 0)) return true;
        if (!OwnsField(session)) throw new InvalidOperationException("The text field changed. Hold Ctrl + Shift to dictate again.");
        int caret = session.PreviewText == null ? session.PreviewStart : session.PreviewEnd;
        string observed = session.Accessible.Text(session.PreviewStart, session.PreviewEnd);
        if (!SelectionIs(session, caret, session.PreviewEnd)
            || (session.PreviewText == null ? observed != session.OriginalSelection : !SamePreview(observed, session.PreviewText)))
            throw new InvalidOperationException("The text or selection changed. The visible dictation draft has been kept.");
        string initialPrefix = session.PreviewText == null ? session.Accessible.Text(0, session.PreviewStart) : null;
        string initialSuffix = session.PreviewText == null ? session.Accessible.Text(session.PreviewEnd, -1) : null;
        int common = 0;
        if (session.PreviewText != null) {
            while (common < text.Length && common < session.PreviewText.Length && text[common] == session.PreviewText[common]) common++;
            if (common > 0 && Char.IsHighSurrogate(text[common - 1])) common--;
        }
        int start = session.PreviewStart + common;
        if (!SelectionIs(session, start, session.PreviewEnd)) {
            if (!session.Accessible.Select(start, session.PreviewEnd))
                throw new InvalidOperationException("This editor could not update the dictated text. The visible draft has been kept.");
            WaitSelection(session, start, session.PreviewEnd, null);
        }
        var inputs = new System.Collections.Generic.List<Input>();
        // Always neutralize BOTH Ctrl keys at the start of every batch. The
        // previous batch's restore may still be queued when GetAsyncKeyState
        // reports Ctrl up; conditionally adding key-up loses rapid updates.
        foreach (ushort key in new ushort[] { 0xA2, 0xA3 }) {
            inputs.Add(Key(key, 0, key == 0xA3 ? 3u : 2u));
        }
        string suffix = text.Substring(common);
        if (suffix.Length == 0 && start < session.PreviewEnd) { inputs.Add(Key(8, 0, 0)); inputs.Add(Key(8, 0, 2)); }
        foreach (char character in suffix) { inputs.Add(Key(0, character, 4)); inputs.Add(Key(0, character, 6)); }
        bool attemptedInput = false;
        try {
            if (session.RendererInput) EditRenderer(session, suffix);
            else {
                Input[] batch = inputs.ToArray();
                lock (gate) {
                    if (current != session || session.Window != GetForegroundWindow() || session.Focus != Focus() || OtherModifiers()) return false;
                    previewInputPending = true;
                    attemptedInput = true;
                }
                // SendInput can synchronously call our keyboard hook. Never hold
                // the hook's gate while Windows dispatches a release/cancellation.
                if (SendInput((uint)batch.Length, batch, Marshal.SizeOf(typeof(Input))) != batch.Length)
                    throw new InvalidOperationException("Windows blocked live dictation in this editor.");
            }
            lock (gate) {
                if (current != session) return false;
                session.PreviewText = text; session.PreviewEnd = session.PreviewStart + text.Length;
            }
            WaitSelection(session, session.PreviewEnd, session.PreviewEnd, text, initialPrefix, initialSuffix);
        }
        finally {
            previewInputPending = false;
            // Chromium dispatches some character events after Windows has
            // advanced its modifier state. Restoring Ctrl in the text batch
            // makes those characters shortcuts. Restore only after the editor
            // acknowledges the complete text, in a separate batch.
            var restore = new System.Collections.Generic.List<Input>();
            foreach (ushort key in new ushort[] { 0xA2, 0xA3 }) {
                if (!attemptedInput || chord.SuppressControl || (physicalControls & ControlBit(key)) == 0) continue;
                Input input = Key(key, 0, key == 0xA3 ? 1u : 0u);
                input.Data.Key.Extra = restoreControlMarker; restore.Add(input);
            }
            if (restore.Count > 0) SendInput((uint)restore.Count, restore.ToArray(), Marshal.SizeOf(typeof(Input)));
        }
        Emit(new { type = "previewed", id = session.Id, characters = text.Length, whileHeld = !session.Released });
        return true;
    }
    private static void QueuePreview(int id, string text)
    {
        lock (gate) {
            Session session = current;
            if (session == null || session.Id != id || text.Length > 32000) return;
            session.NextPreview = text;
            if (session.PreviewQueued) return;
            session.PreviewQueued = true;
            work.Add(delegate {
                string next;
                lock (gate) { session.PreviewQueued = false; next = session.NextPreview; session.NextPreview = null; if (current != session) return; }
                try { UpdatePreview(session, next); }
                catch (Exception error) {
                    lock (gate) { if (current != session) return; current = null; }
                    Emit(new { type = "error", id = id, message = error.Message });
                }
            });
        }
    }
    private static void Insert(int id, string text, bool submit)
    {
        Session session;
        lock (gate) session = current;
        if (session == null || session.Id != id || !session.Released) return;
        try
        {
            if (text.Length > 32000 || text.IndexOf('\0') >= 0) throw new InvalidOperationException("The dictation is too long to insert.");
            // Comparing the accessibility element also distinguishes two HTML
            // inputs that share one Chromium native window handle.
            if (session.Accessible != null ? !session.Accessible.IsFocused()
                : session.Element == null || !Automation.Compare(session.Element, AutomationElement.FocusedElement))
                throw new InvalidOperationException("The text field changed. Hold Ctrl + Shift to dictate again.");
            string insertionText = text;
            if (session.PreviewText != null || (session.RendererInput && CapturePreview(session))) {
                if (!UpdatePreview(session, text)) throw new InvalidOperationException("The text field changed. The visible dictation draft has been kept.");
                insertionText = "";
            }
            Input[] inputs;
            lock (gate)
            {
                if (current != session) return;
                if (session.Window != GetForegroundWindow() || session.Focus != Focus())
                    throw new InvalidOperationException("The text field changed. Hold Ctrl + Shift to dictate again.");
                // Releasing either shortcut key finishes recording. Owned
                // modifiers stay neutral so Enter cannot become Ctrl/Shift+Enter.
                if (Modifiers() && (!session.VoiceFinished || OtherModifiers())) { session.PendingText = text; session.PendingSubmit = submit; return; }
                int prefix = session.VoiceFinished ? 2 : 0;
                inputs = new Input[prefix + insertionText.Length * 2 + (submit ? 2 : 0)];
                if (prefix > 0) { inputs[0] = Key(0xA2, 0, 2); inputs[1] = Key(0xA3, 0, 3); }
                for (int i = 0; i < insertionText.Length; i++)
                {
                    inputs[prefix + i * 2] = Key(0, insertionText[i], 4);
                    inputs[prefix + i * 2 + 1] = Key(0, insertionText[i], 6);
                }
                if (submit)
                {
                    // Text and Enter form ONE ordered batch, under the same
                    // focus check. Never retry a partial SendInput submission.
                    inputs[prefix + insertionText.Length * 2] = Key(0x0D, 0, 0);
                    inputs[prefix + insertionText.Length * 2 + 1] = Key(0x0D, 0, 2);
                }
            }
            if (inputs.Length > 0 && SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != inputs.Length)
                throw new InvalidOperationException("Windows blocked text insertion. The target app may be running as administrator.");
            lock (gate) {
                if (current != session) return;
                current = null;
                Emit(new { type = "inserted", id = id });
            }
        }
        catch (Exception error)
        {
            lock (gate) { if (current != session) return; current = null; }
            Emit(new { type = "error", id = id, message = error.Message });
        }
    }
    [STAThread] private static int Main()
    {
        Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
        new Thread(delegate() { foreach (object item in output.GetConsumingEnumerable()) { Console.WriteLine(json.Serialize(item)); Console.Out.Flush(); } }) { IsBackground = true }.Start();
        new Thread(delegate() { foreach (Action action in work.GetConsumingEnumerable()) action(); }) { IsBackground = true }.Start();
        dispatcher = new Control(); IntPtr handle = dispatcher.Handle;
        chord.Replay = Replay; chord.Start = Begin; chord.Finish = Finish; chord.Cancel = Cancel; chord.Promote = Promote;
        chord.ReleaseModifiers = ReleaseDictationModifiers;
        chord.IsKeyDown = key => (GetAsyncKeyState(key) & 0x8000) != 0;
        if (!InstallHooks()) return 1;
        nextHookRefresh = clock.ElapsedMilliseconds + HookRefreshMs;
        new Thread(delegate() {
            try
            {
                string line;
                JavaScriptSerializer reader = new JavaScriptSerializer();
                while ((line = Console.ReadLine()) != null)
                {
                    var command = reader.Deserialize<System.Collections.Generic.Dictionary<string, object>>(line);
                    int id = command.ContainsKey("id") ? Convert.ToInt32(command["id"]) : 0;
                    string type = Convert.ToString(command["type"]);
                    if (type == "finish") dispatcher.Invoke((Action)delegate { lock (gate) { if (current != null && current.Id == id) { current.VoiceFinished = true; chord.Complete(); Finish(); } } });
                    else if (type == "insert") { string text = Convert.ToString(command["text"]); bool submit = command.ContainsKey("submit") && command["submit"] is bool && (bool)command["submit"]; work.Add(delegate { Insert(id, text, submit); }); }
                    else if (type == "preview") QueuePreview(id, Convert.ToString(command["text"]));
                    else if (type == "renderer-input") EnableRendererInput(id);
                    else if (type == "edited") CompleteRendererEdit(id, Convert.ToInt32(command["request"]), command.ContainsKey("applied") && command["applied"] is bool && (bool)command["applied"]);
                    else if (type == "cancel") dispatcher.BeginInvoke((Action)delegate { lock (gate) { if (current != null && current.Id == id) CancelFor("host"); } });
                    else if (type == "quit") break;
                }
            }
            catch { }
            finally { dispatcher.BeginInvoke((Action)delegate { Application.ExitThread(); }); }
        }) { IsBackground = true }.Start();
        System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 15 };
        timer.Tick += delegate {
            if (clock.ElapsedMilliseconds >= nextHookRefresh)
            {
                nextHookRefresh = clock.ElapsedMilliseconds + HookRefreshMs;
                InstallHooks();
            }
            chord.Tick(clock.ElapsedMilliseconds);
            physicalControls = chord.ControlMask; physicalShifts = chord.ShiftMask; physicalWindows = chord.WindowsMask;
            if (GetForegroundWindow() == IntPtr.Zero) {
                CancelFor("desktop"); chord.Reset(); physicalControls = physicalShifts = physicalWindows = 0;
            }
            lock (gate) { if (current != null && (current.Window != GetForegroundWindow() || current.Focus != Focus())) CancelFor("focus"); }
            lock (gate)
            {
                if (current != null && current.Started && !anchorQueued && clock.ElapsedMilliseconds - lastAnchorPoll >= 100)
                {
                    Session session = current; anchorQueued = true; lastAnchorPoll = clock.ElapsedMilliseconds;
                    work.Add(delegate { RefreshAnchor(session); });
                }
                if (current != null && current.PendingText != null && !Modifiers())
                {
                    int id = current.Id; string text = current.PendingText; bool submit = current.PendingSubmit;
                    current.PendingText = null;
                    work.Add(delegate { Insert(id, text, submit); });
                }
            }
        };
        timer.Start(); Emit(new { type = "ready" });
        try { Application.Run(); }
        finally { chord.Flush(); UnhookWindowsHookEx(keyboard); UnhookWindowsHookEx(mouse); timer.Dispose(); dispatcher.Dispose(); }
        return 0;
    }
}
