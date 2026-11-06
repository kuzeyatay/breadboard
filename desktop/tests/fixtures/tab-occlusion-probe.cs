using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

// Probe the actual HWND and screen pixels: the DOM and capturePage() can both
// look healthy while the selected tab's Windows widget remains hidden.
class TabOcclusionProbe {
  [StructLayout(LayoutKind.Sequential)] struct PointPx { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct Rect { public int Left, Top, Right, Bottom; }
  delegate bool EnumWindow(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd, EnumWindow callback, IntPtr state);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(PointPx point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd, IntPtr dc);
  [DllImport("gdi32.dll")] static extern int GetPixel(IntPtr dc, int x, int y);
  const uint KeepBoundsAndFocus = 0x13;
  static readonly IntPtr Topmost = new IntPtr(-1);

  class Cover : Form { protected override bool ShowWithoutActivation { get { return true; } } }

  static IntPtr DocumentWidget(IntPtr window, Rect bounds) {
    IntPtr result = IntPtr.Zero;
    EnumChildWindows(window, (child, unused) => {
      var name = new StringBuilder(80);
      GetClassName(child, name, name.Capacity);
      Rect r;
      if (name.ToString() == "Chrome_RenderWidgetHostHWND" && IsWindowVisible(child) &&
          GetWindowRect(child, out r) && r.Top > bounds.Top + 15 &&
          r.Bottom - r.Top > (bounds.Bottom - bounds.Top) / 2) {
        result = child;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return result;
  }

  static void CheckPage(IntPtr window, PointPx point) {
    if (GetAncestor(WindowFromPoint(point), 2) != window) throw new Exception("Test window is still covered");
    var dc = GetDC(IntPtr.Zero);
    try {
      if (GetPixel(dc, point.X, point.Y) != 0xaa6f32) throw new Exception("Selected document pixels are missing");
    } finally { ReleaseDC(IntPtr.Zero, dc); }
  }

  [STAThread] static int Main(string[] args) {
    try {
      SetThreadDpiAwarenessContext(new IntPtr(-4));
      var window = new IntPtr(long.Parse(args[0]));
      Rect r;
      if (!GetWindowRect(window, out r)) throw new Exception("Missing test window");
      var center = new PointPx { X = (r.Left + r.Right) / 2, Y = (r.Top + r.Bottom) / 2 };
      SetWindowPos(window, Topmost, 0, 0, 0, 0, KeepBoundsAndFocus);
      Thread.Sleep(400);
      CheckPage(window, center);
      var widget = DocumentWidget(window, r);
      if (widget == IntPtr.Zero) throw new Exception("Missing visible document widget before cover");
      using (var cover = new Cover { Text = "Breadboard rendering test", StartPosition = FormStartPosition.Manual,
          Bounds = Rectangle.FromLTRB(r.Left - 16, r.Top - 16, r.Right + 16, r.Bottom + 16) }) {
        cover.Show();
        SetWindowPos(cover.Handle, Topmost, r.Left - 16, r.Top - 16, r.Right - r.Left + 32, r.Bottom - r.Top + 32, 0x10);
        SetWindowPos(window, cover.Handle, 0, 0, 0, 0, KeepBoundsAndFocus);
        cover.Refresh();
        Application.DoEvents();
        Thread.Sleep(800);
        if (GetAncestor(WindowFromPoint(center), 2) != cover.Handle) throw new Exception("Test cover did not overlap");
        if (!IsWindowVisible(widget)) throw new Exception("Covering the window hid the selected tab's HWND");
        cover.Hide();
        Thread.Sleep(300);
        CheckPage(window, center);
        if (!IsWindowVisible(widget)) throw new Exception("Document widget stayed hidden after uncover");
      }
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
  }
}
