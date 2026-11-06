using System;
using System.Reflection;

// Substitute only the accessibility bridge. No hooks or SendInput are invoked;
// production capture/focus ownership logic runs against delayed editor data.
internal sealed class DictationAccessibleTarget
{
    internal static DictationAccessibleTarget Next;
    internal bool Focused = true, Streamable = true;
    internal int[] Range;
    internal string Selected = "";
    internal bool SupportsStreaming { get { return Streamable; } }
    internal bool IsFocused() { return Focused; }
    internal int[] Selection() { return Range; }
    internal string Text(int start, int end) { return Selected; }
    internal bool Select(int start, int end) { throw new Exception("No selection changes in this test"); }
    internal int[] Bounds() { return null; }
    internal int[] Caret() { return null; }
    internal static DictationAccessibleTarget FromWindow(IntPtr window) { return Next; }
}

internal static class DictationPreviewTests
{
    private const BindingFlags Static = BindingFlags.NonPublic | BindingFlags.Static;
    private const BindingFlags Instance = BindingFlags.NonPublic | BindingFlags.Instance;
    private static readonly Type Helper = typeof(BreadboardDictation);
    private static object Call(string name, params object[] args) { return Helper.GetMethod(name, Static).Invoke(null, args); }
    private static void Set(object session, string name, object value) { session.GetType().GetField(name, Instance).SetValue(session, value); }
    private static object Get(object session, string name) { return session.GetType().GetField(name, Instance).GetValue(session); }
    private static object Session(DictationAccessibleTarget original)
    {
        var session = Activator.CreateInstance(Helper.GetNestedType("Session", BindingFlags.NonPublic), true);
        Set(session, "Window", Call("GetForegroundWindow")); Set(session, "Focus", Call("Focus"));
        Set(session, "Accessible", original);
        Helper.GetField("current", Static).SetValue(null, session);
        return session;
    }
    private static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    private static void Main()
    {
        var original = new DictationAccessibleTarget();
        var session = Session(original);
        DictationAccessibleTarget.Next = original;
        Check(!(bool)Call("CapturePreview", session), "A missing initial selection must wait");
        original.Range = new[] { 3, 3 };
        Check((bool)Call("CapturePreview", session), "Retry captures the now-ready selection during this hold");
        Check((int)Get(session, "PreviewStart") == 3, "Capture the actual caret");
        original.Range = new[] { 9, 9 };
        Check((bool)Call("CapturePreview", session), "An owned span remains captured");
        Check((int)Get(session, "PreviewStart") == 3, "Never recapture after owning a span");

        original = new DictationAccessibleTarget { Range = new[] { 2, 4 }, Selected = null };
        session = Session(original); DictationAccessibleTarget.Next = original;
        Check(!(bool)Call("CapturePreview", session), "Unavailable text must wait too");
        original.Selected = "hi";
        Check((bool)Call("CapturePreview", session), "Retry captures text once available");
        Check((string)Get(session, "OriginalSelection") == "hi", "Keep selected text for ownership verification");

        original = new DictationAccessibleTarget { Focused = false };
        session = Session(original);
        DictationAccessibleTarget.Next = new DictationAccessibleTarget { Range = new[] { 0, 0 } };
        Check(!(bool)Call("CapturePreview", session), "A newly focused editor cannot take over an old hold");
        original.Focused = true;
        DictationAccessibleTarget.Next.Streamable = false;
        Check(!(bool)Call("CapturePreview", session), "An object selection cannot be treated as editable characters");
        Console.WriteLine("Delayed preview capture checks passed");
    }
}
