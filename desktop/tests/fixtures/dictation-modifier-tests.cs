using System;
using System.Reflection;
using System.Runtime.InteropServices;

// Exercise the production hook at the exact interval that SendInput has
// queued text but Chromium has not acknowledged it. No OS input is sent.
internal static class DictationModifierTests
{
    private const BindingFlags PrivateStatic = BindingFlags.NonPublic | BindingFlags.Static;
    private static Type helper, keyType;
    private static object Call(string name, params object[] args) { return helper.GetMethod(name, PrivateStatic).Invoke(null, args); }
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static IntPtr Hook(int key, bool up, bool injected, UIntPtr extra)
    {
        object input = Activator.CreateInstance(keyType);
        keyType.GetField("Key").SetValue(input, (uint)key);
        keyType.GetField("Flags").SetValue(input, (up ? 0x80u : 0u) | (injected ? 0x10u : 0u));
        keyType.GetField("Extra").SetValue(input, extra);
        IntPtr data = Marshal.AllocHGlobal(Marshal.SizeOf(keyType));
        try { Marshal.StructureToPtr(input, data, false); return (IntPtr)Call("OnKeyboard", 0, new IntPtr(up ? 0x101 : 0x100), data); }
        finally { Marshal.FreeHGlobal(data); }
    }
    private static void Main(string[] args)
    {
        helper = Assembly.LoadFrom(args[0]).GetType("BreadboardDictation");
        keyType = helper.GetNestedType("Keyboard", BindingFlags.NonPublic);
        var pending = helper.GetField("previewInputPending", PrivateStatic);
        object chord = helper.GetField("chord", PrivateStatic).GetValue(null);
        foreach (string callback in new[] { "Start", "Finish", "Cancel" })
            chord.GetType().GetField(callback, BindingFlags.NonPublic | BindingFlags.Instance).SetValue(chord, (Action)delegate {});
        UIntPtr marker = (UIntPtr)helper.GetField("restoreControlMarker", PrivateStatic).GetValue(null);
        UIntPtr windowsMarker = (UIntPtr)helper.GetField("deferredModifierMarker", PrivateStatic).GetValue(null);
        foreach (int win in new[] { 0x5B, 0x5C, 0xA2, 0xA3, 0xA0, 0xA1 }) {
            string record = win < 0xA0 ? "RecordPhysicalWindows" : win < 0xA2 ? "RecordPhysicalShift" : "RecordPhysicalControl";
            Call(record, win, false);
            Check(Hook(win, false, true, windowsMarker) == IntPtr.Zero, "an ordinary deferred shortcut can replay while Win is held");
            Call(record, win, true);
            Check(Hook(win, false, true, windowsMarker) == new IntPtr(1), "a queued Win down arriving after release must not stick the Windows key");
            Check(Hook(win, true, true, windowsMarker) == IntPtr.Zero, "a Win release must never be suppressed");
            Check(Hook(win, false, true, UIntPtr.Zero) == IntPtr.Zero, "other applications and balanced Win taps remain untouched");
        }
        foreach (int ctrl in new[] { 0xA2, 0xA3 }) {
            Check(Hook(ctrl, false, false, UIntPtr.Zero) == IntPtr.Zero, "ordinary Ctrl must pass");
            if (pending != null) pending.SetValue(null, true);
            Check(Hook(ctrl, false, true, marker) == new IntPtr(1), "a queued restore from the previous preview reactivated Ctrl during text insertion");
            for (int repeat = 0; repeat < 30; repeat++)
                Check(Hook(ctrl, false, false, UIntPtr.Zero) == new IntPtr(1), "physical Ctrl autorepeat reactivated Ctrl during text insertion");
            chord.GetType().GetMethod("BeginTextInput", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(chord, null);
            if (pending != null) pending.SetValue(null, false);
            Check(Hook(ctrl, false, true, marker) == new IntPtr(1), "a delayed restore reactivated Ctrl between streamed fragments");
            Check(Hook(ctrl, false, false, UIntPtr.Zero) == new IntPtr(1), "Ctrl autorepeat reactivated Ctrl between streamed fragments");
            Check(Hook(ctrl, true, false, UIntPtr.Zero) == IntPtr.Zero, "physical release must always pass");
            if (pending != null) pending.SetValue(null, false);
            Check(Hook(ctrl, false, true, marker) == new IntPtr(1), "a released Ctrl must never be restored");
            Check(Hook(ctrl, false, false, UIntPtr.Zero) == IntPtr.Zero, "Ctrl must work immediately outside insertion");
            Check(Hook(ctrl, false, true, marker) == IntPtr.Zero, "held Ctrl must restore after acknowledgement");
            chord.GetType().GetMethod("Complete", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(chord, null);
            Check(Hook(ctrl, false, true, marker) == new IntPtr(1), "voice submission must keep Ctrl up through Enter dispatch");
            Check(Hook(ctrl, false, false, UIntPtr.Zero) == new IntPtr(1), "physical repeat cannot turn voice send into Ctrl+Enter");
            Check(Hook(ctrl, true, false, UIntPtr.Zero) == IntPtr.Zero, "final release passes");
        }
        foreach (int shift in new[] { 0xA0, 0xA1 }) {
            Check(Hook(shift, false, false, UIntPtr.Zero) == IntPtr.Zero, "ordinary Shift must pass immediately");
            pending.SetValue(null, true);
            Check(Hook(shift, false, false, UIntPtr.Zero) == new IntPtr(1), "Shift cannot reactivate during insertion");
            chord.GetType().GetMethod("BeginTextInput", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(chord, null);
            pending.SetValue(null, false);
            Check(Hook(shift, false, false, UIntPtr.Zero) == new IntPtr(1), "Shift stays neutral between fragments");
            chord.GetType().GetMethod("Complete", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(chord, null);
            Check(Hook(shift, false, false, UIntPtr.Zero) == new IntPtr(1), "voice send cannot become Shift+Enter");
            Check(Hook(shift, true, false, UIntPtr.Zero) == IntPtr.Zero, "Shift release always passes");
            Check(Hook(shift, false, false, UIntPtr.Zero) == IntPtr.Zero, "fresh Shift works after dictation");
            Check(Hook(shift, true, false, UIntPtr.Zero) == IntPtr.Zero, "fresh Shift release passes");
        }
        Console.WriteLine("In-flight Ctrl/Shift restore and autorepeat regression checks passed.");
    }
}
