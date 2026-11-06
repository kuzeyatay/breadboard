using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// Run the real helper message loop, with passive hooks that cannot consume
// the user's keys. Revoke its real Windows registrations as a timeout would.
internal static class DictationHookRecovery
{
    private const BindingFlags Static = BindingFlags.NonPublic | BindingFlags.Static;
    private const BindingFlags Instance = BindingFlags.NonPublic | BindingFlags.Instance;
    private static Type helper;
    private static Exception failure;
    private static bool completed;
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    private static IntPtr PassiveHook(int code, IntPtr message, IntPtr data) { return CallNextHookEx(IntPtr.Zero, code, message, data); }
    private static object Call(string name, params object[] args) { return helper.GetMethod(name, Static).Invoke(null, args); }
    private static object Field(string name) { return helper.GetField(name, Static).GetValue(null); }
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    [STAThread] private static int Main(string[] args)
    {
        helper = Assembly.LoadFrom(args[0]).GetType("BreadboardDictation");
        foreach (string name in new[] { "keyboardHook", "mouseHook" })
        {
            FieldInfo field = helper.GetField(name, Static);
            field.SetValue(null, Delegate.CreateDelegate(field.FieldType, typeof(DictationHookRecovery).GetMethod("PassiveHook", Static)));
        }
        new Thread(delegate() {
            Control dispatcher = null;
            try
            {
                for (int i = 0; i < 100 && dispatcher == null; i++) { Thread.Sleep(20); dispatcher = Field("dispatcher") as Control; }
                Check(dispatcher != null, "helper did not start");
                IntPtr removedKeyboard = IntPtr.Zero, removedMouse = IntPtr.Zero;
                dispatcher.Invoke((Action)delegate {
                    object chord = Field("chord"); Type chordType = chord.GetType();
                    var down = (System.Collections.Generic.HashSet<int>)chordType.GetField("down", Instance).GetValue(chord);
                    down.Add(0x5B);
                    Check((bool)Call("InstallHooks"), "healthy hooks could not renew");
                    Check(down.Contains(0x5B), "routine renewal changed a held Windows key");
                    chordType.GetMethod("Reset", Instance).Invoke(chord, null);
                    // A live hook can miss a key-up too. Exercise the actual
                    // GetAsyncKeyState wiring without injecting any user input.
                    var isKeyDown = (Func<int, bool>)chordType.GetField("IsKeyDown", Instance).GetValue(chord);
                    Check(isKeyDown != null && !isKeyDown(0x87), "F24 must be released for the stale-key check");
                    down.Add(0x87);
                    FieldInfo start = chordType.GetField("Start", Instance); object realStart = start.GetValue(chord);
                    FieldInfo release = chordType.GetField("ReleaseModifiers", Instance); object realRelease = release.GetValue(chord);
                    int releases = 0; release.SetValue(chord, (Action)delegate { releases++; });
                    int starts = 0; start.SetValue(chord, (Action)delegate { starts++; });
                    try
                    {
                        Type keyType = chordType.GetNestedType("Key", BindingFlags.NonPublic);
                        foreach (int code in new[] { 0xA2, 0xA0 }) {
                            object key = Activator.CreateInstance(keyType, Instance, null, new object[] { code, false }, null);
                            chordType.GetMethod("Handle", Instance).Invoke(chord, new object[] { key, 100L, false });
                        }
                        chordType.GetMethod("Tick", Instance).Invoke(chord, new object[] { 300L });
                        Check(starts == 1 && !down.Contains(0x87), "a missed ordinary key-up blocked a fresh hold with healthy hooks");
                    }
                    finally { chordType.GetMethod("Reset", Instance).Invoke(chord, null); start.SetValue(chord, realStart); release.SetValue(chord, realRelease); }
                    Check(releases == 2, "hold start and hook/desktop reset must both release owned modifiers");
                    down.Add(0x41); // Simulate a key-down whose key-up the dead hook misses.
                    removedKeyboard = (IntPtr)Field("keyboard"); removedMouse = (IntPtr)Field("mouse");
                    Check(UnhookWindowsHookEx(removedKeyboard), "keyboard hook was not installed");
                    Check(UnhookWindowsHookEx(removedMouse), "mouse hook was not installed");
                });
                bool recovered = false;
                for (int i = 0; i < 250 && !recovered; i++)
                {
                    Thread.Sleep(20);
                    dispatcher.Invoke((Action)delegate {
                        recovered = (IntPtr)Field("keyboard") != removedKeyboard && (IntPtr)Field("mouse") != removedMouse;
                    });
                }
                Check(recovered, "message-loop watchdog did not replace revoked hooks");
                dispatcher.Invoke((Action)delegate {
                    object chord = Field("chord");
                    var down = (System.Collections.Generic.HashSet<int>)chord.GetType().GetField("down", Instance).GetValue(chord);
                    Check(down.Count == 0, "missed key-up left the next shortcut blocked");
                    Check(UnhookWindowsHookEx((IntPtr)Field("keyboard")), "replacement keyboard hook was not installed");
                    Check(UnhookWindowsHookEx((IntPtr)Field("mouse")), "replacement mouse hook was not installed");
                    completed = true;
                });
            }
            catch (Exception error) { failure = error; }
            finally { if (dispatcher != null) dispatcher.BeginInvoke((Action)delegate { Application.ExitThread(); }); }
        }) { IsBackground = true }.Start();
        Call("Main");
        if (failure != null) { Console.Error.WriteLine(failure); return 1; }
        if (!completed) { Console.Error.WriteLine("Helper exited before the recovery checks completed."); return 1; }
        Console.WriteLine("Native hook removal and automatic recovery checks passed.");
        return 0;
    }
}
