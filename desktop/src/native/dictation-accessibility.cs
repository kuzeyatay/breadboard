using System;
using System.Runtime.InteropServices;
using Accessibility;

// Chromium exposes contenteditable through IAccessible2 even when its legacy
// UI Automation bridge reports only Custom/Document without a text pattern.
internal sealed class DictationAccessibleTarget
{
    [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface AccessibleServices
    {
        [PreserveSig] int QueryService(ref Guid service, ref Guid iid, out IntPtr result);
    }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ReadInt(IntPtr self, out int value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ReadExtents(IntPtr self, int offset, int coordinates,
        out int x, out int y, out int width, out int height);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ReadSelection(IntPtr self, int index, out int start, out int end);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int SetSelection(IntPtr self, int index, int start, int end);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ReadText(IntPtr self, int start, int end, out IntPtr text);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ReadObject(IntPtr self, int index, out IntPtr value);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] private delegate int ReadIndex(IntPtr self, int offset, out int index);
    [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out IAccessible accessible);
    private static readonly Guid AccessibleId = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    private readonly IAccessible accessible;
    private readonly object child;
    private DictationAccessibleTarget focusOwner;
    private DictationAccessibleTarget textParent;
    private int objectOffset;
    private DictationAccessibleTarget(IAccessible accessible, object child) { this.accessible = accessible; this.child = child; }

    private IntPtr Query(string identifier)
    {
        AccessibleServices services = accessible as AccessibleServices;
        if (services == null || Convert.ToInt32(child) != 0) return IntPtr.Zero;
        Guid service = AccessibleId, iid = new Guid(identifier); IntPtr result;
        return services.QueryService(ref service, ref iid, out result) == 0 ? result : IntPtr.Zero;
    }
    private static Delegate Method(IntPtr instance, int slot, Type type)
    { return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(instance), slot * IntPtr.Size), type); }
    internal bool SupportsStreaming
    {
        get {
            string text = Text(0, -1);
            if (text == null || text.IndexOf('\ufffc') < 0) return true;
            // TextAtCaret resolves editable paragraphs first. A remaining
            // object outside the selection can be a read-only placeholder or
            // decoration; it must not disable streaming into adjacent text.
            // Selecting objects still requires final insertion, because their
            // offsets cannot represent a span of editable characters.
            int[] range = Selection();
            return range != null && range[0] >= 0 && range[1] <= text.Length
                && text.IndexOf('\ufffc', range[0], range[1] - range[0]) < 0;
        }
    }
    internal bool IsEditable()
    {
        try
        {
            int state = Convert.ToInt32(accessible.get_accState(child));
            // Disabled, read-only, protected, invisible or offscreen controls.
            if ((state & (0x1 | 0x40 | 0x20000000 | 0x8000 | 0x10000)) != 0) return false;
            if (Convert.ToInt32(accessible.get_accRole(child)) == 0x2A) return true;
            IntPtr ia2 = Query("E89F726E-C4F4-4C19-BB19-B647D7FA8478");
            if (ia2 == IntPtr.Zero) return false;
            try
            {
                // IAccessible2 IDL: 28 inherited slots, then states is the
                // eighth method. IA2_STATE_EDITABLE=8, DEFUNCT=4, STALE=0x4000.
                // https://github.com/LinuxA11y/IAccessible2/blob/master/api/Accessible2.idl
                int states;
                return ((ReadInt)Method(ia2, 35, typeof(ReadInt)))(ia2, out states) == 0
                    && (states & 8) != 0 && (states & (4 | 0x4000)) == 0;
            }
            finally { Marshal.Release(ia2); }
        }
        catch { return false; }
    }
    internal bool IsFocused()
    {
        if (focusOwner != null) return focusOwner.IsFocused();
        try { return (Convert.ToInt32(accessible.get_accState(child)) & 4) != 0 && IsEditable(); }
        catch { return false; }
    }
    private DictationAccessibleTarget TextAtCaret()
    {
        var target = this;
        for (int depth = 0; depth < 16; depth++)
        {
            // Rich editors expose paragraphs as U+FFFC in the focused root's
            // hypertext. Its offsets describe objects, not typed characters.
            // Resolve the selected paragraph before capturing any owned span.
            string text = target.Text(0, -1);
            if (text == null || text.IndexOf('\ufffc') < 0) return target;
            int[] range = target.Selection();
            if (range == null || range[1] - range[0] > 1) return target;
            int offset = range[0];
            if (offset == text.Length && range[0] == range[1]) offset--;
            if (offset < 0 || offset >= text.Length || text[offset] != '\ufffc') return target;
            IntPtr hypertext = IntPtr.Zero, embedded = IntPtr.Zero;
            try
            {
                // IAccessibleHypertext inherits 22 IAccessibleText slots;
                // get_hyperlink and get_hyperlinkIndex are slots 23 and 24.
                // https://github.com/LinuxA11y/IAccessible2/blob/master/api/AccessibleHypertext.idl
                hypertext = target.Query("6B4F8BBF-F1F2-418A-B35E-A195BC4103B9");
                int index;
                if (hypertext == IntPtr.Zero || ((ReadIndex)Method(hypertext, 24, typeof(ReadIndex)))(hypertext, offset, out index) != 0 || index < 0
                    || ((ReadObject)Method(hypertext, 23, typeof(ReadObject)))(hypertext, index, out embedded) != 0 || embedded == IntPtr.Zero) return target;
                var node = Marshal.GetObjectForIUnknown(embedded) as IAccessible;
                if (node == null) return target;
                var next = new DictationAccessibleTarget(node, 0) { focusOwner = this, textParent = target, objectOffset = offset };
                if (!next.IsEditable() || next.Selection() == null) return target;
                target = next;
            }
            catch { return target; }
            finally { if (embedded != IntPtr.Zero) Marshal.Release(embedded); if (hypertext != IntPtr.Zero) Marshal.Release(hypertext); }
        }
        return target;
    }
    internal int[] Bounds()
    {
        try {
            int x, y, width, height; accessible.accLocation(out x, out y, out width, out height, child);
            return width > 0 && height > 0 ? new[] { x, y, width, height } : null;
        } catch { return null; }
    }
    internal int[] Caret()
    {
        IntPtr text = IntPtr.Zero;
        try
        {
            text = Query("24FD2FFB-3AAD-4A08-8335-A3AD89C0FB4B");
            if (text == IntPtr.Zero) return null;
            // Independent IAccessibleText interface: IUnknown plus
            // addSelection, attributes, caretOffset, characterExtents.
            // https://github.com/LinuxA11y/IAccessible2/blob/master/api/AccessibleText.idl
            int offset, x, y, width, height;
            if (((ReadInt)Method(text, 5, typeof(ReadInt)))(text, out offset) != 0 || offset < 0) return null;
            var extents = (ReadExtents)Method(text, 6, typeof(ReadExtents));
            if (extents(text, offset, 0, out x, out y, out width, out height) == 0 && height > 0) return new[] { x, y, 1, height };
            if (offset > 0 && extents(text, offset - 1, 0, out x, out y, out width, out height) == 0 && height > 0)
                return new[] { x + width, y, 1, height };
        }
        catch { }
        finally { if (text != IntPtr.Zero) Marshal.Release(text); }
        return null;
    }
    internal int[] Selection()
    {
        IntPtr text = IntPtr.Zero;
        try {
            text = Query("24FD2FFB-3AAD-4A08-8335-A3AD89C0FB4B");
            if (text == IntPtr.Zero) return null;
            int start, end;
            if (((ReadSelection)Method(text, 9, typeof(ReadSelection)))(text, 0, out start, out end) == 0 && start >= 0 && end >= 0)
                return new[] { Math.Min(start, end), Math.Max(start, end) };
            if (((ReadInt)Method(text, 5, typeof(ReadInt)))(text, out start) == 0 && start >= 0) return new[] { start, start };
        } catch { }
        finally { if (text != IntPtr.Zero) Marshal.Release(text); }
        // An empty editor can put its DOM caret just before/after a paragraph,
        // so the paragraph itself reports no caret yet. Map that exact parent
        // boundary, while preferring the paragraph's own selection once typed.
        if (textParent != null) {
            int[] parent = textParent.Selection();
            if (parent != null && parent[0] == parent[1]) {
                if (parent[0] == objectOffset) return new[] { 0, 0 };
                if (parent[0] == objectOffset + 1) {
                    string content = Text(0, -1);
                    if (content != null) return new[] { content.Length, content.Length };
                }
            }
        }
        return null;
    }
    internal bool Select(int start, int end)
    {
        IntPtr text = IntPtr.Zero;
        try {
            text = Query("24FD2FFB-3AAD-4A08-8335-A3AD89C0FB4B");
            return text != IntPtr.Zero && ((SetSelection)Method(text, 16, typeof(SetSelection)))(text, 0, start, end) == 0;
        } catch { return false; }
        finally { if (text != IntPtr.Zero) Marshal.Release(text); }
    }
    internal string Text(int start, int end)
    {
        if (start == end) return "";
        IntPtr text = IntPtr.Zero, value = IntPtr.Zero;
        try {
            text = Query("24FD2FFB-3AAD-4A08-8335-A3AD89C0FB4B");
            // Chromium returns S_FALSE for an empty suffix requested with the
            // end-of-text sentinel. It is a valid empty range, not a read error.
            int length;
            if (text != IntPtr.Zero && end == -1 && ((ReadInt)Method(text, 17, typeof(ReadInt)))(text, out length) == 0 && start == length) return "";
            if (text != IntPtr.Zero && ((ReadText)Method(text, 10, typeof(ReadText)))(text, start, end, out value) == 0)
                return Marshal.PtrToStringBSTR(value);
        } catch { }
        finally { if (value != IntPtr.Zero) Marshal.FreeBSTR(value); if (text != IntPtr.Zero) Marshal.Release(text); }
        return null;
    }
    internal static DictationAccessibleTarget FromWindow(IntPtr window)
    {
        if (window == IntPtr.Zero) return null;
        try
        {
            Guid iid = AccessibleId; IAccessible node;
            if (AccessibleObjectFromWindow(window, unchecked((uint)-4), ref iid, out node) != 0) return null;
            for (int depth = 0; node != null && depth < 16; depth++)
            {
                object focus = node.accFocus;
                if (focus is IAccessible) { node = (IAccessible)focus; continue; }
                object child = focus is int ? focus : 0;
                var target = new DictationAccessibleTarget(node, child);
                if (target.IsFocused()) return target.TextAtCaret();
                if (Convert.ToInt32(child) == 0) return null;
                node = node.get_accChild(child) as IAccessible;
            }
        }
        catch { }
        return null;
    }
}
