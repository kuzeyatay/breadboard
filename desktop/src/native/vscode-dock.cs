// A separate process owns the Win32 docking state. EOF restores the editor even
// when the Electron side forgets to dispose a session. Never terminates VS Code.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class CodeDock {
    delegate bool EnumProc(IntPtr hwnd, IntPtr data);
    delegate void WinEventProc(IntPtr hook, uint kind, IntPtr hwnd, int objectId, int childId, uint thread, uint time);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct GUITHREADINFO {
        public uint Size, Flags;
        public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
        public RECT CaretRect;
    }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread, ref GUITHREADINFO info);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr SetParent(IntPtr hwnd, IntPtr parent);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetLong64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)] static extern IntPtr SetLong64(IntPtr hwnd, int index, IntPtr value);
    [DllImport("user32.dll", EntryPoint="SetWindowLongW", SetLastError=true)] static extern int SetLong32(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError=true)] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint process);
    [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint first, uint last, IntPtr module, WinEventProc callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] static extern void SetLastError(uint code);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    const long CHILD = 0x40000000L, POPUP = 0x80000000L, CAPTION = 0x00C00000L, THICKFRAME = 0x00040000L;
    const uint NOACTIVATE = 0x10, FRAMECHANGED = 0x20, NOZORDER = 0x4;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    static readonly ConcurrentQueue<string> Inbox = new ConcurrentQueue<string>();
    static readonly HashSet<long> Before = new HashSet<long>();
    static volatile bool Eof;
    static IntPtr Editor, Parent, OriginalParent;
    static long OriginalStyle, OriginalExStyle;
    static RECT OriginalRect;
    static bool OriginalMaximized, Visible, LastVisible, Active;
    static int OwnerPid, X, Y, Width = 800, Height = 600;
    static string Executable, Marker;
    static int PendingId;
    static DateTime Deadline;
    static IntPtr FocusHook, ShowHook;
    // New Code windows are hidden the moment they appear and shown only once
    // docked, so the editor never flashes on the desktop while it loads.
    static readonly HashSet<IntPtr> Hidden = new HashSet<IntPtr>();
    static readonly WinEventProc OnShow = delegate(IntPtr hook, uint kind, IntPtr hwnd, int objectId, int childId, uint thread, uint time) {
        if (objectId == 0 && childId == 0) Consider(hwnd);
    };
    // Returns true for a pending-launch candidate (a new top-level window of the
    // launched executable), hiding it until it is docked or released.
    static bool Consider(IntPtr hwnd) {
        if (PendingId == 0 || Before.Contains(hwnd.ToInt64())) return false;
        if (Hidden.Contains(hwnd)) { if (IsWindowVisible(hwnd)) ShowWindow(hwnd, 0); return true; }
        if (!IsWindowVisible(hwnd) || GetParent(hwnd) != IntPtr.Zero) return false;
        var name = new StringBuilder(64); GetClassName(hwnd, name, name.Capacity);
        if (name.ToString() != "Chrome_WidgetWin_1" || !String.Equals(ProcessPath(hwnd), Executable, StringComparison.OrdinalIgnoreCase)) { Before.Add(hwnd.ToInt64()); return false; }
        ShowWindow(hwnd, 0); Hidden.Add(hwnd);
        return true;
    }
    static void RevealHidden() {
        if (ShowHook != IntPtr.Zero) { UnhookWinEvent(ShowHook); ShowHook = IntPtr.Zero; }
        foreach (IntPtr hwnd in Hidden) if (IsWindow(hwnd)) ShowWindow(hwnd, 8);
        Hidden.Clear();
    }
    // Keep the delegate alive for the lifetime of the out-of-context hook.
    static readonly WinEventProc OnFocus = delegate(IntPtr hook, uint kind, IntPtr hwnd, int objectId, int childId, uint thread, uint time) {
        // Activating the outer Electron HWND otherwise leaves keys at its empty
        // backing window. Never take focus away from tab-strip/search controls
        // or another application: only redirect focus on the parent HWND itself.
        if (hwnd != Parent || !Visible || !Active || Editor == IntPtr.Zero || GetForegroundWindow() != Parent) return;
        var info = new GUITHREADINFO { Size = (uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
        if (GetGUIThreadInfo(thread, ref info) && info.Focus == Parent) FocusEditor();
    };
    static long ReadStyle(IntPtr hwnd, int index) { return IntPtr.Size == 8 ? GetLong64(hwnd, index).ToInt64() : (long)(uint)GetLong32(hwnd, index); }
    static void WriteStyle(IntPtr hwnd, int index, long value) { if (IntPtr.Size == 8) SetLong64(hwnd, index, new IntPtr(value)); else SetLong32(hwnd, index, unchecked((int)value)); }
    static string Str(Dictionary<string, object> cmd, string name) { object value; return cmd.TryGetValue(name, out value) ? Convert.ToString(value) : ""; }
    static int Num(Dictionary<string, object> cmd, string name) { return Convert.ToInt32(cmd[name]); }
    static void Emit(object value) { Console.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
    static void Reply(int id, object result) { Emit(new { id = id, ok = true, result = result }); }
    static string ProcessPath(IntPtr hwnd) {
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return "";
        try { int size = 32768; var name = new StringBuilder(size); return QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString() : ""; }
        finally { CloseHandle(process); }
    }
    static void ValidateParent(IntPtr hwnd) {
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        if (!IsWindow(hwnd) || pid != (uint)OwnerPid) throw new Exception("The Breadboard window is no longer available.");
    }
    static void Attach(IntPtr hwnd) {
        ValidateParent(Parent);
        Editor = hwnd;
        OriginalParent = GetParent(hwnd);
        OriginalStyle = ReadStyle(hwnd, -16); OriginalExStyle = ReadStyle(hwnd, -20);
        OriginalMaximized = IsZoomed(hwnd);
        // Restoring here would show the hidden window on the desktop; Layout
        // un-zooms it once it is a child of Breadboard instead.
        GetWindowRect(hwnd, out OriginalRect);
        // Breadboard supplies the outer frame. VS Code's native-titlebar mode
        // keeps its menus and workbench but omits its custom app-icon control.
        WriteStyle(hwnd, -16, (OriginalStyle & ~(POPUP | CAPTION | THICKFRAME)) | CHILD);
        SetLastError(0);
        IntPtr previous = SetParent(hwnd, Parent);
        int error = Marshal.GetLastWin32Error();
        if (previous == IntPtr.Zero && error != 0) { Restore(); throw new Exception("Windows could not dock VS Code (" + error + ")."); }
        LastVisible = !Visible;
        Layout(true);
    }
    static void Layout(bool force) {
        if (Editor == IntPtr.Zero || !IsWindow(Editor)) return;
        ValidateParent(Parent);
        if (Visible && IsZoomed(Editor)) ShowWindow(Editor, 9);
        double scale = GetDpiForWindow(Parent) / 96.0;
        RECT client; GetClientRect(Parent, out client);
        int x = Math.Max(0, (int)Math.Round(X * scale)), y = Math.Max(0, (int)Math.Round(Y * scale));
        int w = Math.Max(1, Math.Min((int)Math.Round(Width * scale), client.Right - x));
        int h = Math.Max(1, Math.Min((int)Math.Round(Height * scale), client.Bottom - y));
        if (force) SetWindowPos(Editor, IntPtr.Zero, x, y, w, h, NOACTIVATE | FRAMECHANGED);
        if (LastVisible != Visible) {
            ShowWindow(Editor, Visible ? 4 : 0);
            LastVisible = Visible;
        }
    }
    static void FocusEditor() {
        if (!Visible || Editor == IntPtr.Zero || !IsWindow(Editor)) return;
        IntPtr target = Editor;
        EnumChildWindows(Editor, delegate(IntPtr hwnd, IntPtr unused) {
            var name = new StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
            if (name.ToString() == "Chrome_RenderWidgetHostHWND" && IsWindowVisible(hwnd)) target = hwnd;
            return true;
        }, IntPtr.Zero);
        uint pid; uint thread = GetWindowThreadProcessId(target, out pid), current = GetCurrentThreadId();
        bool linked = thread != current && AttachThreadInput(current, thread, true);
        try { SetFocus(target); } finally { if (linked) AttachThreadInput(current, thread, false); }
    }
    static void Restore() {
        RevealHidden();
        IntPtr hwnd = Editor;
        if (hwnd == IntPtr.Zero) return;
        if (!IsWindow(hwnd)) { Editor = IntPtr.Zero; return; }
        ShowWindow(hwnd, 0);
        SetLastError(0);
        IntPtr previous = SetParent(hwnd, IsWindow(OriginalParent) ? OriginalParent : IntPtr.Zero);
        int error = Marshal.GetLastWin32Error();
        if (previous == IntPtr.Zero && error != 0) { ShowWindow(hwnd, 4); throw new Exception("Windows could not release VS Code (" + error + ")."); }
        Editor = IntPtr.Zero;
        WriteStyle(hwnd, -16, OriginalStyle); WriteStyle(hwnd, -20, OriginalExStyle);
        SetWindowPos(hwnd, IntPtr.Zero, OriginalRect.Left, OriginalRect.Top,
            Math.Max(400, OriginalRect.Right - OriginalRect.Left), Math.Max(300, OriginalRect.Bottom - OriginalRect.Top), NOACTIVATE | FRAMECHANGED | NOZORDER);
        ShowWindow(hwnd, OriginalMaximized ? 3 : 4);
    }
    static void Dispatch(string line) {
        int id = 0;
        try {
            var cmd = Json.Deserialize<Dictionary<string, object>>(line);
            id = Num(cmd, "id"); string op = Str(cmd, "op");
            if (op == "prepare") {
                OwnerPid = Num(cmd, "ownerPid"); Parent = new IntPtr(long.Parse(Str(cmd, "parent")));
                ValidateParent(Parent);
                if (FocusHook == IntPtr.Zero) FocusHook = SetWinEventHook(0x8005, 0x8005, IntPtr.Zero, OnFocus, (uint)OwnerPid, 0, 0);
                Executable = Path.GetFullPath(Str(cmd, "executable")); Marker = Str(cmd, "marker");
                if (Marker.Length < 12 || !File.Exists(Executable)) throw new Exception("Invalid VS Code launch.");
                Before.Clear(); EnumWindows(delegate(IntPtr hwnd, IntPtr unused) { Before.Add(hwnd.ToInt64()); return true; }, IntPtr.Zero);
                Reply(id, new { prepared = true });
            } else if (op == "attach") {
                if (PendingId != 0 || Editor != IntPtr.Zero || String.IsNullOrEmpty(Marker)) throw new Exception("A VS Code window is already attached or pending.");
                // First launch of the verified ZIP can take over a minute while
                // Windows scans its files and VS Code creates its fresh profile.
                PendingId = id; Deadline = DateTime.UtcNow.AddSeconds(120);
                if (ShowHook == IntPtr.Zero) ShowHook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, OnShow, 0, 0, 2);
            } else if (op == "layout") {
                IntPtr parent = new IntPtr(long.Parse(Str(cmd, "parent"))); ValidateParent(parent);
                if (parent != Parent && Editor != IntPtr.Zero) {
                    SetLastError(0); IntPtr old = SetParent(Editor, parent); int error = Marshal.GetLastWin32Error();
                    if (old == IntPtr.Zero && error != 0) throw new Exception("Windows could not move the Code tab.");
                }
                Parent = parent; X = Num(cmd, "x"); Y = Num(cmd, "y"); Width = Num(cmd, "width"); Height = Num(cmd, "height");
                Visible = Convert.ToBoolean(cmd["visible"]);
                Active = !cmd.ContainsKey("active") || Convert.ToBoolean(cmd["active"]);
                Layout(true);
                if (cmd.ContainsKey("focus") && Convert.ToBoolean(cmd["focus"])) FocusEditor();
                Reply(id, new { visible = Visible });
            } else if (op == "inspect") {
                RECT rect = new RECT(); if (Editor != IntPtr.Zero) GetWindowRect(Editor, out rect);
                uint pid, thread = Editor != IntPtr.Zero ? GetWindowThreadProcessId(Editor, out pid) : 0;
                var info = new GUITHREADINFO { Size = (uint)Marshal.SizeOf(typeof(GUITHREADINFO)) };
                bool hasFocusInfo = thread != 0 && GetGUIThreadInfo(thread, ref info);
                Reply(id, new { hwnd = Editor.ToInt64().ToString(), parent = GetParent(Editor).ToInt64().ToString(), visible = Editor != IntPtr.Zero && IsWindowVisible(Editor), x = rect.Left, y = rect.Top, width = rect.Right - rect.Left, height = rect.Bottom - rect.Top,
                    foreground = GetForegroundWindow().ToInt64().ToString(), active = hasFocusInfo ? info.Active.ToInt64().ToString() : "0", focus = hasFocusInfo ? info.Focus.ToInt64().ToString() : "0", dpi = Editor != IntPtr.Zero ? GetDpiForWindow(Editor) : 0 });
            } else if (op == "detach") {
                PendingId = 0; Restore(); Reply(id, new { detached = true });
            } else if (op == "exit") {
                // Closing the Code tab closes its editor the polite way (WM_CLOSE,
                // like clicking X): VS Code still asks about unsaved files.
                // Without it the editor popped out as a stray standalone window.
                IntPtr editor = Editor;
                bool closeEditor = cmd.ContainsKey("closeEditor") && Convert.ToBoolean(cmd["closeEditor"]);
                PendingId = 0; Restore();
                if (closeEditor && editor != IntPtr.Zero && IsWindow(editor)) PostMessage(editor, 0x0010, IntPtr.Zero, IntPtr.Zero);
                Reply(id, new { detached = true }); Application.Exit();
            } else throw new Exception("Unknown docking action.");
        } catch (Exception error) { Emit(new { id = id, ok = false, error = error.Message }); }
    }
    static void Tick() {
        string line;
        while (Inbox.TryDequeue(out line)) Dispatch(line);
        if (Eof) { Restore(); Application.Exit(); return; }
        if (Editor != IntPtr.Zero && !IsWindow(Editor)) { Editor = IntPtr.Zero; Emit(new { type = "closed" }); }
        if (Editor != IntPtr.Zero && !IsWindow(Parent)) { Restore(); Application.Exit(); return; }
        if (Editor != IntPtr.Zero && Visible && (IsZoomed(Editor) || IsIconic(Editor))) { ShowWindow(Editor, 9); Layout(true); }
        if (PendingId == 0) return;
        IntPtr match = IntPtr.Zero;
        // The show hook hides candidates instantly; this sweep catches any it
        // missed. The marker title appears once the workbench has loaded.
        EnumWindows(delegate(IntPtr hwnd, IntPtr unused) {
            if (!Consider(hwnd)) return true;
            var title = new StringBuilder(4096); GetWindowText(hwnd, title, title.Capacity);
            if (title.ToString().IndexOf(Marker, StringComparison.Ordinal) < 0) return true;
            match = hwnd; return false;
        }, IntPtr.Zero);
        if (match == IntPtr.Zero && DateTime.UtcNow < Deadline) return;
        int id = PendingId; PendingId = 0;
        Hidden.Remove(match); RevealHidden();
        try {
            if (match == IntPtr.Zero) throw new Exception("VS Code did not open its dedicated window in time. Any window that opened remains available on the desktop.");
            Attach(match); Reply(id, new { hwnd = match.ToInt64().ToString() });
        } catch (Exception error) { Restore(); Emit(new { id = id, ok = false, error = error.Message }); }
    }
    [STAThread] static int Main() {
        try {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
            Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
            var reader = new Thread(delegate() { try { string line; while ((line = Console.ReadLine()) != null) Inbox.Enqueue(line); } finally { Eof = true; } });
            reader.IsBackground = true; reader.Start();
            var timer = new System.Windows.Forms.Timer { Interval = 50 };
            timer.Tick += delegate { try { Tick(); } catch (Exception error) { Restore(); Emit(new { type = "error", error = error.Message }); Application.Exit(); } };
            timer.Start(); Application.Run(); return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
        finally { if (FocusHook != IntPtr.Zero) UnhookWinEvent(FocusHook); Restore(); }
    }
}
