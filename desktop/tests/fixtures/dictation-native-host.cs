using System;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Forms;

// Test-only host: run the unmodified production helper entry point, with a
// separate native text editor and a control pipe for deterministic key stimuli.
// Physical key events enter at OnKeyboard; all subsequent code is production.
internal static class DictationNativeHost
{
    private static Type helper;
    private static Form form;
    private static TextBox field, other;
    private static Label status;
    private static int submits;
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] private struct HookKey { public uint Key, Scan, Flags, Time; public UIntPtr Extra; }
    private static Delegate previewHook;
    private static volatile bool repeatingRestore;
    private static Thread restoreThread;
    private static IntPtr PreviewKeyboard(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0) {
            HookKey key = (HookKey)Marshal.PtrToStructure(data, typeof(HookKey));
            // Only test-owned injected restores enter production's hook. The
            // probe never handles physical keys or another app's injected input.
            if ((key.Flags & 0x10) != 0 && key.Extra == (UIntPtr)helper.GetField("restoreControlMarker", PrivateStatic).GetValue(null))
                return (IntPtr)Call("OnKeyboard", code, message, data);
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }
    private static void StopRestores() { repeatingRestore = false; if (restoreThread != null) restoreThread.Join(); restoreThread = null; }
    private static void RepeatRestores(int key, IntPtr target)
    {
        if (Environment.GetEnvironmentVariable("BREADBOARD_DICTATION_RESTORE_RACE") != "1") return;
        StopRestores(); repeatingRestore = true;
        object input = Call("Key", (ushort)key, (ushort)0, key == 0xA3 ? 1u : 0u);
        Type inputType = input.GetType();
        object data = inputType.GetField("Data").GetValue(input), keyboard = data.GetType().GetField("Key").GetValue(data);
        keyboard.GetType().GetField("Extra").SetValue(keyboard, helper.GetField("restoreControlMarker", PrivateStatic).GetValue(null));
        data.GetType().GetField("Key").SetValue(data, keyboard); inputType.GetField("Data").SetValue(input, data);
        Array batch = Array.CreateInstance(inputType, 1); batch.SetValue(input, 0);
        restoreThread = new Thread(delegate() {
            while (repeatingRestore) {
                if (GetForegroundWindow() == target) Call("SendInput", 1u, batch, Marshal.SizeOf(inputType));
                Thread.Sleep(2);
            }
        }) { IsBackground = true };
        restoreThread.Start();
    }
    [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr window, uint objectId, ref Guid iid,
        [MarshalAs(UnmanagedType.Interface)] out Accessibility.IAccessible accessible);
    private const BindingFlags PrivateStatic = BindingFlags.Static | BindingFlags.NonPublic;
    private static object Call(string method, params object[] args) { return helper.GetMethod(method, PrivateStatic).Invoke(null, args); }
    private static Control Dispatcher { get { return (Control)helper.GetField("dispatcher", PrivateStatic).GetValue(null); } }
    private static void Key(int key, bool up)
    {
        Type type = helper.GetNestedType("Keyboard", BindingFlags.NonPublic);
        object value = Activator.CreateInstance(type);
        type.GetField("Key").SetValue(value, (uint)key);
        type.GetField("Flags").SetValue(value, up ? 0x80u : 0u);
        IntPtr data = Marshal.AllocHGlobal(Marshal.SizeOf(type));
        try {
            Marshal.StructureToPtr(value, data, false);
            Dispatcher.Invoke((Action)delegate {
                bool handled = (IntPtr)Call("OnKeyboard", 0, new IntPtr(up ? 0x101 : 0x100), data) == new IntPtr(1);
                if (handled != (!up && (key == 0xA0 || key == 0xA1)))
                    throw new Exception("The second modifier down must be suppressed and modifier releases must pass through");
            });
        } finally { Marshal.FreeHGlobal(data); }
    }
    private static object Command(string operation)
    {
        if (operation == "focus") form.Invoke((Action)delegate { form.Activate(); field.Focus(); field.Select(field.Text.Length, 0); });
        if (operation == "other") form.Invoke((Action)delegate { other.Focus(); });
        if (operation.StartsWith("status ")) form.Invoke((Action)delegate { status.Text = operation.Substring(7); });
        if (operation == "start") {
            // Refuse to run a native stimulus unless our own fixture is focused.
            if ((IntPtr)Call("GetForegroundWindow") != form.Handle ||
                !Automation.Compare(AutomationElement.FromHandle(field.Handle), AutomationElement.FocusedElement))
                throw new Exception("Native verification field does not own foreground focus");
            Key(0xA2, false); Key(0xA0, false);
        }
        if (operation == "stop") { Key(0xA2, true); Key(0xA0, true); }
        if (operation == "escape") Key(0x1B, false);
        object snapshot = null;
        form.Invoke((Action)delegate { snapshot = new { text = field.Text, other = other.Text, submits = submits,
            foreground = (IntPtr)Call("GetForegroundWindow") == form.Handle, focused = field.Focused }; });
        return snapshot;
    }
    [STAThread] private static void Main(string[] args)
    {
        if (args[0] == "--accessibility" && Thread.CurrentThread.GetApartmentState() != ApartmentState.MTA) {
            // Production accessibility and insertion run on its MTA worker.
            // Pump the real tagged-restore hook on STA, like production. A
            // SendInput-only test without this hook misses the scheduling race.
            helper = Assembly.LoadFrom(args[1]).GetType("BreadboardDictation");
            previewHook = Delegate.CreateDelegate(helper.GetField("keyboardHook", PrivateStatic).FieldType, typeof(DictationNativeHost).GetMethod("PreviewKeyboard", PrivateStatic));
            IntPtr hook = (IntPtr)Call("SetWindowsHookEx", 13, previewHook, Call("GetModuleHandle", new object[] { null }), 0u);
            if (hook == IntPtr.Zero) throw new Exception("Preview verification hook did not start");
            try {
                var worker = new Thread(() => Main(args)); worker.SetApartmentState(ApartmentState.MTA); worker.Start();
                while (worker.IsAlive) { Application.DoEvents(); Thread.Sleep(1); }
            } finally { StopRestores(); Call("UnhookWindowsHookEx", hook); }
            return;
        }
        Console.InputEncoding = System.Text.Encoding.UTF8; Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        if (args[0] == "--accessibility") {
            var assembly = Assembly.LoadFrom(args[1]);
            Type targetType = assembly.GetType("DictationAccessibleTarget");
            helper = assembly.GetType("BreadboardDictation");
            foreach (var sample in new[] {
                new object[] { "Hello\u00a0world", "Hello world", true },
                new object[] { "Hello world", "Hello world", true },
                new object[] { "Hello\u00a0world", "Hello  world", false },
                new object[] { "Hello word", "Hello world", false },
                new object[] { "Hello\nworld", "Hello world", false },
                new object[] { "Hello world", "Hello\u00a0world", false },
                new object[] { null, "Hello", false },
            }) if ((bool)Call("SamePreview", sample[0], sample[1]) != (bool)sample[2])
                throw new Exception("Dictation confirmation accepted a changed or incomplete span");
            if (helper.GetMethod("RecordPhysicalControl", PrivateStatic) != null) {
                Type keyType = helper.GetNestedType("Keyboard", BindingFlags.NonPublic);
                object key = Activator.CreateInstance(keyType);
                keyType.GetField("Key").SetValue(key, 0xA2u);
                keyType.GetField("Flags").SetValue(key, 0x10u);
                keyType.GetField("Extra").SetValue(key, helper.GetField("restoreControlMarker", PrivateStatic).GetValue(null));
                Call("RecordPhysicalControl", 0xA2, false);
                if ((bool)Call("SuppressReleasedControl", key)) throw new Exception("Held Ctrl restore was suppressed");
                Call("RecordPhysicalControl", 0xA2, true);
                if (!(bool)Call("SuppressReleasedControl", key)) throw new Exception("Released Ctrl could be restored by a stale batch");
                keyType.GetField("Extra").SetValue(key, UIntPtr.Zero);
                if ((bool)Call("SuppressReleasedControl", key)) throw new Exception("Another program's input was suppressed");
            }
            Type sessionType = helper.GetNestedType("Session", BindingFlags.NonPublic);
            object chord = helper.GetField("chord", PrivateStatic).GetValue(null);
            foreach (string callback in new[] { "Start", "Finish", "Cancel" })
                chord.GetType().GetField(callback, BindingFlags.NonPublic | BindingFlags.Instance).SetValue(chord, (Action)delegate {});
            chord.GetType().GetField("ReleaseModifiers", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(chord, (Action)delegate { Call("ReleaseDictationModifiers"); });
            var current = helper.GetField("current", PrivateStatic);
            var targetWindow = new IntPtr(long.Parse(args[2]));
            object target = null; string rememberedPrefix = null, rememberedSuffix = null;
            var serializer = new JavaScriptSerializer();
            var operations = new System.Collections.Concurrent.BlockingCollection<string>();
            if (args.Length > 3 && args[3] == "--renderer") {
                var output = (System.Collections.Concurrent.BlockingCollection<object>)helper.GetField("output", PrivateStatic).GetValue(null);
                new Thread(delegate() {
                    foreach (object notice in output.GetConsumingEnumerable()) {
                        if ((string)notice.GetType().GetProperty("type").GetValue(notice, null) != "edit") continue;
                        Console.WriteLine(new JavaScriptSerializer().Serialize(notice)); Console.Out.Flush();
                    }
                }) { IsBackground = true }.Start();
            }
            // Production reads renderer acknowledgements independently of the
            // worker waiting for them. Keep that same transport in this probe.
            new Thread(delegate() {
                try {
                    string line;
                    var reader = new JavaScriptSerializer();
                    while ((line = Console.ReadLine()) != null) {
                        if (line.StartsWith("{")) {
                            var command = reader.Deserialize<System.Collections.Generic.Dictionary<string, object>>(line);
                            string type = Convert.ToString(command["type"]); int id = Convert.ToInt32(command["id"]);
                            if (type == "renderer-input") Call("EnableRendererInput", id);
                            else if (type == "edited") Call("CompleteRendererEdit", id, Convert.ToInt32(command["request"]), (bool)command["applied"]);
                        } else operations.Add(line);
                    }
                } finally { operations.CompleteAdding(); }
            }) { IsBackground = true }.Start();
            foreach (string operation in operations.GetConsumingEnumerable()) {
                if (operation == "quit") break;
                if (operation == "capture") target = targetType.GetMethod("FromWindow", PrivateStatic | BindingFlags.Public).Invoke(null, new object[] { targetWindow });
                var flags = BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public;
                object selected = null, text = null;
                if (target != null && operation.StartsWith("select ")) {
                    string[] parts = operation.Split(' ');
                    int start = int.Parse(parts[1]), end = int.Parse(parts[2]);
                    selected = targetType.GetMethod("Select", flags).Invoke(target, new object[] { start, end });
                    // setSelection queues a renderer action. Capturing a hold
                    // before that action is published records the old caret,
                    // then falsely blames production when typing replaces the
                    // newly selected span. Wait for this test's own setup.
                    if ((bool)selected) {
                        long deadline = Environment.TickCount + 2000L;
                        for (;;) {
                            var range = (int[])targetType.GetMethod("Selection", flags).Invoke(target, null);
                            if (range != null && range[0] == Math.Min(start, end) && range[1] == Math.Max(start, end)) break;
                            if (Environment.TickCount >= deadline) throw new Exception("Fixture selection was not acknowledged");
                            Thread.Sleep(10);
                        }
                    }
                }
                if (target != null && operation.StartsWith("text ")) {
                    string[] parts = operation.Split(' ');
                    text = targetType.GetMethod("Text", flags).Invoke(target, new object[] { int.Parse(parts[1]), int.Parse(parts[2]) });
                }
                object preview = null, previewState = null; string error = null;
                var elapsed = System.Diagnostics.Stopwatch.StartNew();
                try {
                    if (operation.StartsWith("matches ")) {
                        string expected = operation.Substring(8);
                        string observed = (string)targetType.GetMethod("Text", flags).Invoke(target, new object[] { 0, expected.Length });
                        preview = Call("SamePreview", observed, expected);
                    }
                    if (operation == "stream" || operation == "remember-placeholder") {
                        if (operation == "stream" && targetWindow != GetForegroundWindow()) throw new Exception("Fixture does not own foreground focus");
                        int[] range = (int[])targetType.GetMethod("Selection", flags).Invoke(target, null);
                        rememberedPrefix = (string)targetType.GetMethod("Text", flags).Invoke(target, new object[] { 0, range[0] });
                        rememberedSuffix = (string)targetType.GetMethod("Text", flags).Invoke(target, new object[] { range[1], -1 });
                        object hold = Activator.CreateInstance(sessionType, true);
                        foreach (var pair in new[] { new object[] { "Id", 1 }, new object[] { "Window", targetWindow },
                            new object[] { "Focus", Call("Focus") }, new object[] { "Accessible", target }, new object[] { "Started", true },
                            new object[] { "PreviewStart", range[0] }, new object[] { "PreviewEnd", range[1] },
                            new object[] { "OriginalSelection", targetType.GetMethod("Text", flags).Invoke(target, new object[] { range[0], range[1] }) } })
                            sessionType.GetField((string)pair[0], flags).SetValue(hold, pair[1]);
                        current.SetValue(null, hold);
                    }
                    if (operation.StartsWith("rebase ")) {
                        preview = Call("RebaseInitialPreview", current.GetValue(null), operation.Substring(7), rememberedPrefix, rememberedSuffix);
                        target = sessionType.GetField("Accessible", flags).GetValue(current.GetValue(null));
                    }
                    if (operation.StartsWith("preview ")) preview = Call("UpdatePreview", current.GetValue(null), operation.Substring(8));
                    if (operation == "burst" || operation == "burst-fast") {
                        // No JS round trip or DOM snapshot between edits: the
                        // next preview can start before a queued Ctrl restore.
                        string sentence = "Testing breadboard dictation with every final word.";
                        bool quick = operation == "burst-fast";
                        int step = quick ? 7 : 1;
                        for (int repeat = 0; repeat < (quick ? 1 : 3); repeat++) {
                            for (int length = 1; length <= sentence.Length; length += step)
                                Call("UpdatePreview", current.GetValue(null), sentence.Substring(0, length));
                            Call("UpdatePreview", current.GetValue(null), sentence);
                            for (int length = sentence.Length - 1; length >= 0; length -= step)
                                Call("UpdatePreview", current.GetValue(null), sentence.Substring(0, length));
                            Call("UpdatePreview", current.GetValue(null), "");
                        }
                        preview = true;
                    }
                    if (operation.StartsWith("final ") || operation.StartsWith("final-held ")) {
                        bool held = operation.StartsWith("final-held ");
                        object hold = current.GetValue(null);
                        if (hold != null) {
                            sessionType.GetField("Released", flags).SetValue(hold, true);
                            if (held) {
                                sessionType.GetField("VoiceFinished", flags).SetValue(hold, true);
                                chord.GetType().GetMethod("Complete", flags).Invoke(chord, null);
                            }
                        }
                        Call("Insert", 1, operation.Substring(held ? 11 : 6), true);
                    }
                    if (operation.StartsWith("ctrl ")) {
                        // Always release a modifier synthesized by this fixture,
                        // even if the user switches away while it is running.
                        if (!operation.StartsWith("ctrl up ") && targetWindow != GetForegroundWindow()) throw new Exception("Fixture does not own foreground focus");
                        Type keyType = assembly.GetType("DictationChord").GetNestedType("Key", BindingFlags.Public | BindingFlags.NonPublic);
                        string[] parts = operation.Split(' '); int code = parts[2] == "right" ? 0xA3 : 0xA2;
                        if (parts[1] == "up") StopRestores();
                        var physical = helper.GetMethod("RecordPhysicalControl", PrivateStatic);
                        if (physical != null) physical.Invoke(null, new object[] { code, parts[1] == "up" });
                        object key = Activator.CreateInstance(keyType, flags, null, new object[] { code, parts[1] == "up" }, null);
                        keyType.GetField("Extended", flags).SetValue(key, code == 0xA3);
                        // The live path consumes Ctrl+Shift before streaming.
                        // Exercise both press orders; the first modifier really
                        // reaches Windows and must be neutralized on commit.
                        object shift = Activator.CreateInstance(keyType, flags, null, new object[] { 0xA0, parts[1] == "up" }, null);
                        Call("RecordPhysicalShift", 0xA0, parts[1] == "up");
                        foreach (object modifier in code == 0xA3 ? new[] { shift, key } : new[] { key, shift }) {
                            bool handled = (bool)chord.GetType().GetMethod("Handle", flags).Invoke(chord, new object[] { modifier, 0L, false });
                            if (!handled) {
                                Array keys = Array.CreateInstance(keyType, 1); keys.SetValue(modifier, 0);
                                Call("Replay", new object[] { keys });
                            }
                        }
                        if (parts[1] == "down") chord.GetType().GetMethod("Tick", flags).Invoke(chord, new object[] { 200L });
                        if (parts[1] == "down") RepeatRestores(code, targetWindow);
                    }
                    if (operation == "plain-keys") {
                        if (targetWindow != GetForegroundWindow() || target == null || !(bool)targetType.GetMethod("IsFocused", flags).Invoke(target, null))
                            throw new Exception("Fixture does not own the focused editor");
                        foreach (int code in new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
                            if (((short)Call("GetAsyncKeyState", code) & 0x8000) != 0) throw new Exception("A modifier is still down; refusing to send H/E");
                        object key = Call("Key", (ushort)0x48, (ushort)0, 0u);
                        Array batch = Array.CreateInstance(key.GetType(), 4); batch.SetValue(key, 0);
                        batch.SetValue(Call("Key", (ushort)0x48, (ushort)0, 2u), 1);
                        batch.SetValue(Call("Key", (ushort)0x45, (ushort)0, 0u), 2);
                        batch.SetValue(Call("Key", (ushort)0x45, (ushort)0, 2u), 3);
                        if ((uint)Call("SendInput", 4u, batch, Marshal.SizeOf(key.GetType())) != 4u) throw new Exception("Plain typing was blocked");
                    }
                } catch (Exception failure) {
                    error = failure.GetBaseException().Message;
                    // This host only receives fixed fixture text. Do not add
                    // transcript contents to the production helper's logs.
                    object hold = current.GetValue(null);
                    if (hold != null && target != null) {
                        int start = (int)sessionType.GetField("PreviewStart", flags).GetValue(hold);
                        int end = (int)sessionType.GetField("PreviewEnd", flags).GetValue(hold);
                        previewState = new { start = start, end = end,
                            expected = sessionType.GetField("PreviewText", flags).GetValue(hold),
                            observed = targetType.GetMethod("Text", flags).Invoke(target, new object[] { 0, -1 }) };
                    }
                }
                long editMilliseconds = elapsed.ElapsedMilliseconds;
                if (error != null) Console.Error.WriteLine(serializer.Serialize(new { operation = operation, error = error, previewState = previewState,
                    selection = target == null ? null : targetType.GetMethod("Selection", flags).Invoke(target, null), editMilliseconds = editMilliseconds }));
                Console.WriteLine(serializer.Serialize(new { editable = target != null,
                    streamable = target != null && (bool)targetType.GetProperty("SupportsStreaming", flags).GetValue(target, null),
                    focused = target != null && (bool)targetType.GetMethod("IsFocused", flags).Invoke(target, null),
                    caret = target == null ? null : targetType.GetMethod("Caret", flags).Invoke(target, null),
                    bounds = target == null ? null : targetType.GetMethod("Bounds", flags).Invoke(target, null),
                    selection = target == null ? null : targetType.GetMethod("Selection", flags).Invoke(target, null), selected = selected, text = text,
                    foreground = GetForegroundWindow() == targetWindow, preview = preview, previewState = previewState, error = error, editMilliseconds = editMilliseconds }));
                Console.Out.Flush();
            }
            return;
        }
        if (args[0] == "--probe") {
            // Metadata only: never inspect a field's value, name or transcript.
            for (int i = 0; i < 4; i++) {
                IntPtr targetWindow = args.Length > 1 ? new IntPtr(long.Parse(args[1])) : GetForegroundWindow();
                AutomationElement focused = args.Length > 1 ? AutomationElement.FromHandle(targetWindow).FindFirst(TreeScope.Descendants,
                    new PropertyCondition(AutomationElement.HasKeyboardFocusProperty, true)) : AutomationElement.FocusedElement;
                var patterns = new System.Collections.Generic.List<string>();
                if (focused != null) foreach (var pattern in focused.GetSupportedPatterns()) patterns.Add(pattern.ProgrammaticName);
                Console.WriteLine(new JavaScriptSerializer().Serialize(new {
                    type = focused == null ? null : focused.Current.ControlType.ProgrammaticName,
                    className = focused == null ? null : focused.Current.ClassName,
                    processId = focused == null ? 0 : focused.Current.ProcessId,
                    focused = focused != null && focused.Current.HasKeyboardFocus,
                    password = focused != null && focused.Current.IsPassword,
                    enabled = focused != null && focused.Current.IsEnabled,
                    patterns = patterns
                }));
                Accessibility.IAccessible accessible;
                Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
                if (AccessibleObjectFromWindow(targetWindow, unchecked((uint)-4), ref iid, out accessible) == 0) {
                    for (int depth = 0; accessible != null && depth < 12; depth++) {
                        object focus = accessible.accFocus;
                        object child = focus is int ? focus : 0;
                        Console.WriteLine(new JavaScriptSerializer().Serialize(new { msaaDepth = depth,
                            role = accessible.get_accRole(child), state = accessible.get_accState(child), focusObject = focus is Accessibility.IAccessible }));
                        accessible = focus as Accessibility.IAccessible;
                    }
                }
                Thread.Sleep(250);
            }
            return;
        }
        if (args[0] == "--sample") {
            using (var speech = new System.Speech.Synthesis.SpeechSynthesizer()) {
                speech.SetOutputToWaveFile(args[1]);
                var prompt = new System.Speech.Synthesis.PromptBuilder();
                prompt.AppendText(args.Length > 2 ? args[2] : "Testing breadboard dictation. Send message.");
                prompt.AppendBreak(TimeSpan.FromSeconds(1)); speech.Speak(prompt);
            }
            return;
        }
        helper = Assembly.LoadFrom(args[0]).GetType("BreadboardDictation");
        var shown = new ManualResetEvent(false);
        var editor = new Thread(delegate() {
            // Show after the production console/hook initialization so a late
            // console activation cannot take focus back from the test editor.
            while ((IntPtr)helper.GetField("keyboard", PrivateStatic).GetValue(null) == IntPtr.Zero) Thread.Sleep(10);
            form = new Form { Text = "Breadboard isolated dictation verification", Width = 640, Height = 260, ShowInTaskbar = true };
            status = new Label { Left = 16, Top = 12, Width = 590, Height = 48,
                Text = "Click the large white field below, then hold Ctrl + Shift.\nSay: Testing breadboard dictation. Send message." };
            field = new TextBox { Multiline = true, Left = 16, Top = 64, Width = 590, Height = 80,
                BackColor = System.Drawing.Color.White, ForeColor = System.Drawing.Color.Black, TabIndex = 0 };
            other = new TextBox { Text = "untouched", Left = 16, Top = 180, Width = 590, TabIndex = 1 };
            field.Enter += delegate { status.Text = "Ready. Hold Ctrl + Shift until the voice dots appear, then speak.\nRelease both keys when finished."; };
            field.KeyDown += delegate(object sender, KeyEventArgs key) { if (key.KeyCode == Keys.Enter) { submits++; key.SuppressKeyPress = true; } };
            form.Controls.Add(field); form.Controls.Add(other); form.Controls.Add(status);
            form.Shown += delegate { form.Activate(); field.Focus(); shown.Set(); };
            Application.Run(form);
        });
        editor.IsBackground = true; editor.SetApartmentState(ApartmentState.STA); editor.Start();
        new Thread(delegate() {
            shown.WaitOne();
            while (Dispatcher == null) Thread.Sleep(10);
            using (var pipe = new NamedPipeServerStream(args[1], PipeDirection.InOut)) {
                pipe.WaitForConnection();
                var reader = new StreamReader(pipe); var writer = new StreamWriter(pipe) { AutoFlush = true };
                var json = new JavaScriptSerializer(); string operation;
                while ((operation = reader.ReadLine()) != null) {
                    try { writer.WriteLine(json.Serialize(Command(operation))); }
                    catch (Exception error) { writer.WriteLine(json.Serialize(new { error = error.GetBaseException().Message })); }
                }
            }
        }) { IsBackground = true }.Start();
        // Uses the real hook registration, queue, stdin protocol, focus guards,
        // SendInput implementation and EOF shutdown from the shipped assembly.
        Call("Main");
    }
}
