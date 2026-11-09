// Foreground metadata only: no screenshots, keystrokes, or accessibility text.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class ScreenTimeSampler
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInput input);
    [StructLayout(LayoutKind.Sequential)] private struct LastInput { public uint size; public uint tick; }

    private static int Main(string[] args)
    {
        int parentId;
        if (args.Length != 1 || !int.TryParse(args[0], out parentId)) return 2;
        Console.OutputEncoding = new UTF8Encoding(false);
        var json = new JavaScriptSerializer();
        try
        {
            using (var parent = Process.GetProcessById(parentId))
            {
                while (!parent.HasExited)
                {
                    try
                    {
                        var input = new LastInput { size = (uint)Marshal.SizeOf(typeof(LastInput)) };
                        var idle = GetLastInputInfo(ref input) ? unchecked((uint)Environment.TickCount - input.tick) / 1000 : 300;
                        var window = GetForegroundWindow();
                        uint pid;
                        GetWindowThreadProcessId(window, out pid);
                        var title = new StringBuilder(1024);
                        GetWindowText(window, title, title.Capacity);
                        using (var process = Process.GetProcessById((int)pid))
                        {
                            Console.WriteLine(json.Serialize(new { pid = pid, process = process.ProcessName, title = title.ToString(), idleSeconds = idle }));
                            Console.Out.Flush();
                        }
                    }
                    catch { Console.WriteLine("{\"idleSeconds\":300}"); Console.Out.Flush(); }
                    Thread.Sleep(2000);
                }
            }
        }
        catch (ArgumentException) { }
        catch (System.IO.IOException) { }
        return 0;
    }
}
