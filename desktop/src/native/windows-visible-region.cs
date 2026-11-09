// Reports only the uncovered pixels of registered Breadboard windows. No input,
// screenshots, window titles or content are collected. All coordinates are physical.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class WindowsVisibleRegion {
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    delegate bool MonitorProc(IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data);
    delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);
    [StructLayout(LayoutKind.Sequential)] struct Msg { public IntPtr HWnd; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Pt; public uint Private; }
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hwnd, ref Point point);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
    [DllImport("user32.dll")] static extern bool GetLayeredWindowAttributes(IntPtr hwnd, out uint color, out byte alpha, out uint flags);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorProc callback, IntPtr data);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attr, out Rect value, int size);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attr, out uint value, int size);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
    [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr dest, IntPtr a, IntPtr b, int mode);
    [DllImport("gdi32.dll")] static extern int OffsetRgn(IntPtr region, int x, int y);
    [DllImport("gdi32.dll")] static extern uint GetRegionData(IntPtr region, uint size, IntPtr data);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] static extern IntPtr GetThreadDesktop(uint thread);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetUserObjectInformation(IntPtr obj, int index, StringBuilder value, uint size, out uint needed);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern int GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
    static readonly object Gate = new object();
    static readonly AutoResetEvent Wake = new AutoResetEvent(false);
    static string[] Handles = new string[0];
    static volatile bool Running = true;
    static readonly WinEventProc OnEvent = delegate(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time) {
        if (ev < 0x8000 || obj == 0) Wake.Set();
    };

    static bool SameDesktop() {
        IntPtr input = OpenInputDesktop(0, false, 1);
        if (input == IntPtr.Zero) return false;
        try {
            var a = new StringBuilder(256); var b = new StringBuilder(256); uint needed;
            return GetUserObjectInformation(input, 2, a, 512, out needed) &&
                GetUserObjectInformation(GetThreadDesktop(GetCurrentThreadId()), 2, b, 512, out needed) && a.ToString() == b.ToString();
        } finally { CloseDesktop(input); }
    }
    static bool Drawn(IntPtr hwnd) {
        uint cloaked, color, flags; byte alpha;
        return IsWindowVisible(hwnd) && !IsIconic(hwnd) &&
            (DwmGetWindowAttribute(hwnd, 14, out cloaked, 4) != 0 || cloaked == 0) &&
            !(GetLayeredWindowAttributes(hwnd, out color, out alpha, out flags) && (flags & 2) != 0 && alpha == 0);
    }
    static IntPtr WindowRegion(IntPtr hwnd) {
        Rect outer, drawn;
        if (!GetWindowRect(hwnd, out outer)) return IntPtr.Zero;
        if (DwmGetWindowAttribute(hwnd, 9, out drawn, 16) != 0) drawn = outer;
        var region = CreateRectRgn(drawn.Left, drawn.Top, drawn.Right, drawn.Bottom);
        var shape = CreateRectRgn(0, 0, 0, 0);
        try {
            if (GetWindowRgn(hwnd, shape) != 0) {
                OffsetRgn(shape, outer.Left, outer.Top);
                CombineRgn(region, region, shape, 1); // AND
            }
        } finally { DeleteObject(shape); }
        return region;
    }
    static string Visible(IntPtr hwnd, IntPtr monitors) {
        if (!Drawn(hwnd)) return "[]";
        Rect client; var origin = new Point();
        if (!GetClientRect(hwnd, out client) || !ClientToScreen(hwnd, ref origin)) return "[]";
        var region = CreateRectRgn(origin.X, origin.Y, origin.X + client.Right, origin.Y + client.Bottom);
        try {
            CombineRgn(region, region, monitors, 1);
            var own = WindowRegion(hwnd);
            if (own == IntPtr.Zero) return "[]";
            try { CombineRgn(region, region, own, 1); } finally { DeleteObject(own); }
            // Walk the actual Z order above this HWND; bound it against a window
            // being destroyed/reordered during enumeration (GetWindow warning).
            var visited = new HashSet<IntPtr>();
            var above = GetWindow(hwnd, 3); // GW_HWNDPREV
            while (above != IntPtr.Zero) {
                if (!visited.Add(above) || visited.Count > 4096) return "[]";
                if (Drawn(above)) {
                    var cover = WindowRegion(above);
                    if (cover != IntPtr.Zero) {
                        int result;
                        try { result = CombineRgn(region, region, cover, 4); } // DIFF
                        finally { DeleteObject(cover); }
                        if (result <= 1) return "[]";
                    }
                }
                above = GetWindow(above, 3);
            }
            uint size = GetRegionData(region, 0, IntPtr.Zero);
            if (size < 32 || size > 32 + 4096 * 16) return "[]";
            var data = Marshal.AllocHGlobal((int)size);
            try {
                if (GetRegionData(region, size, data) != size) return "[]";
                int count = Marshal.ReadInt32(data, 8);
                if (count < 0 || count > 4096 || 32 + count * 16 > size) return "[]";
                var json = new StringBuilder("[");
                for (int i = 0; i < count; i++) {
                    int offset = 32 + i * 16;
                    int l = Marshal.ReadInt32(data, offset), t = Marshal.ReadInt32(data, offset + 4);
                    int r = Marshal.ReadInt32(data, offset + 8), b = Marshal.ReadInt32(data, offset + 12);
                    if (i > 0) json.Append(',');
                    json.Append("{\"x\":").Append(l).Append(",\"y\":").Append(t).Append(",\"width\":").Append(r-l).Append(",\"height\":").Append(b-t).Append('}');
                }
                return json.Append(']').ToString();
            } finally { Marshal.FreeHGlobal(data); }
        } finally { DeleteObject(region); }
    }
    public static void Main() {
        try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); }
        catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
        var input = new Thread(delegate() {
            string line;
            while ((line = Console.ReadLine()) != null) {
                if (line.Length > 4096) continue;
                var valid = new List<string>();
                foreach (string item in line.Split(',')) { long handle; if (Int64.TryParse(item, out handle) && handle > 0 && valid.Count < 128) valid.Add(handle.ToString()); }
                lock (Gate) Handles = valid.ToArray();
                Wake.Set();
            }
            Running = false; Wake.Set();
        });
        input.IsBackground = true; input.Start();
        var hooks = new Thread(delegate() {
            SetWinEventHook(3, 3, IntPtr.Zero, OnEvent, 0, 0, 0); // foreground
            SetWinEventHook(0x16, 0x17, IntPtr.Zero, OnEvent, 0, 0, 0); // minimize
            SetWinEventHook(0x8002, 0x800B, IntPtr.Zero, OnEvent, 0, 0, 0); // show/hide/move
            Msg msg; while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { }
        });
        hooks.IsBackground = true; hooks.Start();
        while (Running) {
            string[] handles; lock (Gate) handles = Handles;
            var monitors = CreateRectRgn(0, 0, 0, 0);
            try {
                MonitorProc collect = delegate(IntPtr monitor, IntPtr dc, ref Rect rect, IntPtr data) {
                    var r = CreateRectRgn(rect.Left, rect.Top, rect.Right, rect.Bottom);
                    try { CombineRgn(monitors, monitors, r, 2); } finally { DeleteObject(r); }
                    return true;
                };
                bool desktop = SameDesktop() && EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, collect, IntPtr.Zero);
                var json = new StringBuilder("{");
                for (int i = 0; i < handles.Length; i++) {
                    if (i > 0) json.Append(',');
                    json.Append('"').Append(handles[i]).Append("\":");
                    try { json.Append(desktop ? Visible(new IntPtr(Int64.Parse(handles[i])), monitors) : "[]"); }
                    catch { json.Append("[]"); }
                }
                Console.WriteLine(json.Append('}').ToString());
            } finally { DeleteObject(monitors); }
            // Event-triggered updates, plus a heartbeat for secure-desktop and
            // display changes. Limit event storms without holding up the UI.
            Thread.Sleep(20); Wake.WaitOne(80);
        }
    }
}
