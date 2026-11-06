using System;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;

// Exercise the production keyboard-hook boundary without installing hooks,
// sending OS input, accessing the microphone, or changing any user's text.
internal static class DictationMauselyTests
{
    private const BindingFlags Static = BindingFlags.NonPublic | BindingFlags.Static;
    private const BindingFlags Instance = BindingFlags.NonPublic | BindingFlags.Instance;
    private static Type helper, keyType;
    private static object chord;
    private static int starts, finishes, releases;
    private static readonly UIntPtr marker = new UIntPtr(0x4D415553u);
    private static object Call(string method, params object[] args) { return helper.GetMethod(method, Static).Invoke(null, args); }
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Key(int code, bool up, UIntPtr extra)
    {
        object key = Activator.CreateInstance(keyType);
        keyType.GetField("Key").SetValue(key, (uint)code);
        keyType.GetField("Flags").SetValue(key, 0x10u | (up ? 0x80u : 0u));
        keyType.GetField("Extra").SetValue(key, extra);
        IntPtr data = Marshal.AllocHGlobal(Marshal.SizeOf(keyType));
        try {
            Marshal.StructureToPtr(key, data, false);
            Call("OnKeyboard", 0, new IntPtr(up ? 0x101 : 0x100), data);
        } finally { Marshal.FreeHGlobal(data); }
    }
    private static void Tick()
    {
        var clock = (Stopwatch)helper.GetField("clock", Static).GetValue(null);
        chord.GetType().GetMethod("Tick", Instance).Invoke(chord, new object[] { clock.ElapsedMilliseconds + 200L });
    }
    private static void Fresh()
    {
        chord.GetType().GetMethod("Reset", Instance).Invoke(chord, null);
        starts = finishes = releases = 0;
    }
    private static void Main(string[] args)
    {
        helper = Assembly.LoadFrom(args[0]).GetType("BreadboardDictation");
        keyType = helper.GetNestedType("Keyboard", BindingFlags.NonPublic);
        chord = helper.GetField("chord", Static).GetValue(null);
        chord.GetType().GetField("Start", Instance).SetValue(chord, (Action)delegate { starts++; });
        chord.GetType().GetField("Finish", Instance).SetValue(chord, (Action)delegate { finishes++; });
        chord.GetType().GetField("Cancel", Instance).SetValue(chord, (Action)delegate {});
        chord.GetType().GetField("ReleaseModifiers", Instance).SetValue(chord, (Action)delegate { releases++; });

        Fresh();
        Key(0xA2, false, UIntPtr.Zero); Key(0xA0, false, UIntPtr.Zero); Tick();
        Key(0xA0, true, UIntPtr.Zero); Key(0xA2, true, UIntPtr.Zero);
        Check(starts == 0 && finishes == 0, "ordinary simulated typing must not activate dictation");

        foreach (int ctrl in new[] { 0x11, 0xA2, 0xA3 })
        foreach (int shift in new[] { 0x10, 0xA0, 0xA1 })
        foreach (bool reverse in new[] { false, true }) {
            Fresh();
            int first = reverse ? shift : ctrl, second = reverse ? ctrl : shift;
            Key(first, false, marker); Key(second, false, marker); Tick();
            Check(starts == 1 && finishes == 0 && releases == 1, "Mausely's tagged held chord must start dictation");
            Key(first, false, marker); Key(second, false, marker); Tick();
            Check(starts == 1 && finishes == 0, "holding the V must keep one voice session active");
            // Breadboard neutralizes modifiers for transcript insertion. These
            // untagged internal releases must not end Mausely's held chord.
            Key(first, true, UIntPtr.Zero); Key(second, true, UIntPtr.Zero); Tick();
            Check(finishes == 0, "Breadboard's own releases must not end the gesture hold");
            // Only Ctrl/Shift events are accepted from the MAUS tag.
            Key(0x41, false, marker); Key(0x41, true, marker);
            Key(0x5B, false, marker); Key(0x5B, true, marker);
            Check(!(bool)chord.GetType().GetProperty("ScreenAware", Instance).GetValue(chord, null), "tagged Win must not enable screen capture");
            Key(second, true, marker);
            Check(finishes == 1, "Mausely release must finish dictation");
            Key(first, true, marker); Tick();
            Check(starts == 1 && finishes == 1, "release must not duplicate start or finish");
        }
        Console.WriteLine("Mausely tagged hold/release and injected-input exclusion checks passed.");
    }
}
