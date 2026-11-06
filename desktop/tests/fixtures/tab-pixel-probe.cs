using System;
using System.Diagnostics;
using System.Globalization;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;

// Test-only OS input and screen-pixel timing. No renderer state is accepted as
// evidence that a native view is visible or that its controls receive input.
class TabPixelProbe {
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool GdiFlush();
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr target,int x,int y,int w,int h,IntPtr source,int sx,int sy,uint op);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc,ref BitmapInfo info,uint usage,out IntPtr bits,IntPtr section,uint offset);
  [StructLayout(LayoutKind.Sequential)] struct BitmapInfo {
    public uint Size; public int Width, Height; public ushort Planes, BitCount;
    public uint Compression, SizeImage; public int XPels,YPels; public uint Used,Important;
  }
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int metric);
  [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public int X,Y; public uint Data,Flags,Time; public UIntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public uint Type; public Mouse Mouse; }
  static void Click(int x, int y) {
    var absoluteX=(int)((x-GetSystemMetrics(76)+0.5)*65536/GetSystemMetrics(78));
    var absoluteY=(int)((y-GetSystemMetrics(77)+0.5)*65536/GetSystemMetrics(79));
    var inputs=new Input[3];
    for(int i=0;i<3;i++) inputs[i].Mouse=new Mouse{X=absoluteX,Y=absoluteY,Flags=0xc001u | (i==1?2u:i==2?4u:0u)};
    if(SendInput(3,inputs,Marshal.SizeOf(typeof(Input)))!=3)throw new Exception("OS input injection failed");
  }
  class Capture : IDisposable {
    IntPtr source, target, bitmap, previous, bits; int x,y,width,height;
    public Capture(int ax,int ay,int bx,int by) {
      x=Math.Min(ax,bx);y=Math.Min(ay,by);width=Math.Abs(ax-bx)+1;height=Math.Abs(ay-by)+1;
      source=GetDC(IntPtr.Zero);target=CreateCompatibleDC(source);
      var info=new BitmapInfo {Size=40,Width=width,Height=-height,Planes=1,BitCount=32};
      bitmap=CreateDIBSection(source,ref info,0,out bits,IntPtr.Zero,0);previous=SelectObject(target,bitmap);
    }
    public void Read(){BitBlt(target,0,0,width,height,source,x,y,0x00cc0020);GdiFlush();}
    public uint Pixel(int px,int py){return (uint)Marshal.ReadInt32(bits,((py-y)*width+px-x)*4)&0xffffff;}
    public void Dispose(){SelectObject(target,previous);DeleteObject(bitmap);DeleteDC(target);ReleaseDC(IntPtr.Zero,source);}
  }
  static string Number(double n) { return n.ToString("F3", CultureInfo.InvariantCulture); }
  static void Main() {
    SetProcessDPIAware();
    string line;
    while ((line = Console.ReadLine()) != null) {
      var v = Array.ConvertAll(line.Split(','), int.Parse);
      var capture = new Capture(v[2],v[3],v[4],v[5]);
      // Initialize the screen-read pipeline before timing the user's input.
      // Capturer setup is measurement overhead, not part of a tab switch.
      capture.Read();
      var timer = Stopwatch.StartNew();
      double controls = -1, visible = -1, usable = -1;
      int unexpected = 0, samples = 0;
      var unexpectedColors = new HashSet<uint>();
      try {
        Click(v[0],v[1]);
        while (timer.ElapsedMilliseconds < 10000) {
          capture.Read();
          if (controls < 0 && capture.Pixel(v[2],v[3]) == 0xff00ff) controls = timer.Elapsed.TotalMilliseconds;
          uint body = capture.Pixel(v[4],v[5]); samples++;
          if (body == (uint)v[6]) { visible = timer.Elapsed.TotalMilliseconds; break; }
          if (body != (uint)v[7]) { unexpected++; unexpectedColors.Add(body); }
          Thread.Sleep(1);
        }
        if (visible >= 0) {
          Click(v[8],v[9]);
          while (timer.ElapsedMilliseconds < 10000) {
            capture.Read();
            if (controls < 0 && capture.Pixel(v[2],v[3]) == 0xff00ff) controls = timer.Elapsed.TotalMilliseconds;
            if (capture.Pixel(v[4],v[5]) == 0x102030) { usable = timer.Elapsed.TotalMilliseconds; break; }
            Thread.Sleep(1);
          }
        }
        var colors = new List<string>();
        foreach (var color in unexpectedColors) colors.Add("\"#" + color.ToString("x6") + "\"");
        Console.WriteLine("{\"controlsMs\":"+Number(controls)+",\"visibleMs\":"+Number(visible)+",\"usableMs\":"+Number(usable)+",\"unexpectedSamples\":"+unexpected+",\"unexpectedColors\":["+string.Join(",", colors)+"],\"samples\":"+samples+"}");
      } finally { capture.Dispose(); }
    }
  }
}
