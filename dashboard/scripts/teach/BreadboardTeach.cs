// Breadboard teach-by-demonstration helper for Windows.
//
// Understudy's demonstration recorder is a Swift script spawned as a child
// process; this is the Windows equivalent behind the same abstraction. It is
// deliberately one self-contained file with no package dependencies: every API
// it uses ships with Windows itself, so nothing has to be installed before a
// user can teach a workflow. The compiler is the .NET Framework csc that is
// already on every Windows machine, which pins the language to C# 5 -- no
// string interpolation, no null-conditional operators, no expression bodies.
//
// Two modes, one binary:
//
//   record   installs low-level input hooks and writes a semantic event log
//            plus keyframes around meaningful actions.
//   control  reads JSON commands on stdin and drives the desktop, exposing the
//            UI Automation tree so a replay can ground a target by what it says
//            rather than by where it was.
//
// Neither mode ever writes captured text, window contents or frames to stdout:
// stdout carries protocol only, and the recorder's own output goes to files the
// Breadboard service owns.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

namespace Breadboard.Teach
{
    #region JSON

    /// <summary>Minimal JSON writer. Hand-rolled so the helper needs no package feed.</summary>
    internal static class Json
    {
        public static string Escape(string value)
        {
            if (value == null) return "null";
            StringBuilder builder = new StringBuilder(value.Length + 16);
            builder.Append('"');
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\b': builder.Append("\\b"); break;
                    case '\f': builder.Append("\\f"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < ' ' || c == '')
                        {
                            builder.Append("\\u");
                            builder.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(c);
                        }
                        break;
                }
            }
            builder.Append('"');
            return builder.ToString();
        }

        public static string Number(double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return "null";
            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        public static string Write(object value)
        {
            StringBuilder builder = new StringBuilder();
            WriteTo(builder, value);
            return builder.ToString();
        }

        private static void WriteTo(StringBuilder builder, object value)
        {
            if (value == null) { builder.Append("null"); return; }
            if (value is string) { builder.Append(Escape((string)value)); return; }
            if (value is bool) { builder.Append(((bool)value) ? "true" : "false"); return; }
            if (value is int) { builder.Append(((int)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is long) { builder.Append(((long)value).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is double) { builder.Append(Number((double)value)); return; }
            if (value is float) { builder.Append(Number((float)value)); return; }

            IDictionary<string, object> map = value as IDictionary<string, object>;
            if (map != null)
            {
                builder.Append('{');
                bool first = true;
                foreach (KeyValuePair<string, object> entry in map)
                {
                    if (entry.Value == null) continue; // omit rather than emit nulls
                    if (!first) builder.Append(',');
                    first = false;
                    builder.Append(Escape(entry.Key));
                    builder.Append(':');
                    WriteTo(builder, entry.Value);
                }
                builder.Append('}');
                return;
            }

            System.Collections.IEnumerable list = value as System.Collections.IEnumerable;
            if (list != null)
            {
                builder.Append('[');
                bool first = true;
                foreach (object item in list)
                {
                    if (!first) builder.Append(',');
                    first = false;
                    WriteTo(builder, item);
                }
                builder.Append(']');
                return;
            }

            builder.Append(Escape(value.ToString()));
        }

        /// <summary>Recursive-descent reader for the control protocol's one-line commands.</summary>
        public static object Parse(string text)
        {
            int index = 0;
            object value = ParseValue(text, ref index);
            SkipWhitespace(text, ref index);
            return value;
        }

        private static void SkipWhitespace(string text, ref int index)
        {
            while (index < text.Length && char.IsWhiteSpace(text[index])) index++;
        }

        private static object ParseValue(string text, ref int index)
        {
            SkipWhitespace(text, ref index);
            if (index >= text.Length) throw new FormatException("Unexpected end of JSON.");
            char c = text[index];
            if (c == '{') return ParseObject(text, ref index);
            if (c == '[') return ParseArray(text, ref index);
            if (c == '"') return ParseString(text, ref index);
            if (c == 't' && text.Length - index >= 4 && text.Substring(index, 4) == "true") { index += 4; return true; }
            if (c == 'f' && text.Length - index >= 5 && text.Substring(index, 5) == "false") { index += 5; return false; }
            if (c == 'n' && text.Length - index >= 4 && text.Substring(index, 4) == "null") { index += 4; return null; }
            return ParseNumber(text, ref index);
        }

        private static Dictionary<string, object> ParseObject(string text, ref int index)
        {
            Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
            index++; // '{'
            SkipWhitespace(text, ref index);
            if (index < text.Length && text[index] == '}') { index++; return map; }
            while (true)
            {
                SkipWhitespace(text, ref index);
                string key = ParseString(text, ref index);
                SkipWhitespace(text, ref index);
                if (index >= text.Length || text[index] != ':') throw new FormatException("Expected ':' in JSON object.");
                index++;
                map[key] = ParseValue(text, ref index);
                SkipWhitespace(text, ref index);
                if (index >= text.Length) throw new FormatException("Unterminated JSON object.");
                if (text[index] == ',') { index++; continue; }
                if (text[index] == '}') { index++; return map; }
                throw new FormatException("Expected ',' or '}' in JSON object.");
            }
        }

        private static List<object> ParseArray(string text, ref int index)
        {
            List<object> list = new List<object>();
            index++; // '['
            SkipWhitespace(text, ref index);
            if (index < text.Length && text[index] == ']') { index++; return list; }
            while (true)
            {
                list.Add(ParseValue(text, ref index));
                SkipWhitespace(text, ref index);
                if (index >= text.Length) throw new FormatException("Unterminated JSON array.");
                if (text[index] == ',') { index++; continue; }
                if (text[index] == ']') { index++; return list; }
                throw new FormatException("Expected ',' or ']' in JSON array.");
            }
        }

        private static string ParseString(string text, ref int index)
        {
            if (index >= text.Length || text[index] != '"') throw new FormatException("Expected a JSON string.");
            index++;
            StringBuilder builder = new StringBuilder();
            while (index < text.Length)
            {
                char c = text[index++];
                if (c == '"') return builder.ToString();
                if (c != '\\') { builder.Append(c); continue; }
                if (index >= text.Length) break;
                char escape = text[index++];
                switch (escape)
                {
                    case '"': builder.Append('"'); break;
                    case '\\': builder.Append('\\'); break;
                    case '/': builder.Append('/'); break;
                    case 'b': builder.Append('\b'); break;
                    case 'f': builder.Append('\f'); break;
                    case 'n': builder.Append('\n'); break;
                    case 'r': builder.Append('\r'); break;
                    case 't': builder.Append('\t'); break;
                    case 'u':
                        if (index + 4 > text.Length) throw new FormatException("Truncated \\u escape.");
                        builder.Append((char)int.Parse(text.Substring(index, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        index += 4;
                        break;
                    default: throw new FormatException("Unknown JSON escape.");
                }
            }
            throw new FormatException("Unterminated JSON string.");
        }

        private static double ParseNumber(string text, ref int index)
        {
            int start = index;
            while (index < text.Length && "+-0123456789.eE".IndexOf(text[index]) >= 0) index++;
            return double.Parse(text.Substring(start, index - start), CultureInfo.InvariantCulture);
        }

        public static string GetString(IDictionary<string, object> map, string key)
        {
            object value;
            if (map == null || !map.TryGetValue(key, out value) || value == null) return null;
            return value as string;
        }

        public static double? GetNumber(IDictionary<string, object> map, string key)
        {
            object value;
            if (map == null || !map.TryGetValue(key, out value) || value == null) return null;
            if (value is double) return (double)value;
            double parsed;
            if (value is string && double.TryParse((string)value, NumberStyles.Any, CultureInfo.InvariantCulture, out parsed)) return parsed;
            return null;
        }

        public static bool GetBool(IDictionary<string, object> map, string key, bool fallback)
        {
            object value;
            if (map == null || !map.TryGetValue(key, out value) || value == null) return fallback;
            if (value is bool) return (bool)value;
            return fallback;
        }

        public static List<object> GetList(IDictionary<string, object> map, string key)
        {
            object value;
            if (map == null || !map.TryGetValue(key, out value)) return null;
            return value as List<object>;
        }
    }

    #endregion

    #region Win32

    internal static class Native
    {
        public const int WH_KEYBOARD_LL = 13;
        public const int WH_MOUSE_LL = 14;

        public const int WM_KEYDOWN = 0x0100;
        public const int WM_KEYUP = 0x0101;
        public const int WM_SYSKEYDOWN = 0x0104;
        public const int WM_SYSKEYUP = 0x0105;

        public const int WM_LBUTTONDOWN = 0x0201;
        public const int WM_LBUTTONUP = 0x0202;
        public const int WM_RBUTTONDOWN = 0x0204;
        public const int WM_RBUTTONUP = 0x0205;
        public const int WM_MBUTTONDOWN = 0x0207;
        public const int WM_MOUSEWHEEL = 0x020A;
        public const int WM_MOUSEHWHEEL = 0x020E;

        public const int VK_SHIFT = 0x10;
        public const int VK_CONTROL = 0x11;
        public const int VK_MENU = 0x12;
        public const int VK_LWIN = 0x5B;
        public const int VK_RWIN = 0x5C;

        public const int ES_PASSWORD = 0x0020;
        public const int GWL_STYLE = -16;

        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;

        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;

        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT { public int X; public int Y; }

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT
        {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx; public int dy; public uint mouseData;
            public uint dwFlags; public uint time; public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk; public ushort wScan; public uint dwFlags;
            public uint time; public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }

        [StructLayout(LayoutKind.Explicit)]
        public struct INPUTUNION
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
            [FieldOffset(0)] public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public uint type; public INPUTUNION u; }

        [StructLayout(LayoutKind.Sequential)]
        public struct GUITHREADINFO
        {
            public int cbSize;
            public int flags;
            public IntPtr hwndActive;
            public IntPtr hwndFocus;
            public IntPtr hwndCapture;
            public IntPtr hwndMenuOwner;
            public IntPtr hwndMoveSize;
            public IntPtr hwndCaret;
            public RECT rcCaret;
        }

        public delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO lpgui);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
        public static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
        public static extern int GetWindowLong32(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetKeyboardState(byte[] lpKeyState);

        [DllImport("user32.dll")]
        public static extern IntPtr GetKeyboardLayout(uint idThread);

        [DllImport("user32.dll")]
        public static extern int ToUnicodeEx(uint wVirtKey, uint wScanCode, byte[] lpKeyState,
            [Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pwszBuff, int cchBuff, uint wFlags, IntPtr dwhkl);

        [DllImport("user32.dll")]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, [MarshalAs(UnmanagedType.Bool)] bool fAttach);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool AllowSetForegroundWindow(int dwProcessId);

        /// <summary>
        /// Windows refuses SetForegroundWindow to a process that does not
        /// already own the foreground, and refuses it silently -- the call
        /// returns and nothing moves. Borrowing the current foreground thread's
        /// input queue for the duration is the documented way around it, and
        /// without it every replay types into whatever window happened to be in
        /// front instead of the one it grounded.
        /// </summary>
        public static bool ForceForeground(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return false;
            if (GetForegroundWindow() == hWnd) return true;
            if (IsIconic(hWnd)) ShowWindow(hWnd, 9 /* SW_RESTORE */);

            uint foregroundProcess;
            uint foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), out foregroundProcess);
            uint currentThread = GetCurrentThreadId();
            bool attached = false;
            try
            {
                try { AllowSetForegroundWindow(-1 /* ASFW_ANY */); } catch (EntryPointNotFoundException) { }
                if (foregroundThread != 0 && foregroundThread != currentThread)
                {
                    attached = AttachThreadInput(currentThread, foregroundThread, true);
                }
                BringWindowToTop(hWnd);
                SetForegroundWindow(hWnd);
            }
            finally
            {
                if (attached) AttachThreadInput(currentThread, foregroundThread, false);
            }

            for (int attempt = 0; attempt < 20; attempt++)
            {
                if (GetForegroundWindow() == hWnd) return true;
                System.Threading.Thread.Sleep(25);
            }
            return GetForegroundWindow() == hWnd;
        }

        public static int GetWindowStyle(IntPtr hWnd)
        {
            if (IntPtr.Size == 8) return (int)GetWindowLongPtr64(hWnd, GWL_STYLE).ToInt64();
            return GetWindowLong32(hWnd, GWL_STYLE);
        }

        public static void MakeDpiAware()
        {
            try
            {
                // Per-monitor v2 keeps physical pixels honest across mixed-DPI
                // displays; the older call is the fallback for older Windows.
                if (SetProcessDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return;
            }
            catch (EntryPointNotFoundException) { }
            catch (DllNotFoundException) { }
            try { SetProcessDPIAware(); } catch (EntryPointNotFoundException) { }
        }

        public static string WindowTitle(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return null;
            StringBuilder builder = new StringBuilder(512);
            int length = GetWindowTextW(hWnd, builder, builder.Capacity);
            if (length <= 0) return null;
            return builder.ToString();
        }

        public static string WindowClass(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return null;
            StringBuilder builder = new StringBuilder(256);
            int length = GetClassNameW(hWnd, builder, builder.Capacity);
            if (length <= 0) return null;
            return builder.ToString();
        }

        public static string ProcessName(IntPtr hWnd)
        {
            if (hWnd == IntPtr.Zero) return null;
            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (processId == 0) return null;
            try
            {
                using (System.Diagnostics.Process process = System.Diagnostics.Process.GetProcessById((int)processId))
                {
                    return process.ProcessName;
                }
            }
            catch (ArgumentException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (System.ComponentModel.Win32Exception) { return null; }
        }
    }

    #endregion

    #region Shared desktop helpers

    /// <summary>Facts about the foreground window that both modes need.</summary>
    internal sealed class ForegroundContext
    {
        public IntPtr Handle;
        public string App;
        public string Title;
        public Native.RECT Bounds;
        public bool HasBounds;

        public static ForegroundContext Capture()
        {
            ForegroundContext context = new ForegroundContext();
            context.Handle = Native.GetForegroundWindow();
            context.App = Native.ProcessName(context.Handle);
            context.Title = Native.WindowTitle(context.Handle);
            Native.RECT rect;
            if (context.Handle != IntPtr.Zero && Native.GetWindowRect(context.Handle, out rect))
            {
                context.Bounds = rect;
                context.HasBounds = true;
            }
            return context;
        }
    }

    /// <summary>
    /// Whether the keyboard focus is sitting in a secret field.
    ///
    /// UI Automation answers this for modern apps and browsers; the classic
    /// ES_PASSWORD window style covers the Win32 controls UIA reports poorly.
    /// A "maybe" is treated as a yes -- the cost of redacting a non-secret is a
    /// slightly vaguer demonstration, and the cost of the reverse is a password
    /// in a file.
    /// </summary>
    internal static class SecretFieldDetector
    {
        public static bool FocusedFieldIsSecret()
        {
            try
            {
                AutomationElement focused = AutomationElement.FocusedElement;
                if (focused != null)
                {
                    if (focused.Current.IsPassword) return true;
                    string automationId = focused.Current.AutomationId;
                    string name = focused.Current.Name;
                    if (LooksSecret(automationId) || LooksSecret(name)) return true;
                }
            }
            catch (ElementNotAvailableException) { }
            catch (InvalidOperationException) { }
            catch (System.Runtime.InteropServices.COMException) { }

            try
            {
                IntPtr foreground = Native.GetForegroundWindow();
                uint processId;
                uint threadId = Native.GetWindowThreadProcessId(foreground, out processId);
                Native.GUITHREADINFO info = new Native.GUITHREADINFO();
                info.cbSize = Marshal.SizeOf(typeof(Native.GUITHREADINFO));
                if (Native.GetGUIThreadInfo(threadId, ref info) && info.hwndFocus != IntPtr.Zero)
                {
                    string className = Native.WindowClass(info.hwndFocus);
                    if (className != null && className.IndexOf("Edit", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        if ((Native.GetWindowStyle(info.hwndFocus) & Native.ES_PASSWORD) != 0) return true;
                    }
                }
            }
            catch (Exception) { }

            return false;
        }

        private static bool LooksSecret(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            string lowered = value.ToLowerInvariant();
            return lowered.Contains("password") || lowered.Contains("passcode")
                || lowered.Contains("secret") || lowered.Contains("api key")
                || lowered.Contains("apikey") || lowered.Contains("token")
                || lowered.Contains("credential") || lowered.Contains("pin code");
        }
    }

    /// <summary>Names a control the way a person would, for the induction prompt.</summary>
    internal sealed class ElementDescriptor
    {
        public string Name;
        public string Role;
        public string AutomationId;
        public string ClassName;
        public string Value;
        public bool IsPassword;
        public bool IsEnabled;
        public bool IsOffscreen;
        public int Left, Top, Width, Height;
        public bool HasBounds;

        public static ElementDescriptor FromElement(AutomationElement element, bool includeValue)
        {
            if (element == null) return null;
            ElementDescriptor descriptor = new ElementDescriptor();
            try
            {
                AutomationElement.AutomationElementInformation current = element.Current;
                descriptor.Name = Trim(current.Name);
                descriptor.Role = current.ControlType != null ? current.ControlType.ProgrammaticName : null;
                if (descriptor.Role != null && descriptor.Role.StartsWith("ControlType.", StringComparison.Ordinal))
                {
                    descriptor.Role = descriptor.Role.Substring("ControlType.".Length);
                }
                descriptor.AutomationId = Trim(current.AutomationId);
                descriptor.ClassName = Trim(current.ClassName);
                descriptor.IsPassword = current.IsPassword;
                descriptor.IsEnabled = current.IsEnabled;
                descriptor.IsOffscreen = current.IsOffscreen;
                System.Windows.Rect rect = current.BoundingRectangle;
                if (!rect.IsEmpty && !double.IsInfinity(rect.Width) && !double.IsInfinity(rect.Height))
                {
                    descriptor.Left = (int)Math.Round(rect.Left);
                    descriptor.Top = (int)Math.Round(rect.Top);
                    descriptor.Width = (int)Math.Round(rect.Width);
                    descriptor.Height = (int)Math.Round(rect.Height);
                    descriptor.HasBounds = descriptor.Width > 0 && descriptor.Height > 0;
                }
                if (includeValue && !descriptor.IsPassword)
                {
                    object pattern;
                    if (element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
                    {
                        string value = ((ValuePattern)pattern).Current.Value;
                        descriptor.Value = Trim(value);
                    }
                }
            }
            catch (ElementNotAvailableException) { return null; }
            catch (InvalidOperationException) { return null; }
            catch (System.Runtime.InteropServices.COMException) { return null; }
            return descriptor;
        }

        private static string Trim(string value)
        {
            if (string.IsNullOrEmpty(value)) return null;
            string trimmed = value.Trim();
            if (trimmed.Length == 0) return null;
            if (trimmed.Length > 160) trimmed = trimmed.Substring(0, 160);
            return trimmed;
        }

        /// <summary>A short human phrase: 'button labeled "Search"'.</summary>
        public string Describe()
        {
            string role = string.IsNullOrEmpty(Role) ? "control" : Role.ToLowerInvariant();
            if (!string.IsNullOrEmpty(Name)) return role + " labeled \"" + Name + "\"";
            if (!string.IsNullOrEmpty(AutomationId)) return role + " with id \"" + AutomationId + "\"";
            if (!string.IsNullOrEmpty(ClassName)) return role + " of class \"" + ClassName + "\"";
            return role;
        }

        public Dictionary<string, object> ToMap()
        {
            Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
            if (Name != null) map["name"] = Name;
            if (Role != null) map["role"] = Role;
            if (AutomationId != null) map["automationId"] = AutomationId;
            if (ClassName != null) map["className"] = ClassName;
            if (Value != null) map["value"] = Value;
            if (IsPassword) map["isPassword"] = true;
            map["enabled"] = IsEnabled;
            if (IsOffscreen) map["offscreen"] = true;
            if (HasBounds)
            {
                map["left"] = Left; map["top"] = Top;
                map["width"] = Width; map["height"] = Height;
            }
            return map;
        }
    }

    /// <summary>Screen capture, scaled down before it ever touches disk.</summary>
    internal static class ScreenCapture
    {
        public static Rectangle VirtualBounds()
        {
            return SystemInformation.VirtualScreen;
        }

        public static bool CaptureToFile(Rectangle region, string path, int maxWidth, long jpegQuality)
        {
            if (region.Width <= 0 || region.Height <= 0) return false;
            try
            {
                using (Bitmap raw = new Bitmap(region.Width, region.Height, PixelFormat.Format24bppRgb))
                {
                    using (Graphics graphics = Graphics.FromImage(raw))
                    {
                        graphics.CopyFromScreen(region.Left, region.Top, 0, 0, new Size(region.Width, region.Height), CopyPixelOperation.SourceCopy);
                    }
                    Bitmap output = raw;
                    bool scaled = false;
                    if (maxWidth > 0 && region.Width > maxWidth)
                    {
                        int height = Math.Max(1, (int)Math.Round((double)region.Height * maxWidth / region.Width));
                        Bitmap resized = new Bitmap(maxWidth, height, PixelFormat.Format24bppRgb);
                        using (Graphics graphics = Graphics.FromImage(resized))
                        {
                            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                            graphics.DrawImage(raw, 0, 0, maxWidth, height);
                        }
                        output = resized;
                        scaled = true;
                    }
                    try
                    {
                        SaveJpeg(output, path, jpegQuality);
                    }
                    finally
                    {
                        if (scaled) output.Dispose();
                    }
                }
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static void SaveJpeg(Bitmap bitmap, string path, long quality)
        {
            ImageCodecInfo encoder = null;
            foreach (ImageCodecInfo candidate in ImageCodecInfo.GetImageEncoders())
            {
                if (candidate.FormatID == ImageFormat.Jpeg.Guid) { encoder = candidate; break; }
            }
            if (encoder == null) { bitmap.Save(path, ImageFormat.Png); return; }
            using (EncoderParameters parameters = new EncoderParameters(1))
            {
                parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                bitmap.Save(path, encoder, parameters);
            }
        }
    }

    #endregion

    #region Recorder

    /// <summary>
    /// One line of the demonstration log. Field names match the shape the
    /// Breadboard timeline builder expects, so the file is the contract.
    /// </summary>
    internal sealed class RecordedEvent
    {
        public string Type;
        public long TimestampMs;
        public string Source;
        public string App;
        public string WindowTitle;
        public string Target;
        public string Detail;
        public double? X;
        public double? Y;
        public int? ScreenWidth;
        public int? ScreenHeight;
        public int? KeyCode;
        public List<object> Modifiers;
        public string Importance;
        public string VisualContextRef;
        public bool Redacted;
        public Dictionary<string, object> Element;

        public string ToJsonLine()
        {
            Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
            map["type"] = Type;
            map["timestampMs"] = TimestampMs;
            if (Source != null) map["source"] = Source;
            if (App != null) map["app"] = App;
            if (WindowTitle != null) map["windowTitle"] = WindowTitle;
            if (Target != null) map["target"] = Target;
            if (Detail != null) map["detail"] = Detail;
            if (X.HasValue) map["x"] = X.Value;
            if (Y.HasValue) map["y"] = Y.Value;
            if (ScreenWidth.HasValue) map["screenWidth"] = ScreenWidth.Value;
            if (ScreenHeight.HasValue) map["screenHeight"] = ScreenHeight.Value;
            if (KeyCode.HasValue) map["keyCode"] = KeyCode.Value;
            if (Modifiers != null && Modifiers.Count > 0) map["modifiers"] = Modifiers;
            if (Importance != null) map["importance"] = Importance;
            if (VisualContextRef != null) map["visualContextRef"] = VisualContextRef;
            if (Redacted) map["redacted"] = true;
            if (Element != null && Element.Count > 0) map["element"] = Element;
            return Json.Write(map);
        }
    }

    /// <summary>A hook sample, parked for the worker so the callback stays fast.</summary>
    internal sealed class PendingSample
    {
        public string Kind;         // "mouse_down" | "mouse_up" | "wheel" | "key_down"
        public long TimestampMs;
        public int X, Y;
        public int Button;          // 0 left, 1 right, 2 middle
        public int WheelDelta;
        public bool Horizontal;
        public uint VirtualKey;
        public uint ScanCode;
        /// <summary>
        /// Which modifiers were held at the instant of the keystroke.
        ///
        /// Read in the hook rather than on the worker that handles the sample.
        /// The worker runs milliseconds later, by which time a fast Ctrl+A has
        /// already released its Ctrl -- and the sample is then indistinguishable
        /// from someone typing the letter "a", which is how a shortcut ends up
        /// recorded as text the workflow will faithfully retype.
        /// </summary>
        public List<object> Modifiers;
    }

    internal sealed class Recorder
    {
        private readonly string outputDirectory;
        private readonly string eventLogPath;
        private readonly string framesDirectory;
        private readonly int maxFrames;
        private readonly int frameMaxWidth;
        private readonly bool captureFrames;

        private readonly object writeLock = new object();
        private StreamWriter writer;

        private readonly Queue<PendingSample> queue = new Queue<PendingSample>();
        private readonly object queueLock = new object();
        private readonly AutoResetEvent queueSignal = new AutoResetEvent(false);

        private volatile bool running = true;
        private volatile bool paused;
        private int frameCount;
        private long sequence;

        // Aggregated typing. Kept only on the worker thread.
        private StringBuilder typingBuffer = new StringBuilder();
        private long typingStartedMs;
        private bool typingSecret;
        private string typingApp;
        private string typingWindowTitle;
        private string typingTarget;

        private string lastApp;
        private string lastWindowTitle;

        private Native.HookProc mouseProc;
        private Native.HookProc keyboardProc;
        private IntPtr mouseHook = IntPtr.Zero;
        private IntPtr keyboardHook = IntPtr.Zero;

        private long lastMoveSampleMs;
        private int lastMoveX = int.MinValue, lastMoveY = int.MinValue;
        private long lastClickMs;
        private int lastClickX, lastClickY;
        private int lastClickButton = -1;

        public Recorder(string outputDirectory, int maxFrames, int frameMaxWidth, bool captureFrames)
        {
            this.outputDirectory = outputDirectory;
            this.eventLogPath = Path.Combine(outputDirectory, "events.jsonl");
            this.framesDirectory = Path.Combine(outputDirectory, "frames");
            this.maxFrames = maxFrames;
            this.frameMaxWidth = frameMaxWidth;
            this.captureFrames = captureFrames;
        }

        private static long NowMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }

        public int Run()
        {
            Directory.CreateDirectory(outputDirectory);
            if (captureFrames) Directory.CreateDirectory(framesDirectory);
            writer = new StreamWriter(new FileStream(eventLogPath, FileMode.Create, FileAccess.Write, FileShare.Read), new UTF8Encoding(false));
            writer.AutoFlush = true;

            Rectangle virtualScreen = ScreenCapture.VirtualBounds();
            ForegroundContext initial = ForegroundContext.Capture();
            lastApp = initial.App;
            lastWindowTitle = initial.Title;

            RecordedEvent started = NewEvent("recording_started", NowMs());
            started.Source = "system";
            started.Detail = "Breadboard demonstration capture started";
            started.Importance = "high";
            started.ScreenWidth = virtualScreen.Width;
            started.ScreenHeight = virtualScreen.Height;
            started.App = initial.App;
            started.WindowTitle = initial.Title;
            Write(started);

            RecordedEvent focus = NewEvent("window_focused", NowMs());
            focus.Source = "system";
            focus.App = initial.App;
            focus.WindowTitle = initial.Title;
            focus.Detail = "Foreground window at capture start";
            focus.Importance = "medium";
            Write(focus);

            Thread worker = new Thread(WorkerLoop);
            worker.SetApartmentState(ApartmentState.MTA);
            worker.IsBackground = true;
            worker.Start();

            Thread commands = new Thread(CommandLoop);
            commands.IsBackground = true;
            commands.Start();

            Thread focusWatcher = new Thread(FocusWatchLoop);
            focusWatcher.SetApartmentState(ApartmentState.MTA);
            focusWatcher.IsBackground = true;
            focusWatcher.Start();

            mouseProc = MouseHookCallback;
            keyboardProc = KeyboardHookCallback;
            IntPtr module = Native.GetModuleHandle(null);
            mouseHook = Native.SetWindowsHookEx(Native.WH_MOUSE_LL, mouseProc, module, 0);
            keyboardHook = Native.SetWindowsHookEx(Native.WH_KEYBOARD_LL, keyboardProc, module, 0);
            if (mouseHook == IntPtr.Zero || keyboardHook == IntPtr.Zero)
            {
                Console.Error.WriteLine("Breadboard teach recorder could not install input hooks.");
                Cleanup();
                return 3;
            }

            // The helper reports readiness on stdout so the service does not have
            // to guess when the hooks are live.
            Console.Out.WriteLine(Json.Write(NewStatus("ready")));
            Console.Out.Flush();

            Application.Run();

            Cleanup();
            return 0;
        }

        private Dictionary<string, object> NewStatus(string state)
        {
            Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
            map["status"] = state;
            map["timestampMs"] = NowMs();
            map["eventLogPath"] = eventLogPath;
            if (captureFrames) map["framesDirectory"] = framesDirectory;
            Rectangle bounds = ScreenCapture.VirtualBounds();
            map["screenWidth"] = bounds.Width;
            map["screenHeight"] = bounds.Height;
            return map;
        }

        private void Cleanup()
        {
            running = false;
            queueSignal.Set();
            if (mouseHook != IntPtr.Zero) { Native.UnhookWindowsHookEx(mouseHook); mouseHook = IntPtr.Zero; }
            if (keyboardHook != IntPtr.Zero) { Native.UnhookWindowsHookEx(keyboardHook); keyboardHook = IntPtr.Zero; }
            FlushTyping(NowMs());
            RecordedEvent stopped = NewEvent("recording_stopped", NowMs());
            stopped.Source = "system";
            stopped.Importance = "high";
            stopped.Detail = "Breadboard demonstration capture stopped";
            Write(stopped);
            lock (writeLock)
            {
                if (writer != null) { writer.Flush(); writer.Dispose(); writer = null; }
            }
        }

        private RecordedEvent NewEvent(string type, long timestampMs)
        {
            RecordedEvent recorded = new RecordedEvent();
            recorded.Type = type;
            recorded.TimestampMs = timestampMs;
            return recorded;
        }

        private void Write(RecordedEvent recorded)
        {
            lock (writeLock)
            {
                if (writer == null) return;
                writer.WriteLine(recorded.ToJsonLine());
            }
        }

        #region hooks

        private IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && !paused)
            {
                try
                {
                    int message = wParam.ToInt32();
                    Native.MSLLHOOKSTRUCT data = (Native.MSLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.MSLLHOOKSTRUCT));
                    long now = NowMs();
                    switch (message)
                    {
                        case Native.WM_LBUTTONDOWN: Enqueue(MouseSample("mouse_down", now, data, 0)); break;
                        case Native.WM_RBUTTONDOWN: Enqueue(MouseSample("mouse_down", now, data, 1)); break;
                        case Native.WM_MBUTTONDOWN: Enqueue(MouseSample("mouse_down", now, data, 2)); break;
                        case Native.WM_LBUTTONUP: Enqueue(MouseSample("mouse_up", now, data, 0)); break;
                        case Native.WM_MOUSEWHEEL:
                        case Native.WM_MOUSEHWHEEL:
                            {
                                PendingSample sample = MouseSample("wheel", now, data, -1);
                                sample.WheelDelta = (short)((data.mouseData >> 16) & 0xffff);
                                sample.Horizontal = message == Native.WM_MOUSEHWHEEL;
                                Enqueue(sample);
                                break;
                            }
                    }
                }
                catch (Exception)
                {
                    // A hook callback that throws is a hook Windows removes.
                }
            }
            return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        private static PendingSample MouseSample(string kind, long now, Native.MSLLHOOKSTRUCT data, int button)
        {
            PendingSample sample = new PendingSample();
            sample.Kind = kind;
            sample.TimestampMs = now;
            sample.X = data.pt.X;
            sample.Y = data.pt.Y;
            sample.Button = button;
            sample.Modifiers = CurrentModifiers();
            return sample;
        }

        private IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && !paused)
            {
                try
                {
                    int message = wParam.ToInt32();
                    if (message == Native.WM_KEYDOWN || message == Native.WM_SYSKEYDOWN)
                    {
                        Native.KBDLLHOOKSTRUCT data = (Native.KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(Native.KBDLLHOOKSTRUCT));
                        PendingSample sample = new PendingSample();
                        sample.Kind = "key_down";
                        sample.TimestampMs = NowMs();
                        sample.VirtualKey = data.vkCode;
                        sample.ScanCode = data.scanCode;
                        sample.Modifiers = CurrentModifiers();
                        Enqueue(sample);
                    }
                }
                catch (Exception) { }
            }
            return Native.CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        private void Enqueue(PendingSample sample)
        {
            lock (queueLock)
            {
                // A bounded buffer: a runaway input stream must not grow without
                // limit inside a process that is holding an input hook.
                if (queue.Count > 4096) return;
                queue.Enqueue(sample);
            }
            queueSignal.Set();
        }

        #endregion

        #region worker

        private void WorkerLoop()
        {
            while (running)
            {
                PendingSample sample = null;
                lock (queueLock)
                {
                    if (queue.Count > 0) sample = queue.Dequeue();
                }
                if (sample == null)
                {
                    // Idle typing still has to land: a pause in typing ends the burst.
                    FlushTypingIfIdle();
                    queueSignal.WaitOne(200);
                    continue;
                }
                try { Handle(sample); }
                catch (Exception) { /* one lost event, never a lost recording */ }
            }
        }

        private void Handle(PendingSample sample)
        {
            switch (sample.Kind)
            {
                case "mouse_down": HandleMouseDown(sample); break;
                case "wheel": HandleWheel(sample); break;
                case "key_down": HandleKeyDown(sample); break;
            }
        }

        private void HandleMouseDown(PendingSample sample)
        {
            FlushTyping(sample.TimestampMs);
            ForegroundContext context = ForegroundContext.Capture();
            NoteFocusChange(context, sample.TimestampMs);

            ElementDescriptor descriptor = ResolveElementAt(sample.X, sample.Y);
            Rectangle virtualScreen = ScreenCapture.VirtualBounds();

            bool isDouble = sample.Button == lastClickButton
                && sample.TimestampMs - lastClickMs <= SystemInformation.DoubleClickTime
                && Math.Abs(sample.X - lastClickX) <= 4 && Math.Abs(sample.Y - lastClickY) <= 4;
            lastClickMs = sample.TimestampMs;
            lastClickX = sample.X; lastClickY = sample.Y; lastClickButton = sample.Button;

            string type;
            if (isDouble) type = "mouse_double_click";
            else if (sample.Button == 1) type = "mouse_right_click";
            else if (sample.Button == 2) type = "mouse_middle_click";
            else type = "mouse_click";

            RecordedEvent recorded = NewEvent(type, sample.TimestampMs);
            recorded.Source = "input_hook";
            recorded.App = context.App;
            recorded.WindowTitle = context.Title;
            recorded.X = sample.X;
            recorded.Y = sample.Y;
            recorded.ScreenWidth = virtualScreen.Width;
            recorded.ScreenHeight = virtualScreen.Height;
            recorded.Importance = "high";
            recorded.Modifiers = sample.Modifiers;
            if (descriptor != null)
            {
                recorded.Target = descriptor.Describe();
                recorded.Element = descriptor.ToMap();
            }
            recorded.VisualContextRef = CaptureFrame(context, sample.TimestampMs, "action");
            Write(recorded);

            // A settled frame a moment later is what shows the click's effect;
            // it is the evidence a success criterion is read from.
            if (captureFrames)
            {
                long stamp = sample.TimestampMs;
                ThreadPool.QueueUserWorkItem(delegate
                {
                    Thread.Sleep(450);
                    if (!running || paused) return;
                    try
                    {
                        ForegroundContext after = ForegroundContext.Capture();
                        string reference = CaptureFrame(after, NowMs(), "settled");
                        if (reference == null) return;
                        RecordedEvent settled = NewEvent("visual_state", NowMs());
                        settled.Source = "capture";
                        settled.App = after.App;
                        settled.WindowTitle = after.Title;
                        settled.Detail = "State after the action at " + stamp.ToString(CultureInfo.InvariantCulture);
                        settled.Importance = "low";
                        settled.VisualContextRef = reference;
                        Write(settled);
                    }
                    catch (Exception) { }
                });
            }
        }

        private void HandleWheel(PendingSample sample)
        {
            FlushTyping(sample.TimestampMs);
            // Scrolling is continuous; one event per burst is the useful grain.
            if (sample.TimestampMs - lastMoveSampleMs < 400
                && Math.Abs(sample.X - lastMoveX) < 40 && Math.Abs(sample.Y - lastMoveY) < 40)
            {
                return;
            }
            lastMoveSampleMs = sample.TimestampMs;
            lastMoveX = sample.X; lastMoveY = sample.Y;

            ForegroundContext context = ForegroundContext.Capture();
            NoteFocusChange(context, sample.TimestampMs);
            RecordedEvent recorded = NewEvent("scroll", sample.TimestampMs);
            recorded.Source = "input_hook";
            recorded.App = context.App;
            recorded.WindowTitle = context.Title;
            recorded.X = sample.X;
            recorded.Y = sample.Y;
            recorded.Importance = "medium";
            recorded.Detail = (sample.Horizontal ? "horizontal " : "")
                + (sample.WheelDelta < 0 ? "scrolled down" : "scrolled up");
            ElementDescriptor descriptor = ResolveElementAt(sample.X, sample.Y);
            if (descriptor != null) recorded.Target = descriptor.Describe();
            Write(recorded);
        }

        private void HandleKeyDown(PendingSample sample)
        {
            ForegroundContext context = ForegroundContext.Capture();
            NoteFocusChange(context, sample.TimestampMs);

            List<object> modifiers = sample.Modifiers ?? CurrentModifiers();
            bool control = modifiers.Contains("control");
            bool alt = modifiers.Contains("alt");
            bool win = modifiers.Contains("win");
            uint key = sample.VirtualKey;

            // A modifier combination is a shortcut, not typing.
            if (control || alt || win)
            {
                if (key == Native.VK_SHIFT || key == Native.VK_CONTROL || key == Native.VK_MENU
                    || key == Native.VK_LWIN || key == Native.VK_RWIN) return;
                FlushTyping(sample.TimestampMs);
                RecordedEvent shortcut = NewEvent("shortcut", sample.TimestampMs);
                shortcut.Source = "input_hook";
                shortcut.App = context.App;
                shortcut.WindowTitle = context.Title;
                shortcut.KeyCode = (int)key;
                shortcut.Modifiers = modifiers;
                shortcut.Detail = DescribeShortcut(modifiers, key);
                shortcut.Importance = "high";
                Write(shortcut);
                return;
            }

            string named = NamedKey(key);
            if (named != null)
            {
                FlushTyping(sample.TimestampMs);
                RecordedEvent keyPress = NewEvent("key_press", sample.TimestampMs);
                keyPress.Source = "input_hook";
                keyPress.App = context.App;
                keyPress.WindowTitle = context.Title;
                keyPress.KeyCode = (int)key;
                keyPress.Detail = named;
                keyPress.Modifiers = modifiers.Count > 0 ? modifiers : null;
                keyPress.Importance = (named == "Enter" || named == "Tab" || named == "Escape") ? "high" : "low";
                Write(keyPress);
                return;
            }

            if (key == Native.VK_SHIFT || key == Native.VK_CONTROL || key == Native.VK_MENU) return;

            string character = TranslateCharacter(sample.VirtualKey, sample.ScanCode);
            if (string.IsNullOrEmpty(character)) return;

            if (typingBuffer.Length == 0)
            {
                typingStartedMs = sample.TimestampMs;
                typingApp = context.App;
                typingWindowTitle = context.Title;
                typingSecret = SecretFieldDetector.FocusedFieldIsSecret();
                ElementDescriptor descriptor = ResolveFocusedElement();
                typingTarget = descriptor != null ? descriptor.Describe() : null;
            }
            if (typingBuffer.Length < 4096) typingBuffer.Append(character);
            lastTypingMs = sample.TimestampMs;
        }

        private long lastTypingMs;

        private void FlushTypingIfIdle()
        {
            if (typingBuffer.Length == 0) return;
            if (NowMs() - lastTypingMs < 1200) return;
            FlushTyping(NowMs());
        }

        private void FlushTyping(long timestampMs)
        {
            if (typingBuffer.Length == 0) return;
            string text = typingBuffer.ToString();
            typingBuffer = new StringBuilder();

            RecordedEvent recorded = NewEvent("text_input", typingStartedMs > 0 ? typingStartedMs : timestampMs);
            recorded.Source = "input_hook";
            recorded.App = typingApp;
            recorded.WindowTitle = typingWindowTitle;
            recorded.Target = typingTarget;
            recorded.Importance = "high";
            if (typingSecret)
            {
                // A secret field's contents never reach the log, in any form.
                recorded.Redacted = true;
                recorded.Detail = "[redacted secret, " + text.Length.ToString(CultureInfo.InvariantCulture) + " characters]";
            }
            else
            {
                recorded.Detail = text;
            }
            Write(recorded);
            typingSecret = false;
            typingTarget = null;
            typingStartedMs = 0;
        }

        private void NoteFocusChange(ForegroundContext context, long timestampMs)
        {
            bool appChanged = !string.Equals(context.App, lastApp, StringComparison.Ordinal);
            bool titleChanged = !string.Equals(context.Title, lastWindowTitle, StringComparison.Ordinal);
            if (!appChanged && !titleChanged) return;
            FlushTyping(timestampMs);
            RecordedEvent recorded = NewEvent(appChanged ? "app_switch" : "window_focused", timestampMs);
            recorded.Source = "focus_watch";
            recorded.App = context.App;
            recorded.WindowTitle = context.Title;
            recorded.Importance = appChanged ? "high" : "medium";
            recorded.Detail = appChanged
                ? "Switched to " + (context.App ?? "another application")
                : "Window changed to " + (context.Title ?? "an untitled window");
            if (appChanged) recorded.VisualContextRef = CaptureFrame(context, timestampMs, "context");
            Write(recorded);
            lastApp = context.App;
            lastWindowTitle = context.Title;
        }

        private void FocusWatchLoop()
        {
            while (running)
            {
                Thread.Sleep(400);
                if (!running || paused) continue;
                try
                {
                    ForegroundContext context = ForegroundContext.Capture();
                    NoteFocusChange(context, NowMs());
                }
                catch (Exception) { }
            }
        }

        private string CaptureFrame(ForegroundContext context, long timestampMs, string kind)
        {
            if (!captureFrames) return null;
            if (Interlocked.Increment(ref frameCount) > maxFrames) return null;
            Rectangle region = ScreenCapture.VirtualBounds();
            if (context != null && context.HasBounds)
            {
                Rectangle windowRect = new Rectangle(
                    context.Bounds.Left, context.Bounds.Top,
                    context.Bounds.Right - context.Bounds.Left,
                    context.Bounds.Bottom - context.Bounds.Top);
                windowRect.Intersect(region);
                if (windowRect.Width > 200 && windowRect.Height > 150) region = windowRect;
            }
            long index = Interlocked.Increment(ref sequence);
            string name = kind + "-" + timestampMs.ToString(CultureInfo.InvariantCulture)
                + "-" + index.ToString(CultureInfo.InvariantCulture) + ".jpg";
            string path = Path.Combine(framesDirectory, name);
            if (!ScreenCapture.CaptureToFile(region, path, frameMaxWidth, 78L)) return null;
            return "frames/" + name;
        }

        private static ElementDescriptor ResolveElementAt(int x, int y)
        {
            try
            {
                AutomationElement element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
                return ElementDescriptor.FromElement(element, false);
            }
            catch (Exception) { return null; }
        }

        private static ElementDescriptor ResolveFocusedElement()
        {
            try
            {
                return ElementDescriptor.FromElement(AutomationElement.FocusedElement, false);
            }
            catch (Exception) { return null; }
        }

        private static List<object> CurrentModifiers()
        {
            List<object> modifiers = new List<object>();
            if ((Native.GetAsyncKeyState(Native.VK_CONTROL) & 0x8000) != 0) modifiers.Add("control");
            if ((Native.GetAsyncKeyState(Native.VK_MENU) & 0x8000) != 0) modifiers.Add("alt");
            if ((Native.GetAsyncKeyState(Native.VK_SHIFT) & 0x8000) != 0) modifiers.Add("shift");
            if ((Native.GetAsyncKeyState(Native.VK_LWIN) & 0x8000) != 0
                || (Native.GetAsyncKeyState(Native.VK_RWIN) & 0x8000) != 0) modifiers.Add("win");
            return modifiers;
        }

        private static string DescribeShortcut(List<object> modifiers, uint key)
        {
            StringBuilder builder = new StringBuilder();
            foreach (object modifier in modifiers)
            {
                string text = modifier as string;
                if (text == null) continue;
                builder.Append(char.ToUpperInvariant(text[0]));
                builder.Append(text.Substring(1));
                builder.Append('+');
            }
            string named = NamedKey(key);
            if (named != null) { builder.Append(named); return builder.ToString(); }
            builder.Append(KeyLabel(key));
            return builder.ToString();
        }

        private static string KeyLabel(uint key)
        {
            try { return ((Keys)key).ToString(); }
            catch (Exception) { return "Key" + key.ToString(CultureInfo.InvariantCulture); }
        }

        private static string NamedKey(uint key)
        {
            switch (key)
            {
                case 0x0D: return "Enter";
                case 0x09: return "Tab";
                case 0x1B: return "Escape";
                case 0x08: return "Backspace";
                case 0x2E: return "Delete";
                case 0x26: return "ArrowUp";
                case 0x28: return "ArrowDown";
                case 0x25: return "ArrowLeft";
                case 0x27: return "ArrowRight";
                case 0x24: return "Home";
                case 0x23: return "End";
                case 0x21: return "PageUp";
                case 0x22: return "PageDown";
                case 0x2D: return "Insert";
                default:
                    if (key >= 0x70 && key <= 0x7B) return "F" + (key - 0x6F).ToString(CultureInfo.InvariantCulture);
                    return null;
            }
        }

        private static string TranslateCharacter(uint virtualKey, uint scanCode)
        {
            try
            {
                // Injected Unicode (VK_PACKET, and the vkCode-less form the
                // SendInput unicode flag produces) carries the character in the
                // scan code. Running that through the layout tables would decode
                // it as whatever key sits at that scan position instead, which is
                // how an on-screen keyboard, an IME, or a replay driving its own
                // recorder ends up logging nonsense text.
                if (virtualKey == 0 || virtualKey == 0xE7)
                {
                    if (scanCode == 0) return null;
                    char injected = (char)scanCode;
                    if (char.IsControl(injected)) return null;
                    return injected.ToString();
                }
                IntPtr foreground = Native.GetForegroundWindow();
                uint processId;
                uint threadId = Native.GetWindowThreadProcessId(foreground, out processId);
                IntPtr layout = Native.GetKeyboardLayout(threadId);
                byte[] state = new byte[256];
                Native.GetKeyboardState(state);
                StringBuilder buffer = new StringBuilder(8);
                // Bit 2 of wFlags keeps the kernel's dead-key state untouched, so
                // reading a character here cannot corrupt the user's next keystroke.
                int result = Native.ToUnicodeEx(virtualKey, scanCode, state, buffer, buffer.Capacity, 4, layout);
                if (result <= 0) return null;
                string text = buffer.ToString(0, Math.Min(result, buffer.Length));
                foreach (char c in text)
                {
                    if (char.IsControl(c)) return null;
                }
                return text;
            }
            catch (Exception) { return null; }
        }

        #endregion

        #region commands

        private void CommandLoop()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    string command = line.Trim().ToLowerInvariant();
                    if (command == "pause")
                    {
                        if (!paused)
                        {
                            FlushTyping(NowMs());
                            paused = true;
                            RecordedEvent recorded = NewEvent("recording_paused", NowMs());
                            recorded.Source = "system";
                            recorded.Importance = "medium";
                            Write(recorded);
                        }
                        Respond("paused");
                    }
                    else if (command == "resume")
                    {
                        if (paused)
                        {
                            paused = false;
                            RecordedEvent recorded = NewEvent("recording_resumed", NowMs());
                            recorded.Source = "system";
                            recorded.Importance = "medium";
                            Write(recorded);
                        }
                        Respond("recording");
                    }
                    else if (command == "stop")
                    {
                        Respond("stopping");
                        break;
                    }
                }
            }
            catch (Exception) { }
            running = false;
            Application.Exit();
            // A recorder holding global input hooks is the last process that
            // should be allowed to linger, so an unresponsive message loop is
            // given a deadline rather than the benefit of the doubt.
            ThreadPool.QueueUserWorkItem(delegate
            {
                Thread.Sleep(4000);
                try { Cleanup(); } catch (Exception) { }
                Environment.Exit(0);
            });
        }

        private void Respond(string state)
        {
            try
            {
                Console.Out.WriteLine(Json.Write(NewStatus(state)));
                Console.Out.Flush();
            }
            catch (Exception) { }
        }

        #endregion
    }

    #endregion

    #region Controller

    /// <summary>
    /// The replay side of the same abstraction: observe the desktop, then act on
    /// a target the caller names in words. Coordinates are resolved here, at
    /// replay time, from the live accessibility tree -- never replayed from the
    /// demonstration.
    /// </summary>
    internal sealed class Controller
    {
        private readonly Dictionary<string, ElementHandle> handles = new Dictionary<string, ElementHandle>(StringComparer.Ordinal);
        private int handleSequence;

        private sealed class ElementHandle
        {
            public AutomationElement Element;
            public ElementDescriptor Descriptor;
        }

        public int Run()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null)
            {
                if (line.Trim().Length == 0) continue;
                Dictionary<string, object> response;
                string id = null;
                try
                {
                    Dictionary<string, object> command = Json.Parse(line) as Dictionary<string, object>;
                    if (command == null) throw new FormatException("A command must be a JSON object.");
                    id = Json.GetString(command, "id");
                    response = Dispatch(command);
                }
                catch (Exception error)
                {
                    response = new Dictionary<string, object>(StringComparer.Ordinal);
                    response["ok"] = false;
                    response["error"] = error.Message;
                }
                if (id != null) response["id"] = id;
                Console.Out.WriteLine(Json.Write(response));
                Console.Out.Flush();
                object shouldExit;
                if (response.TryGetValue("exit", out shouldExit) && shouldExit is bool && (bool)shouldExit) break;
            }
            return 0;
        }

        private Dictionary<string, object> Dispatch(Dictionary<string, object> command)
        {
            string op = Json.GetString(command, "op");
            if (op == null) throw new FormatException("A command needs an 'op'.");
            switch (op)
            {
                case "ping": return Ok(null);
                case "exit": { Dictionary<string, object> response = Ok(null); response["exit"] = true; return response; }
                case "observe": return Observe(command);
                case "click": return Click(command);
                case "type": return Type(command);
                case "key": return Key(command);
                case "scroll": return Scroll(command);
                case "focus_window": return FocusWindow(command);
                case "screenshot": return Screenshot(command);
                default: throw new FormatException("Unknown op '" + op + "'.");
            }
        }

        private static Dictionary<string, object> Ok(Dictionary<string, object> payload)
        {
            Dictionary<string, object> response = payload ?? new Dictionary<string, object>(StringComparer.Ordinal);
            response["ok"] = true;
            return response;
        }

        #region observe

        private Dictionary<string, object> Observe(Dictionary<string, object> command)
        {
            int maxElements = (int)(Json.GetNumber(command, "maxElements") ?? 220);
            bool includeAllWindows = Json.GetBool(command, "includeAllWindows", false);

            handles.Clear();
            ForegroundContext context = ForegroundContext.Capture();
            List<object> elements = new List<object>();

            AutomationElement root = null;
            try
            {
                if (context.Handle != IntPtr.Zero) root = AutomationElement.FromHandle(context.Handle);
            }
            catch (Exception) { root = null; }
            if (root == null) root = AutomationElement.RootElement;

            CollectInteractive(root, elements, maxElements);

            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            Dictionary<string, object> foreground = new Dictionary<string, object>(StringComparer.Ordinal);
            if (context.App != null) foreground["app"] = context.App;
            if (context.Title != null) foreground["windowTitle"] = context.Title;
            if (context.HasBounds)
            {
                foreground["left"] = context.Bounds.Left;
                foreground["top"] = context.Bounds.Top;
                foreground["width"] = context.Bounds.Right - context.Bounds.Left;
                foreground["height"] = context.Bounds.Bottom - context.Bounds.Top;
            }
            payload["foreground"] = foreground;

            Rectangle bounds = ScreenCapture.VirtualBounds();
            Dictionary<string, object> screen = new Dictionary<string, object>(StringComparer.Ordinal);
            screen["width"] = bounds.Width;
            screen["height"] = bounds.Height;
            payload["screen"] = screen;
            payload["elements"] = elements;

            if (includeAllWindows) payload["windows"] = ListWindows();

            string screenshotPath = Json.GetString(command, "screenshotPath");
            if (screenshotPath != null)
            {
                int maxWidth = (int)(Json.GetNumber(command, "screenshotMaxWidth") ?? 1280);
                Rectangle region = bounds;
                if (context.HasBounds)
                {
                    Rectangle windowRect = new Rectangle(context.Bounds.Left, context.Bounds.Top,
                        context.Bounds.Right - context.Bounds.Left, context.Bounds.Bottom - context.Bounds.Top);
                    windowRect.Intersect(bounds);
                    if (windowRect.Width > 200 && windowRect.Height > 150) region = windowRect;
                }
                if (ScreenCapture.CaptureToFile(region, screenshotPath, maxWidth, 80L)) payload["screenshotPath"] = screenshotPath;
            }

            return Ok(payload);
        }

        /// <summary>
        /// A breadth-first sweep of the control tree, keeping what a person could
        /// act on. Bounded on both breadth and total count: an accessibility tree
        /// can be enormous, and an unbounded walk is how a replay hangs.
        /// </summary>
        private void CollectInteractive(AutomationElement root, List<object> elements, int maxElements)
        {
            Queue<KeyValuePair<AutomationElement, int>> pending = new Queue<KeyValuePair<AutomationElement, int>>();
            pending.Enqueue(new KeyValuePair<AutomationElement, int>(root, 0));
            int visited = 0;
            while (pending.Count > 0 && elements.Count < maxElements && visited < 4000)
            {
                KeyValuePair<AutomationElement, int> entry = pending.Dequeue();
                AutomationElement element = entry.Key;
                int depth = entry.Value;
                visited++;

                ElementDescriptor descriptor = ElementDescriptor.FromElement(element, true);
                if (descriptor != null && IsWorthReporting(descriptor))
                {
                    handleSequence++;
                    string reference = "e" + handleSequence.ToString(CultureInfo.InvariantCulture);
                    ElementHandle handle = new ElementHandle();
                    handle.Element = element;
                    handle.Descriptor = descriptor;
                    handles[reference] = handle;

                    Dictionary<string, object> map = descriptor.ToMap();
                    map["ref"] = reference;
                    map["depth"] = depth;
                    map["describe"] = descriptor.Describe();
                    elements.Add(map);
                }

                if (depth >= 14) continue;
                try
                {
                    AutomationElementCollection children = element.FindAll(TreeScope.Children, Condition.TrueCondition);
                    int count = Math.Min(children.Count, 120);
                    for (int index = 0; index < count; index++)
                    {
                        pending.Enqueue(new KeyValuePair<AutomationElement, int>(children[index], depth + 1));
                    }
                }
                catch (ElementNotAvailableException) { }
                catch (InvalidOperationException) { }
                catch (System.Runtime.InteropServices.COMException) { }
            }
        }

        private static bool IsWorthReporting(ElementDescriptor descriptor)
        {
            if (descriptor.IsOffscreen) return false;
            if (!descriptor.HasBounds) return false;
            if (descriptor.Role == null) return false;
            switch (descriptor.Role)
            {
                case "Button":
                case "CheckBox":
                case "ComboBox":
                case "Edit":
                case "Hyperlink":
                case "ListItem":
                case "MenuItem":
                case "RadioButton":
                case "Slider":
                case "Spinner":
                case "SplitButton":
                case "Tab":
                case "TabItem":
                case "Text":
                case "TreeItem":
                case "Document":
                case "DataItem":
                    return descriptor.Name != null || descriptor.Value != null || descriptor.AutomationId != null;
                default:
                    return false;
            }
        }

        private List<object> ListWindows()
        {
            List<object> windows = new List<object>();
            Native.EnumWindows(delegate (IntPtr handle, IntPtr state)
            {
                if (!Native.IsWindowVisible(handle)) return true;
                string title = Native.WindowTitle(handle);
                if (string.IsNullOrEmpty(title)) return true;
                Dictionary<string, object> map = new Dictionary<string, object>(StringComparer.Ordinal);
                map["windowTitle"] = title;
                string app = Native.ProcessName(handle);
                if (app != null) map["app"] = app;
                map["handle"] = handle.ToInt64();
                windows.Add(map);
                return windows.Count < 80;
            }, IntPtr.Zero);
            return windows;
        }

        #endregion

        #region actions

        private ElementHandle RequireHandle(Dictionary<string, object> command)
        {
            string reference = Json.GetString(command, "ref");
            if (reference == null) return null;
            ElementHandle handle;
            if (!handles.TryGetValue(reference, out handle))
            {
                throw new InvalidOperationException("That element reference is stale; observe again before acting.");
            }
            return handle;
        }

        private Dictionary<string, object> Click(Dictionary<string, object> command)
        {
            ElementHandle handle = RequireHandle(command);
            int x, y;
            if (handle != null)
            {
                // Re-read the rectangle now: between observing and acting the
                // window may have moved, and the stored one would miss.
                ElementDescriptor fresh = ElementDescriptor.FromElement(handle.Element, false);
                if (fresh == null || !fresh.HasBounds)
                {
                    throw new InvalidOperationException("That element is no longer on screen.");
                }
                RequireElementWindowForeground(handle.Element);
                // Re-read after focusing: bringing a window forward can move or
                // resize it, and the rectangle from a moment ago would miss.
                fresh = ElementDescriptor.FromElement(handle.Element, false);
                if (fresh == null || !fresh.HasBounds)
                {
                    throw new InvalidOperationException("That element is no longer on screen.");
                }
                x = fresh.Left + fresh.Width / 2;
                y = fresh.Top + fresh.Height / 2;
            }
            else
            {
                double? px = Json.GetNumber(command, "x");
                double? py = Json.GetNumber(command, "y");
                if (!px.HasValue || !py.HasValue) throw new FormatException("click needs a 'ref' or an x/y pair.");
                x = (int)Math.Round(px.Value);
                y = (int)Math.Round(py.Value);
            }

            string button = Json.GetString(command, "button") ?? "left";
            int clicks = (int)(Json.GetNumber(command, "clicks") ?? 1);
            if (clicks < 1) clicks = 1;
            if (clicks > 3) clicks = 3;

            Native.SetCursorPos(x, y);
            Thread.Sleep(40);
            for (int index = 0; index < clicks; index++)
            {
                SendMouseClick(button);
                if (index + 1 < clicks) Thread.Sleep(60);
            }

            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["x"] = x;
            payload["y"] = y;
            if (handle != null) payload["target"] = handle.Descriptor.Describe();
            return Ok(payload);
        }

        /// <summary>
        /// Put the element's own window in front, and say whether it worked.
        ///
        /// This is a safety check, not a convenience. Input is delivered to
        /// whatever window has the keyboard, so acting on an element whose
        /// window is not in front means typing a customer name, or clicking a
        /// button, in whatever application happened to steal focus. Refusing is
        /// the only correct answer: a run that stops is recoverable, and a run
        /// that types into the wrong window is not.
        ///
        /// An element with no window of its own anywhere up its ancestry cannot
        /// be checked this way, and is allowed through -- there is nothing to
        /// compare against.
        /// </summary>
        private static bool EnsureElementWindowForeground(AutomationElement element)
        {
            IntPtr window = IntPtr.Zero;
            try
            {
                window = new IntPtr(element.Current.NativeWindowHandle);
                if (window == IntPtr.Zero)
                {
                    AutomationElement top = TreeWalker.ControlViewWalker.GetParent(element);
                    while (top != null && top.Current.NativeWindowHandle == 0)
                    {
                        top = TreeWalker.ControlViewWalker.GetParent(top);
                    }
                    if (top != null) window = new IntPtr(top.Current.NativeWindowHandle);
                }
            }
            catch (Exception) { return true; }

            if (window == IntPtr.Zero) return true;
            if (Native.GetForegroundWindow() == window) return true;
            return Native.ForceForeground(window);
        }

        private static void RequireElementWindowForeground(AutomationElement element)
        {
            if (EnsureElementWindowForeground(element)) return;
            throw new InvalidOperationException(
                "The window holding that control could not be brought to the front, so the action was not performed.");
        }

        private static void SendMouseClick(string button)
        {
            uint down, up;
            switch (button)
            {
                case "right": down = Native.MOUSEEVENTF_RIGHTDOWN; up = Native.MOUSEEVENTF_RIGHTUP; break;
                case "middle": down = Native.MOUSEEVENTF_MIDDLEDOWN; up = Native.MOUSEEVENTF_MIDDLEUP; break;
                case "none": return;
                default: down = Native.MOUSEEVENTF_LEFTDOWN; up = Native.MOUSEEVENTF_LEFTUP; break;
            }
            Native.INPUT[] inputs = new Native.INPUT[2];
            inputs[0].type = Native.INPUT_MOUSE;
            inputs[0].u.mi.dwFlags = down;
            inputs[1].type = Native.INPUT_MOUSE;
            inputs[1].u.mi.dwFlags = up;
            Native.SendInput(2, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
        }

        private Dictionary<string, object> Type(Dictionary<string, object> command)
        {
            string text = Json.GetString(command, "text");
            if (text == null) throw new FormatException("type needs 'text'.");
            ElementHandle handle = RequireHandle(command);
            bool cleared = false;
            if (handle != null)
            {
                RequireElementWindowForeground(handle.Element);
                try { handle.Element.SetFocus(); Thread.Sleep(80); }
                catch (Exception)
                {
                    ElementDescriptor fresh = ElementDescriptor.FromElement(handle.Element, false);
                    if (fresh != null && fresh.HasBounds)
                    {
                        Native.SetCursorPos(fresh.Left + fresh.Width / 2, fresh.Top + fresh.Height / 2);
                        Thread.Sleep(40);
                        SendMouseClick("left");
                        Thread.Sleep(80);
                    }
                }
                if (Json.GetBool(command, "clear", true))
                {
                    SendKeyCombination(new string[] { "control" }, 0x41 /* A */);
                    Thread.Sleep(40);
                    SendVirtualKey(0x2E /* Delete */);
                    cleared = true;
                    Thread.Sleep(40);
                }
            }
            SendUnicodeText(text);
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["typedLength"] = text.Length;
            payload["cleared"] = cleared;
            if (handle != null) payload["target"] = handle.Descriptor.Describe();
            return Ok(payload);
        }

        private static void SendUnicodeText(string text)
        {
            foreach (char c in text)
            {
                if (c == '\n' || c == '\r')
                {
                    SendVirtualKey(0x0D);
                    continue;
                }
                if (c == '\t') { SendVirtualKey(0x09); continue; }
                Native.INPUT[] inputs = new Native.INPUT[2];
                inputs[0].type = Native.INPUT_KEYBOARD;
                inputs[0].u.ki.wScan = c;
                inputs[0].u.ki.dwFlags = Native.KEYEVENTF_UNICODE;
                inputs[1].type = Native.INPUT_KEYBOARD;
                inputs[1].u.ki.wScan = c;
                inputs[1].u.ki.dwFlags = Native.KEYEVENTF_UNICODE | Native.KEYEVENTF_KEYUP;
                Native.SendInput(2, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
                Thread.Sleep(8);
            }
        }

        private Dictionary<string, object> Key(Dictionary<string, object> command)
        {
            string key = Json.GetString(command, "key");
            if (key == null) throw new FormatException("key needs 'key'.");
            List<object> rawModifiers = Json.GetList(command, "modifiers");
            List<string> modifiers = new List<string>();
            if (rawModifiers != null)
            {
                foreach (object modifier in rawModifiers)
                {
                    string text = modifier as string;
                    if (text != null) modifiers.Add(text.ToLowerInvariant());
                }
            }
            ushort virtualKey = ResolveVirtualKey(key);
            if (virtualKey == 0) throw new FormatException("Unknown key '" + key + "'.");
            if (modifiers.Count > 0) SendKeyCombination(modifiers.ToArray(), virtualKey);
            else SendVirtualKey(virtualKey);
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["key"] = key;
            return Ok(payload);
        }

        private static ushort ResolveVirtualKey(string key)
        {
            switch (key.ToLowerInvariant())
            {
                case "enter": case "return": return 0x0D;
                case "tab": return 0x09;
                case "escape": case "esc": return 0x1B;
                case "space": return 0x20;
                case "backspace": return 0x08;
                case "delete": return 0x2E;
                case "arrowup": case "up": return 0x26;
                case "arrowdown": case "down": return 0x28;
                case "arrowleft": case "left": return 0x25;
                case "arrowright": case "right": return 0x27;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pageup": return 0x21;
                case "pagedown": return 0x22;
            }
            if (key.Length == 1)
            {
                char c = char.ToUpperInvariant(key[0]);
                if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return (ushort)c;
            }
            if (key.Length >= 2 && (key[0] == 'f' || key[0] == 'F'))
            {
                int number;
                if (int.TryParse(key.Substring(1), out number) && number >= 1 && number <= 12)
                {
                    return (ushort)(0x6F + number);
                }
            }
            return 0;
        }

        private static void SendVirtualKey(ushort virtualKey)
        {
            Native.INPUT[] inputs = new Native.INPUT[2];
            inputs[0].type = Native.INPUT_KEYBOARD;
            inputs[0].u.ki.wVk = virtualKey;
            inputs[1].type = Native.INPUT_KEYBOARD;
            inputs[1].u.ki.wVk = virtualKey;
            inputs[1].u.ki.dwFlags = Native.KEYEVENTF_KEYUP;
            Native.SendInput(2, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
        }

        private static void SendKeyCombination(string[] modifiers, ushort virtualKey)
        {
            List<ushort> modifierKeys = new List<ushort>();
            foreach (string modifier in modifiers)
            {
                switch (modifier)
                {
                    case "control": case "ctrl": modifierKeys.Add(Native.VK_CONTROL); break;
                    case "alt": modifierKeys.Add(Native.VK_MENU); break;
                    case "shift": modifierKeys.Add(Native.VK_SHIFT); break;
                    case "win": case "meta": modifierKeys.Add(Native.VK_LWIN); break;
                }
            }
            List<Native.INPUT> inputs = new List<Native.INPUT>();
            foreach (ushort modifier in modifierKeys)
            {
                Native.INPUT input = new Native.INPUT();
                input.type = Native.INPUT_KEYBOARD;
                input.u.ki.wVk = modifier;
                inputs.Add(input);
            }
            Native.INPUT keyDown = new Native.INPUT();
            keyDown.type = Native.INPUT_KEYBOARD;
            keyDown.u.ki.wVk = virtualKey;
            inputs.Add(keyDown);
            Native.INPUT keyUp = new Native.INPUT();
            keyUp.type = Native.INPUT_KEYBOARD;
            keyUp.u.ki.wVk = virtualKey;
            keyUp.u.ki.dwFlags = Native.KEYEVENTF_KEYUP;
            inputs.Add(keyUp);
            for (int index = modifierKeys.Count - 1; index >= 0; index--)
            {
                Native.INPUT input = new Native.INPUT();
                input.type = Native.INPUT_KEYBOARD;
                input.u.ki.wVk = modifierKeys[index];
                input.u.ki.dwFlags = Native.KEYEVENTF_KEYUP;
                inputs.Add(input);
            }
            Native.INPUT[] array = inputs.ToArray();
            Native.SendInput((uint)array.Length, array, Marshal.SizeOf(typeof(Native.INPUT)));
        }

        private Dictionary<string, object> Scroll(Dictionary<string, object> command)
        {
            ElementHandle handle = RequireHandle(command);
            if (handle != null)
            {
                ElementDescriptor fresh = ElementDescriptor.FromElement(handle.Element, false);
                if (fresh != null && fresh.HasBounds)
                {
                    Native.SetCursorPos(fresh.Left + fresh.Width / 2, fresh.Top + fresh.Height / 2);
                    Thread.Sleep(30);
                }
            }
            int notches = (int)(Json.GetNumber(command, "notches") ?? -3);
            Native.INPUT[] inputs = new Native.INPUT[1];
            inputs[0].type = Native.INPUT_MOUSE;
            inputs[0].u.mi.dwFlags = Native.MOUSEEVENTF_WHEEL;
            inputs[0].u.mi.mouseData = unchecked((uint)(notches * 120));
            Native.SendInput(1, inputs, Marshal.SizeOf(typeof(Native.INPUT)));
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["notches"] = notches;
            return Ok(payload);
        }

        /// <summary>
        /// Bring the window a step named to the front.
        ///
        /// The two hints are scored rather than required together. A procedure
        /// says "the browser window showing Customer Lookup" and names the
        /// application as "Microsoft Edge"; the operating system calls that
        /// process "msedge". Requiring both to match exactly means a replay that
        /// can see the right window and refuses to use it. Requiring neither
        /// means focusing whatever came first. So: at least one hint must match,
        /// and the best match wins.
        /// </summary>
        private Dictionary<string, object> FocusWindow(Dictionary<string, object> command)
        {
            string titleContains = Json.GetString(command, "titleContains");
            string app = Json.GetString(command, "app");
            if (titleContains == null && app == null)
            {
                // With nothing to match on, the search below would take the
                // first visible window it walked past and hand a replay the
                // keyboard of whatever that happened to be.
                throw new FormatException("focus_window needs a window title fragment or an application name.");
            }

            IntPtr best = IntPtr.Zero;
            string bestTitle = null;
            int bestScore = 0;

            Native.EnumWindows(delegate (IntPtr handle, IntPtr state)
            {
                if (!Native.IsWindowVisible(handle)) return true;
                string title = Native.WindowTitle(handle);
                if (string.IsNullOrEmpty(title)) return true;
                // A window with no area is a message-only or hidden shell window.
                Native.RECT bounds;
                if (!Native.GetWindowRect(handle, out bounds)) return true;
                if (bounds.Right - bounds.Left < 80 || bounds.Bottom - bounds.Top < 60) return true;

                int score = 0;
                if (titleContains != null && title.IndexOf(titleContains, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    score += 3;
                }
                if (app != null)
                {
                    string processName = Native.ProcessName(handle);
                    if (LooseMatch(processName, app) || LooseMatch(title, app)) score += 2;
                }
                if (score > bestScore)
                {
                    bestScore = score;
                    best = handle;
                    bestTitle = title;
                }
                return true;
            }, IntPtr.Zero);

            if (best == IntPtr.Zero || bestScore == 0)
            {
                // Name what was actually open. "No visible window matched" sends
                // whoever reads it looking for a bug; "the windows open are these"
                // usually shows at a glance that the application closed, moved to
                // another desktop, or is titled differently than expected.
                StringBuilder open = new StringBuilder();
                int listed = 0;
                Native.EnumWindows(delegate (IntPtr handle, IntPtr state)
                {
                    if (!Native.IsWindowVisible(handle)) return true;
                    string title = Native.WindowTitle(handle);
                    if (string.IsNullOrEmpty(title)) return true;
                    Native.RECT area;
                    if (!Native.GetWindowRect(handle, out area)) return true;
                    if (area.Right - area.Left < 200 || area.Bottom - area.Top < 150) return true;
                    if (listed > 0) open.Append("; ");
                    open.Append(title.Length > 60 ? title.Substring(0, 60) : title);
                    listed++;
                    return listed < 8;
                }, IntPtr.Zero);
                throw new InvalidOperationException(
                    "No visible window matched. Open windows: " + (listed == 0 ? "none" : open.ToString()));
            }

            bool focused = Native.ForceForeground(best);
            Thread.Sleep(150);
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["windowTitle"] = bestTitle;
            payload["focused"] = focused;
            if (!focused)
            {
                // Reporting a focus that did not happen is how a replay goes on
                // to type into the wrong application.
                throw new InvalidOperationException("The window \"" + bestTitle + "\" could not be brought to the front.");
            }
            return Ok(payload);
        }

        /// <summary>
        /// Whether two application names plausibly mean the same program.
        ///
        /// "Microsoft Edge" and "msedge" are the same thing to a person and
        /// nothing alike to string equality.
        /// </summary>
        private static bool LooseMatch(string candidate, string wanted)
        {
            if (string.IsNullOrEmpty(candidate) || string.IsNullOrEmpty(wanted)) return false;
            string left = Squash(candidate);
            string right = Squash(wanted);
            if (left.Length == 0 || right.Length == 0) return false;
            if (left.Contains(right) || right.Contains(left)) return true;
            // Compare on the distinctive word rather than the vendor prefix:
            // "microsoftedge" against "msedge" shares "edge".
            foreach (string word in wanted.Split(new char[] { ' ', '-', '_', '.' }, StringSplitOptions.RemoveEmptyEntries))
            {
                string token = Squash(word);
                if (token.Length >= 4 && left.Contains(token)) return true;
            }
            return false;
        }

        private static string Squash(string value)
        {
            StringBuilder builder = new StringBuilder(value.Length);
            foreach (char c in value)
            {
                if (char.IsLetterOrDigit(c)) builder.Append(char.ToLowerInvariant(c));
            }
            return builder.ToString();
        }

        private Dictionary<string, object> Screenshot(Dictionary<string, object> command)
        {
            string path = Json.GetString(command, "path");
            if (path == null) throw new FormatException("screenshot needs 'path'.");
            int maxWidth = (int)(Json.GetNumber(command, "maxWidth") ?? 1280);
            Rectangle region = ScreenCapture.VirtualBounds();
            if (Json.GetBool(command, "foregroundOnly", true))
            {
                ForegroundContext context = ForegroundContext.Capture();
                if (context.HasBounds)
                {
                    Rectangle windowRect = new Rectangle(context.Bounds.Left, context.Bounds.Top,
                        context.Bounds.Right - context.Bounds.Left, context.Bounds.Bottom - context.Bounds.Top);
                    windowRect.Intersect(region);
                    if (windowRect.Width > 200 && windowRect.Height > 150) region = windowRect;
                }
            }
            if (!ScreenCapture.CaptureToFile(region, path, maxWidth, 80L))
            {
                throw new InvalidOperationException("The screen could not be captured.");
            }
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["path"] = path;
            return Ok(payload);
        }

        #endregion
    }

    #endregion

    internal static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            Native.MakeDpiAware();
            try { Console.OutputEncoding = new UTF8Encoding(false); }
            catch (IOException) { /* stdout is a pipe; the encoding is already UTF-8 there. */ }

            if (args.Length == 0)
            {
                Console.Error.WriteLine("Usage: BreadboardTeach.exe record --out <dir> | control");
                return 2;
            }

            string mode = args[0];
            if (mode == "control")
            {
                return new Controller().Run();
            }
            if (mode != "record")
            {
                Console.Error.WriteLine("Unknown mode '" + mode + "'.");
                return 2;
            }

            string outputDirectory = null;
            int maxFrames = 220;
            int frameMaxWidth = 1280;
            bool captureFrames = true;
            for (int index = 1; index < args.Length; index++)
            {
                string argument = args[index];
                if (argument == "--out" && index + 1 < args.Length) { outputDirectory = args[++index]; }
                else if (argument == "--max-frames" && index + 1 < args.Length) { int.TryParse(args[++index], out maxFrames); }
                else if (argument == "--frame-width" && index + 1 < args.Length) { int.TryParse(args[++index], out frameMaxWidth); }
                else if (argument == "--no-frames") { captureFrames = false; }
            }
            if (outputDirectory == null)
            {
                Console.Error.WriteLine("record needs --out <dir>.");
                return 2;
            }
            return new Recorder(outputDirectory, maxFrames, frameMaxWidth, captureFrames).Run();
        }
    }
}
