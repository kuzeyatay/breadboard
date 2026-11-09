using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

// Read actual Windows input surfaces, including HWNDs that extend outside a
// parent Electron View. DOM geometry and View.getBounds() cannot detect those.
class NativeRendererBounds {
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  delegate bool EnumWindow(IntPtr window, IntPtr state);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr window, EnumWindow callback, IntPtr state);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
  static void Main(string[] args) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var root = new IntPtr(long.Parse(args[0]));
    var origin = new Point();
    if (!ClientToScreen(root, ref origin)) throw new Exception("Missing fixture window");
    double scale = GetDpiForWindow(root) / 96.0;
    var bounds = new List<string>();
    EnumChildWindows(root, (window, unused) => {
      var name = new StringBuilder(120);
      GetClassName(window, name, name.Capacity);
      Rect r;
      if (name.ToString() == "Chrome_RenderWidgetHostHWND" && IsWindowVisible(window) && GetWindowRect(window, out r)) {
        bounds.Add(string.Format(CultureInfo.InvariantCulture,
          "{{\"x\":{0},\"y\":{1},\"width\":{2},\"height\":{3}}}",
          (r.Left - origin.X) / scale, (r.Top - origin.Y) / scale, (r.Right - r.Left) / scale, (r.Bottom - r.Top) / scale));
      }
      return true;
    }, IntPtr.Zero);
    Console.WriteLine("[" + string.Join(",", bounds) + "]");
  }
}
