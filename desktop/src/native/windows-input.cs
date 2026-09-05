using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Automation;

internal static class BreadboardWindowsInput
{
    private const uint InputMouse = 0;
    private const uint InputKeyboard = 1;
    private const uint MouseLeftDown = 0x0002;
    private const uint MouseLeftUp = 0x0004;
    private const uint KeyUp = 0x0002;
    private const uint KeyUnicode = 0x0004;
    private const ushort VkReturn = 0x000D;
    private const uint WmMouseMove = 0x0200;
    private const uint WmLeftButtonDown = 0x0201;
    private const uint WmLeftButtonUp = 0x0202;
    private const uint WmKeyDown = 0x0100;
    private const uint WmKeyUp = 0x0101;
    private const uint WmCharacter = 0x0102;
    private const uint MkLeftButton = 0x0001;
    private const uint SendMessageAbortIfHung = 0x0002;
    private static readonly int[] ModifierKeys = { 0x10, 0x11, 0x12, 0x5B, 0x5C };

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int Dx;
        public int Dy;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput
    {
        public uint Message;
        public ushort ParameterLow;
        public ushort ParameterHigh;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public HardwareInput Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public InputUnion Value;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out Point point);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    private static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(Point point);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ScreenToClient(IntPtr window, ref Point point);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr parameter,
        IntPtr data, uint flags, uint timeout, out UIntPtr result);

    private static void MakeDpiAware()
    {
        try
        {
            if (SetProcessDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return;
        }
        catch (EntryPointNotFoundException) { }
        SetProcessDPIAware();
    }

    private static void RequireNoHeldModifiers()
    {
        foreach (int key in ModifierKeys)
        {
            if ((GetAsyncKeyState(key) & 0x8000) != 0)
                throw new InvalidOperationException("Release Shift, Ctrl, Alt and Windows, then try the action again.");
        }
    }

    private static void Send(Input[] inputs, string error)
    {
        uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != inputs.Length) throw new InvalidOperationException(error);
    }

    private static Input MouseEvent(uint flags)
    {
        Input input = new Input();
        input.Type = InputMouse;
        input.Value.Mouse.Flags = flags;
        return input;
    }

    private static Input KeyEvent(ushort virtualKey, ushort scanCode, uint flags)
    {
        Input input = new Input();
        input.Type = InputKeyboard;
        input.Value.Keyboard.VirtualKey = virtualKey;
        input.Value.Keyboard.ScanCode = scanCode;
        input.Value.Keyboard.Flags = flags;
        return input;
    }

    private static void SendWindowClick(int x, int y)
    {
        Point point = new Point();
        point.X = x;
        point.Y = y;
        IntPtr window = WindowFromPoint(point);
        if (window == IntPtr.Zero || !ScreenToClient(window, ref point))
            throw new InvalidOperationException("Windows could not reach the target window.");
        int packed = (point.Y << 16) | (point.X & 0xFFFF);
        UIntPtr result;
        if (SendMessageTimeout(window, WmMouseMove, UIntPtr.Zero, new IntPtr(packed),
                SendMessageAbortIfHung, 1000, out result) == IntPtr.Zero
            || SendMessageTimeout(window, WmLeftButtonDown, new UIntPtr(MkLeftButton), new IntPtr(packed),
                SendMessageAbortIfHung, 1000, out result) == IntPtr.Zero
            || SendMessageTimeout(window, WmLeftButtonUp, UIntPtr.Zero, new IntPtr(packed),
                SendMessageAbortIfHung, 1000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("Windows blocked the click message.");
    }

    private static void SendWindowText(int x, int y, string text, bool pressEnter)
    {
        Point point = new Point();
        point.X = x;
        point.Y = y;
        IntPtr window = WindowFromPoint(point);
        if (window == IntPtr.Zero)
            throw new InvalidOperationException("Windows could not reach the target window for typing.");
        UIntPtr result;
        foreach (char character in text)
        {
            if (SendMessageTimeout(window, WmCharacter, new UIntPtr(character), new IntPtr(1),
                    SendMessageAbortIfHung, 1000, out result) == IntPtr.Zero)
                throw new InvalidOperationException("Windows blocked keyboard input.");
        }
        if (pressEnter)
        {
            if (SendMessageTimeout(window, WmKeyDown, new UIntPtr(VkReturn), new IntPtr(0x001C0001),
                    SendMessageAbortIfHung, 1000, out result) == IntPtr.Zero
                || SendMessageTimeout(window, WmCharacter, new UIntPtr(VkReturn), new IntPtr(0x001C0001),
                    SendMessageAbortIfHung, 1000, out result) == IntPtr.Zero
                || SendMessageTimeout(window, WmKeyUp, new UIntPtr(VkReturn), new IntPtr(unchecked((int)0xC01C0001)),
                    SendMessageAbortIfHung, 1000, out result) == IntPtr.Zero)
                throw new InvalidOperationException("Windows blocked the Enter key.");
        }
    }

    private static bool TrySetAutomationText(AutomationElement element, string text)
    {
        if (element == null) return false;
        object pattern;
        if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return false;
        ValuePattern value = pattern as ValuePattern;
        if (value == null || value.Current.IsReadOnly) return false;
        value.SetValue(text);
        try { element.SetFocus(); }
        catch (InvalidOperationException) { }
        return true;
    }

    private static bool SetAutomationText(int x, int y, string text)
    {
        AutomationElement element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
        if (element == null) return false;
        if (TrySetAutomationText(element, text)) return true;
        AutomationElementCollection descendants = element.FindAll(TreeScope.Descendants,
            new PropertyCondition(AutomationElement.IsValuePatternAvailableProperty, true));
        foreach (AutomationElement descendant in descendants)
        {
            System.Windows.Rect bounds = descendant.Current.BoundingRectangle;
            if (bounds.Contains(x, y) && TrySetAutomationText(descendant, text)) return true;
        }
        return false;
    }

    private static void Click(string[] args)
    {
        if (args.Length != 3) throw new FormatException("Invalid click request.");
        int x;
        int y;
        if (!Int32.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out x)
            || !Int32.TryParse(args[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out y))
            throw new FormatException("Invalid desktop coordinates.");

        RequireNoHeldModifiers();
        if (!SetCursorPos(x, y))
        {
            if (Marshal.GetLastWin32Error() == 5)
            {
                // Background automation test runners can be denied cursor
                // control while their target windows remain messageable.
                SendWindowClick(x, y);
                return;
            }
            throw new InvalidOperationException("Windows could not move the mouse to that target (error "
                + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture) + ").");
        }
        Thread.Sleep(40);
        Point actual;
        if (!GetCursorPos(out actual))
            throw new InvalidOperationException("Windows could not read the cursor position (error "
                + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture) + ").");
        if (Math.Abs(actual.X - x) > 1 || Math.Abs(actual.Y - y) > 1)
            throw new InvalidOperationException("Windows moved the cursor to "
                + actual.X.ToString(CultureInfo.InvariantCulture) + ","
                + actual.Y.ToString(CultureInfo.InvariantCulture) + " instead of the target.");
        Send(new[] { MouseEvent(MouseLeftDown), MouseEvent(MouseLeftUp) },
            "Windows blocked the click. The target app may be running as administrator.");
    }

    private static void TypeText(string[] args)
    {
        if (args.Length != 4 || (args[3] != "0" && args[3] != "1"))
            throw new FormatException("Invalid typing request.");
        int x;
        int y;
        if (!Int32.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out x)
            || !Int32.TryParse(args[2], NumberStyles.Integer, CultureInfo.InvariantCulture, out y))
            throw new FormatException("Invalid desktop coordinates.");
        string text = Console.In.ReadToEnd();
        if (text.Length == 0 || text.Length > 1000)
            throw new FormatException("Clicky can type between 1 and 1,000 characters.");
        foreach (char character in text)
        {
            if (character < 0x20 || character == 0x7F)
                throw new FormatException("Clicky cannot type control characters.");
        }

        RequireNoHeldModifiers();
        if (!SetCursorPos(x, y) && Marshal.GetLastWin32Error() == 5)
        {
            if (!SetAutomationText(x, y, text)) SendWindowText(x, y, text, false);
            if (args[3] == "1")
            {
                Thread.Sleep(40);
                SendWindowText(x, y, "", true);
            }
            return;
        }
        const int charactersPerBatch = 64;
        for (int offset = 0; offset < text.Length; offset += charactersPerBatch)
        {
            int count = Math.Min(charactersPerBatch, text.Length - offset);
            Input[] inputs = new Input[count * 2];
            for (int index = 0; index < count; index++)
            {
                ushort unit = text[offset + index];
                inputs[index * 2] = KeyEvent(0, unit, KeyUnicode);
                inputs[index * 2 + 1] = KeyEvent(0, unit, KeyUnicode | KeyUp);
            }
            Send(inputs, "Windows blocked keyboard input. The target app may be running as administrator.");
        }
        if (args[3] == "1")
        {
            Send(new[] { KeyEvent(VkReturn, 0, 0), KeyEvent(VkReturn, 0, KeyUp) },
                "Windows blocked keyboard input. The target app may be running as administrator.");
        }
    }

    private static int Main(string[] args)
    {
        try
        {
            MakeDpiAware();
            if (args.Length == 0) throw new FormatException("Missing input operation.");
            if (args[0] == "click") Click(args);
            else if (args[0] == "type") TypeText(args);
            else throw new FormatException("Unknown input operation.");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.Write(error.Message);
            return 1;
        }
    }
}
