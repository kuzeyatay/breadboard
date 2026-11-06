using System;
using System.Reflection;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

// Exercise production SendInput against our own control, with the same focus guard.
internal static class InsertionTest
{
    [STAThread] private static int Main(string[] args)
    {
        Type helper = Assembly.LoadFrom(args[0]).GetType("BreadboardDictation");
        Type sessionType = helper.GetNestedType("Session", BindingFlags.NonPublic);
        var current = helper.GetField("current", BindingFlags.Static | BindingFlags.NonPublic);
        var insert = helper.GetMethod("Insert", BindingFlags.Static | BindingFlags.NonPublic);
        bool interactive = args.Length > 1 && args[1] == "--interactive";
        Form form = new Form { Text = "Breadboard dictation verification — click the first field", Width = 620, Height = 180, ShowInTaskbar = interactive };
        TextBox first = new TextBox { Text = "before AFTER", Multiline = true, Dock = DockStyle.Top };
        TextBox other = new TextBox { Text = "untouched", Dock = DockStyle.Bottom };
        form.Controls.Add(first); form.Controls.Add(other);
        form.Controls.Add(new Label { Text = "Click the top field to run the isolated insertion test.\nIt types sample text and counts Enter locally; nothing is sent.", Dock = DockStyle.Fill, Padding = new Padding(8) });
        first.BringToFront(); other.BringToFront();
        int sends = 0, result = 1;
        first.KeyDown += delegate(object sender, KeyEventArgs key) { if (key.KeyCode == Keys.Enter) { sends++; key.SuppressKeyPress = true; } };
        Action<int, AutomationElement> capture = delegate(int id, AutomationElement element) {
            object session = Activator.CreateInstance(sessionType, true);
            foreach (var pair in new[] { new object[] { "Id", id }, new object[] { "Window", form.Handle },
                new object[] { "Focus", first.Handle }, new object[] { "Element", element }, new object[] { "Released", true } })
                sessionType.GetField((string)pair[0], BindingFlags.NonPublic | BindingFlags.Instance).SetValue(session, pair[1]);
            current.SetValue(null, session);
        };
        form.Shown += delegate {
            form.Activate(); first.Focus(); first.Select(7, 5);
            new Thread(delegate() {
                try
                {
                    Thread.Sleep(150);
                    AutomationElement element = AutomationElement.FromHandle(first.Handle);
                    if (interactive)
                    {
                        DateTime deadline = DateTime.UtcNow.AddMinutes(5);
                        while (!Automation.Compare(element, AutomationElement.FocusedElement) && DateTime.UtcNow < deadline) Thread.Sleep(100);
                        if (!Automation.Compare(element, AutomationElement.FocusedElement)) throw new Exception("No user focus received within five minutes");
                        form.Invoke((Action)delegate { first.Select(7, 5); });
                    }
                    var focused = AutomationElement.FocusedElement;
                    bool ownsFocus = Automation.Compare(element, focused);
                    Console.WriteLine("Focus diagnostic: element=" + ownsFocus + ", foreground=" +
                        (form.Handle == (IntPtr)helper.GetMethod("GetForegroundWindow", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, null)) +
                        ", focusHandle=" + (first.Handle == (IntPtr)helper.GetMethod("Focus", BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, null)) +
                        ", targetProcess=" + System.Diagnostics.Process.GetCurrentProcess().Id + ", focusedProcess=" + focused.Current.ProcessId);
                    form.Invoke((Action)delegate { capture(1, element); });
                    insert.Invoke(null, new object[] { 1, "café 世界", true });
                    Thread.Sleep(150);
                    if (!ownsFocus)
                    {
                        form.Invoke((Action)delegate {
                            if (first.Text != "before AFTER" || sends != 0 || current.GetValue(null) != null)
                                throw new Exception("Unfocused field accepted dictation input");
                        });
                        Console.WriteLine("Native focus rejection passed; Windows denied fixture foreground access, so live insertion was not exercised.");
                        result = 2; return;
                    }
                    form.Invoke((Action)delegate {
                        if (first.Text != "before café 世界" || sends != 1) throw new Exception("Unicode insertion/Enter failed: " + first.Text + "/" + sends);
                    });
                    insert.Invoke(null, new object[] { 1, "duplicate", true });
                    AutomationElement wrong = AutomationElement.FromHandle(other.Handle);
                    form.Invoke((Action)delegate { capture(2, wrong); });
                    insert.Invoke(null, new object[] { 2, "wrong field", true });
                    Thread.Sleep(100);
                    form.Invoke((Action)delegate {
                        if (first.Text != "before café 世界" || other.Text != "untouched" || sends != 1) throw new Exception("Duplicate/stale focus changed the field");
                    });
                    Console.WriteLine("Native Unicode, selection replacement, Enter-once and focus rejection passed."); result = 0;
                }
                catch (Exception error) {
                    Console.Error.WriteLine(error);
                }
                finally { form.BeginInvoke((Action)delegate { form.Close(); }); }
            }) { IsBackground = true }.Start();
        };
        Application.Run(form); return result;
    }
}
