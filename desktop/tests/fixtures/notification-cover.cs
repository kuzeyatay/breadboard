// A separate, temporary app for physical occlusion tests. Never sends input.
using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
static class NotificationCover {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int X, Y; public uint Data, Flags, Time; public UIntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public MouseInput Mouse; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, uint attr, out uint value, int size);
    static Input Mouse(Point point, uint flags) {
        int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
        int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
        if (width < 2 || height < 2) throw new InvalidOperationException("No interactive desktop");
        return new Input { Type = 0, Mouse = new MouseInput {
            X = (int)Math.Round((point.X-left)*65535.0/(width-1)), Y = (int)Math.Round((point.Y-top)*65535.0/(height-1)),
            Flags = 0x8000 | 0x4000 | 1 | flags,
        }};
    }
    static void FocusOwnedWindow(IntPtr hwnd, uint expectedPid) {
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        if (pid != expectedPid || !IsWindowVisible(hwnd) || IsIconic(hwnd)) throw new InvalidOperationException("Not an owned visible fixture window");
        Rect rect; Point original;
        if (!GetWindowRect(hwnd, out rect) || !GetCursorPos(out original)) throw new InvalidOperationException("Cannot establish fixture coordinates");
        var point = new Point { X = (rect.Left+rect.Right)/2, Y = (rect.Top+rect.Bottom)/2 };
        // A real click establishes foreground permission. Never click through
        // another window or act while the person is holding a modifier/button.
        if (GetAncestor(WindowFromPoint(point), 2) != hwnd) throw new InvalidOperationException("Owned fixture click point is covered");
        foreach (int key in new int[] { 1, 2, 4, 5, 6, 0x10, 0x11, 0x12, 0x5B, 0x5C })
            if ((GetAsyncKeyState(key) & 0x8000) != 0) throw new InvalidOperationException("Input is currently held");
        var inputs = new Input[] { Mouse(point, 2), Mouse(point, 4), Mouse(original, 0) };
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != inputs.Length) {
            // Release a possibly inserted down event and restore the pointer.
            var release = new Input[] { Mouse(point, 4), Mouse(original, 0) };
            SendInput((uint)release.Length, release, Marshal.SizeOf(typeof(Input)));
            throw new InvalidOperationException("Windows blocked the owned-window input");
        }
    }
    [STAThread] static void Main(string[] args) {
        SetProcessDpiAwarenessContext(new IntPtr(-4));
        if (args.Length == 3 && args[0] == "focus-owned") {
            FocusOwnedWindow(new IntPtr(Int64.Parse(args[1])), UInt32.Parse(args[2])); Console.WriteLine("input-sent"); return;
        }
        if (args.Length > 1 && args[0] == "window-state") {
            var hwnd = new IntPtr(Int64.Parse(args[1])); uint cloak;
            var error = DwmGetWindowAttribute(hwnd, 14, out cloak, 4);
            Console.WriteLine("visible="+IsWindowVisible(hwnd)+" iconic="+IsIconic(hwnd)+" cloak="+cloak+" error="+error+" root="+GetAncestor(hwnd,2)+" foreground="+GetForegroundWindow());return;
        }
        if (args.Length > 1 && args[0] == "stats") {
            foreach (var process in Process.GetProcessesByName("windows-visible-region")) {
                try { if (String.Equals(process.MainModule.FileName, Path.GetFullPath(args[1]), StringComparison.OrdinalIgnoreCase)) {
                    Console.WriteLine("{\"pid\":"+process.Id+",\"cpuMs\":"+process.TotalProcessorTime.TotalMilliseconds.ToString(System.Globalization.CultureInfo.InvariantCulture)+",\"workingSet\":"+process.WorkingSet64+",\"privateBytes\":"+process.PrivateMemorySize64+"}"); return;
                } } finally { process.Dispose(); }
            }
            Console.WriteLine("null"); return;
        }
        if (args.Length > 0 && args[0] == "foreground") { Console.WriteLine(GetForegroundWindow().ToInt64()); return; }
        if (args.Length > 1 && args[0] == "restore") {
            var target = new IntPtr(Int64.Parse(args[1])); SetForegroundWindow(target);
            for (int i = 0; i < 20 && GetForegroundWindow() != target; i++) Thread.Sleep(50);
            Console.WriteLine(GetForegroundWindow() == target ? "restored" : "unrestored"); return;
        }
        var initial = args.Length == 4 ? Array.ConvertAll(args, Int32.Parse) : new int[] { -10000, -10000, 100, 100 };
        var form = new Form { Text = "Notification verification — temporary app", FormBorderStyle = FormBorderStyle.None,
            StartPosition = FormStartPosition.Manual, Bounds = new Rectangle(initial[0], initial[1], initial[2], initial[3]),
            BackColor = Color.DarkSlateBlue, ShowInTaskbar = false };
        form.Shown += delegate {
            var reader = new Thread(delegate() {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    var input = line;
                    form.Invoke((MethodInvoker)delegate {
                        if (input == "close") { form.Close(); return; }
                        var p = Array.ConvertAll(input.Split(','), Int32.Parse);
                        SetWindowPos(form.Handle, new IntPtr(-1), p[0], p[1], p[2], p[3], 0x40);
                        SetForegroundWindow(form.Handle);
                        if (GetForegroundWindow() != form.Handle) {
                            try { FocusOwnedWindow(form.Handle, (uint)Process.GetCurrentProcess().Id); }
                            catch (Exception error) { Console.WriteLine("focus-setup-failed: "+error.Message); return; }
                        }
                        // Foreground activation crosses input queues. Let both
                        // UI threads process the handoff before asserting it.
                        // https://devblogs.microsoft.com/oldnewthing/20161118-00/?p=94745
                        var timer = new System.Windows.Forms.Timer { Interval = 50 };
                        int ticks = 0;
                        timer.Tick += delegate {
                            if (GetForegroundWindow() != form.Handle && ++ticks < 20) return;
                            timer.Stop(); timer.Dispose();
                            Console.WriteLine(GetForegroundWindow() == form.Handle ? "focused" :
                                "unfocused visible="+IsWindowVisible(form.Handle)+" actual="+GetForegroundWindow()+" expected="+form.Handle);
                        };
                        timer.Start();
                    });
                }
                if (!form.IsDisposed) form.BeginInvoke((MethodInvoker)delegate { form.Close(); });
            });
            reader.IsBackground = true; reader.Start();
            Console.WriteLine("ready");
        };
        Application.Run(form);
    }
}
