using System;
using System.Runtime.InteropServices;

// Read-only Windows routing probe. Unlike webContents.sendInputEvent, this
// asks the window whether a point belongs to its caption or its page.
class NativeHitTest {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  static int Main(string[] args) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var window = new IntPtr(long.Parse(args[0]));
    double scale = GetDpiForWindow(window) / 96.0;
    var point = new Point { X = (int)Math.Round(double.Parse(args[1]) * scale), Y = (int)Math.Round(double.Parse(args[2]) * scale) };
    if (!ClientToScreen(window, ref point)) return 1;
    IntPtr result;
    if (SendMessageTimeout(window, 0x84, IntPtr.Zero, new IntPtr((point.Y << 16) | (point.X & 0xffff)), 2, 2000, out result) == IntPtr.Zero) return 2;
    Console.WriteLine(result.ToInt64());
    return 0;
  }
}
