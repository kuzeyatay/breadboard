using System;
using System.Reflection;
using System.Runtime.InteropServices;

// Runs the production helper unchanged, with a test-only window gate before
// its keyboard callback. Text still passes through every production focus
// check and SendInput. No other application's helper or service is stopped.
internal static class DictationSandboxHost
{
    private static readonly DictationWindowScope scope = new DictationWindowScope();
    private static readonly BindingFlags PrivateStatic = BindingFlags.NonPublic | BindingFlags.Static;
    private static Type helper;
    private static IntPtr target;
    private static MethodInfo originalKeyboard;
    private static bool startGuarded;
    [StructLayout(LayoutKind.Sequential)] private struct Keyboard { public uint Key, Scan, Flags, Time; public UIntPtr Extra; }
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    private static IntPtr OnKeyboard(int code, IntPtr message, IntPtr data)
    {
        if (code < 0) return CallNextHookEx(IntPtr.Zero, code, message, data);
        Keyboard key = (Keyboard)Marshal.PtrToStructure(data, typeof(Keyboard));
        // The production hook filters only its own stale Ctrl restores. All
        // other injected input passes through without entering the chord.
        if ((key.Flags & 0x10) != 0)
            return (IntPtr)originalKeyboard.Invoke(null, new object[] { code, message, data });
        if (!scope.Handle(GetForegroundWindow() == target, (int)key.Key, (key.Flags & 0x80) != 0, (key.Flags & 0x10) != 0))
            return CallNextHookEx(IntPtr.Zero, code, message, data);
        if (!startGuarded)
        {
            // Main assigns this callback before installing hooks. Recheck the
            // window when the delayed hold starts, as focus may have moved.
            object chord = helper.GetField("chord", PrivateStatic).GetValue(null);
            var start = chord.GetType().GetField("Start", BindingFlags.NonPublic | BindingFlags.Instance);
            var begin = (Action)start.GetValue(chord);
            start.SetValue(chord, (Action)delegate { if (GetForegroundWindow() == target) begin(); });
            startGuarded = true;
        }
        return (IntPtr)originalKeyboard.Invoke(null, new object[] { code, message, data });
    }
    [STAThread] private static int Main(string[] args)
    {
        target = new IntPtr(long.Parse(args[1])); uint process;
        if (GetWindowThreadProcessId(target, out process) == 0 || process != uint.Parse(args[2])) return 2;
        helper = Assembly.LoadFrom(args[0]).GetType("BreadboardDictation");
        originalKeyboard = helper.GetMethod("OnKeyboard", PrivateStatic);
        var field = helper.GetField("keyboardHook", PrivateStatic);
        field.SetValue(null, Delegate.CreateDelegate(field.FieldType, typeof(DictationSandboxHost).GetMethod("OnKeyboard", PrivateStatic)));
        return (int)helper.GetMethod("Main", PrivateStatic).Invoke(null, null);
    }
}
