using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Native Windows shell. All filesystem, pairing and Devices operations remain
// in the canonical ONE runtime, reached only through this process's private pipes.
static class Program {
    internal static string Bundle = AppDomain.CurrentDomain.BaseDirectory;
    internal static Dictionary<string, object> Parse(string text) {
        return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(text);
    }
    internal static string Json(object value) { return new JavaScriptSerializer().Serialize(value); }
    internal static string Text(Dictionary<string, object> value, string key) {
        return value.ContainsKey(key) ? Convert.ToString(value[key]) : "";
    }
    internal static void Validate(Dictionary<string, object> config, string profile) {
        foreach (string key in new [] {"email", "name", "secret", "mountPoint", "directory", "commServerUrl", "inviteUrlPrefix"})
            if (String.IsNullOrWhiteSpace(Text(config, key))) throw new Exception("Missing setting: " + key);
        string mount = Path.GetFullPath(Text(config, "mountPoint")).TrimEnd(Path.DirectorySeparatorChar);
        if (mount == Path.GetPathRoot(mount).TrimEnd(Path.DirectorySeparatorChar)) throw new Exception("Choose a folder, not a drive root.");
        foreach (string protectedPath in new [] {profile, Bundle, Text(config, "directory")}) {
            string full = Path.GetFullPath(protectedPath).TrimEnd(Path.DirectorySeparatorChar);
            if (full.Equals(mount, StringComparison.OrdinalIgnoreCase) ||
                full.StartsWith(mount + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                mount.StartsWith(full + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new Exception("The mount must be separate from installation, settings and storage folders.");
        }
        Uri uri;
        if (!Uri.TryCreate(Text(config, "commServerUrl"), UriKind.Absolute, out uri) || (uri.Scheme != "ws" && uri.Scheme != "wss"))
            throw new Exception("The communication server must use ws:// or wss://.");
        config["mountPoint"] = mount;
        config["directory"] = Path.GetFullPath(Text(config, "directory"));
    }
    internal static Dictionary<string, object> Load(string profile) {
        byte[] bytes = ProtectedData.Unprotect(File.ReadAllBytes(Path.Combine(profile, "profile.dat")), null, DataProtectionScope.CurrentUser);
        try { return Parse(Encoding.UTF8.GetString(bytes)); } finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    internal static void Save(string profile, Dictionary<string, object> config) {
        Validate(config, profile);
        Directory.CreateDirectory(profile);
        byte[] bytes = Encoding.UTF8.GetBytes(Json(config));
        string destination = Path.Combine(profile, "profile.dat");
        string temporary = destination + "." + Guid.NewGuid().ToString("N");
        try {
            File.WriteAllBytes(temporary, ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser));
            if (File.Exists(destination)) File.Replace(temporary, destination, null);
            else File.Move(temporary, destination);
        } finally { Array.Clear(bytes, 0, bytes.Length); if (File.Exists(temporary)) File.Delete(temporary); }
    }
    [STAThread]
    static int Main(string[] args) {
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Refinio", "Filer");
        bool command = args.Length == 2 && (args[0] == "--configure-stdin" || args[0] == "--smoke");
        if (command) profile = Path.GetFullPath(args[1]);
        else if (args.Length > 0 && !(args.Length == 1 && args[0] == "--background")) return 2;
        try {
            Directory.CreateDirectory(profile);
            using (var guard = new FileStream(Path.Combine(profile, "host.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) {
                if (command && args[0] == "--configure-stdin") { Save(profile, Parse(Console.ReadLine())); return 0; }
                if (command) { Smoke(profile).GetAwaiter().GetResult(); return 0; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new Desktop(profile, args.Length == 1));
            }
            return 0;
        } catch (Exception error) {
            // Never print decrypted configuration or bootstrap credentials.
            if (command) Console.Error.WriteLine(error.Message);
            else MessageBox.Show(error.Message, "Filer could not start", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    static async Task Smoke(string profile) {
        using (var runtime = new Runtime()) {
            Exception failure = null;
            try {
                await runtime.Start(Load(profile));
                var devices = (IList)await runtime.Call("devices:listDevices", new {});
                if (devices.Count != 1 || !Convert.ToBoolean(((Dictionary<string, object>)devices[0])["isCurrentDevice"]))
                    throw new Exception("Expected exactly one current device.");
                var root = (Dictionary<string, object>)await runtime.Call("filer:readDir", new {path = "/"});
                if (root.ContainsKey("error")) throw new Exception("Filesystem root is unavailable.");
                if (!Directory.Exists(Path.Combine(Program.Text(Load(profile), "mountPoint"), "Fotos")))
                    throw new Exception("Native Fotos directory is unavailable.");
                Console.WriteLine(Program.Json(new {ready = true, devices = devices.Count, root = root["result"]}));
            } catch (Exception error) { failure = error; }
            await runtime.Stop();
            if (failure != null) throw failure;
        }
    }
}

sealed class Runtime : IDisposable {
    Process child;
    int sequence;
    readonly ConcurrentDictionary<string, TaskCompletionSource<object>> pending = new ConcurrentDictionary<string, TaskCompletionSource<object>>();
    readonly TaskCompletionSource<bool> ready = new TaskCompletionSource<bool>();
    readonly object inputLock = new object();
    bool stopping;
    public event Action<string> Notice;
    public bool Running { get { return child != null && !child.HasExited && ready.Task.Status == TaskStatus.RanToCompletion && !stopping; } }
    public async Task Start(Dictionary<string, object> config) {
        var info = new ProcessStartInfo(Path.Combine(Program.Bundle, "node.exe"), "\"" + Path.Combine(Program.Bundle, "host.mjs") + "\"") {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Program.Bundle,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        info.EnvironmentVariables.Remove("NODE_OPTIONS");
        info.EnvironmentVariables.Remove("NODE_PATH");
        child = new Process {StartInfo = info, EnableRaisingEvents = true};
        child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs line) {
            if (line.Data == null) return;
            try {
                var message = Program.Parse(line.Data);
                if (message.ContainsKey("ready")) { ready.TrySetResult(true); return; }
                if (Program.Text(message, "event") == "nativeOperationError") {
                    Announce(Program.Text(message, "message") + "\n" + Program.Text(message, "path")); return;
                }
                string id = Program.Text(message, "requestId");
                TaskCompletionSource<object> completion;
                if (id.Length > 0 && pending.TryRemove(id, out completion)) {
                    if (message.ContainsKey("success") && Convert.ToBoolean(message["success"])) completion.TrySetResult(message["result"]);
                    else completion.TrySetException(new Exception(Program.Text((Dictionary<string, object>)message["error"], "message")));
                }
            } catch { Fail(new Exception("The private runtime returned an invalid response.")); }
        };
        // Drain stderr without retaining invitation tokens or owner diagnostics in logs.
        child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs line) {
            if (line.Data != null && line.Data.StartsWith("Filer runtime initialization failed")) Announce("Runtime initialization failed. Check your settings and ProjFS installation.");
        };
        child.Exited += delegate { if (!stopping) Fail(new Exception("Filer runtime stopped unexpectedly.")); };
        if (!child.Start()) throw new Exception("Could not start the bundled runtime.");
        child.BeginOutputReadLine(); child.BeginErrorReadLine();
        child.StandardInput.WriteLine(Program.Json(config));
        child.StandardInput.Flush();
        // A startup deadline reports a failed launch; it never retries or drops data.
        if (await Task.WhenAny(ready.Task, Task.Delay(90000)) != ready.Task) throw new Exception("Runtime startup exceeded 90 seconds.");
        await ready.Task;
    }
    void Announce(string message) { var handler = Notice; if (handler != null) handler(message); }
    void Fail(Exception error) {
        ready.TrySetException(error);
        foreach (var item in pending) { TaskCompletionSource<object> completion; if (pending.TryRemove(item.Key, out completion)) completion.TrySetException(error); }
        if (!stopping) Announce(error.Message);
    }
    public async Task<object> Call(string operation, object request) {
        if (!Running) throw new Exception("Filer is not running.");
        string id = Interlocked.Increment(ref sequence).ToString();
        var result = new TaskCompletionSource<object>();
        pending[id] = result;
        try {
            lock (inputLock) { child.StandardInput.WriteLine(Program.Json(new {operation, request, requestId = id})); child.StandardInput.Flush(); }
            if (await Task.WhenAny(result.Task, Task.Delay(30000)) != result.Task) throw new Exception("The operation exceeded 30 seconds; its final status is unknown. Refresh before repeating it.");
            return await result.Task;
        } finally { TaskCompletionSource<object> discarded; pending.TryRemove(id, out discarded); }
    }
    public async Task Stop() {
        stopping = true;
        if (child == null || child.HasExited) return;
        child.StandardInput.Close();
        await Task.Run(delegate { child.WaitForExit(); });
        if (child.ExitCode != 0) throw new Exception("The runtime exited with an error.");
    }
    public void Dispose() { if (child != null) child.Dispose(); }
}

sealed class Desktop : Form {
    readonly string profile;
    readonly bool background;
    Runtime runtime;
    Dictionary<string, object> config;
    readonly Label status = new Label {AutoSize = true, Text = "Starting..."};
    readonly ListBox errors = new ListBox {Dock = DockStyle.Bottom, Height = 85};
    readonly ListView devices = new ListView {Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, MultiSelect = false};
    readonly NotifyIcon tray = new NotifyIcon {Icon = SystemIcons.Application, Text = "Filer", Visible = true};
    bool quitting;
    bool busy;
    public Desktop(string profile, bool background) {
        this.profile = profile; this.background = background;
        Text = "Filer · Settings and Devices"; Width = 740; Height = 460; MinimumSize = new Size(640, 400);
        var actions = new FlowLayoutPanel {Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(8)};
        Add(actions, "Open folder", delegate { OpenFolder(); return Task.FromResult(true); });
        Add(actions, "Settings", async delegate { if (Setup()) await Restart(); });
        Add(actions, "Refresh devices", RefreshDevices);
        Add(actions, "Rename device", RenameDevice);
        Add(actions, "Forget device", ForgetDevice);
        Add(actions, "Restart", Restart);
        actions.Controls.Add(status);
        devices.Columns.Add("Device", 240); devices.Columns.Add("Platform", 110); devices.Columns.Add("Connection", 150);
        Controls.Add(devices); Controls.Add(errors); Controls.Add(actions);
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open folder", null, async delegate { await Run(delegate { OpenFolder(); return Task.FromResult(true); }); });
        menu.Items.Add("Settings and Devices", null, delegate { Show(); WindowState = FormWindowState.Normal; Activate(); });
        menu.Items.Add("Quit Filer", null, delegate { Quit(); });
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += delegate { Show(); WindowState = FormWindowState.Normal; Activate(); };
        Shown += async delegate {
            if (background) Hide();
            await Run(async delegate {
                if (File.Exists(Path.Combine(profile, "profile.dat"))) config = Program.Load(profile);
                else if (!Setup()) { quitting = true; Close(); return; }
                await Restart();
            });
        };
        FormClosing += delegate(object sender, FormClosingEventArgs e) {
            if (!quitting) { e.Cancel = true; if (e.CloseReason == CloseReason.UserClosing) Hide(); else Quit(); }
        };
        FormClosed += delegate { tray.Visible = false; tray.Dispose(); };
    }
    void Add(FlowLayoutPanel panel, string text, Func<Task> action) {
        var button = new Button {Text = text, AutoSize = true};
        button.Click += async delegate { await Run(action); }; panel.Controls.Add(button);
    }
    async Task Run(Func<Task> action) {
        if (busy) return;
        busy = true;
        try { await action(); } catch (Exception error) { Notice(error.Message); }
        finally { busy = false; }
    }
    void Notice(string message) {
        if (InvokeRequired) { BeginInvoke(new Action<string>(Notice), message); return; }
        if (errors.Items.Count >= 100) errors.Items.RemoveAt(0);
        errors.Items.Add(DateTime.Now.ToShortTimeString() + "  " + message.Replace('\n', ' '));
        status.Text = runtime != null && runtime.Running ? "Running · error reported" : "Stopped";
        tray.ShowBalloonTip(8000, "Filer", message, ToolTipIcon.Error);
    }
    bool Setup() {
        using (var form = new Form {Text = "Filer settings", Width = 540, Height = 360, FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterParent, MaximizeBox = false, MinimizeBox = false}) {
            var defaults = config ?? new Dictionary<string, object> {
                {"name", Environment.MachineName}, {"email", ""}, {"secret", ""},
                {"directory", Path.Combine(profile, "storage")}, {"mountPoint", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Filer")},
                {"commServerUrl", "wss://comm10.dev.refinio.one"}, {"inviteUrlPrefix", "https://refinio.one/invite"}};
            var keys = new [] {"email", "secret", "name", "mountPoint", "commServerUrl", "inviteUrlPrefix"};
            var labels = new [] {"ONE email", "Password (blank keeps saved)", "Instance name", "Files folder", "Communication server", "Invitation URL prefix"};
            var fields = new List<TextBox>();
            for (int i = 0; i < keys.Length; i++) {
                form.Controls.Add(new Label {Text = labels[i], Left = 12, Top = 16 + i * 39, Width = 180});
                var field = new TextBox {Left = 195, Top = 12 + i * 39, Width = 310, Text = keys[i] == "secret" ? "" : Program.Text(defaults, keys[i]), UseSystemPasswordChar = keys[i] == "secret"};
                fields.Add(field); form.Controls.Add(field);
            }
            var save = new Button {Text = "Save and restart", Left = 330, Top = 265, Width = 175};
            save.Click += delegate {
                try {
                    var next = new Dictionary<string, object>(defaults);
                    for (int i = 0; i < keys.Length; i++) if (keys[i] != "secret" || fields[i].Text.Length > 0) next[keys[i]] = fields[i].Text;
                    Program.Save(profile, next); config = next; form.DialogResult = DialogResult.OK;
                } catch (Exception error) { MessageBox.Show(form, error.Message, "Settings", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            };
            form.Controls.Add(save); form.AcceptButton = save;
            return form.ShowDialog(this) == DialogResult.OK;
        }
    }
    async Task Restart() {
        if (runtime != null) { status.Text = "Stopping..."; await runtime.Stop(); runtime.Dispose(); }
        devices.Items.Clear();
        Program.Validate(config, profile);
        runtime = new Runtime(); runtime.Notice += Notice; status.Text = "Starting...";
        await runtime.Start(config); status.Text = "Running"; await RefreshDevices();
    }
    async Task RefreshDevices() {
        var list = (IList)await runtime.Call("devices:listDevices", new {});
        devices.Items.Clear();
        foreach (Dictionary<string, object> item in list) {
            bool current = Convert.ToBoolean(item["isCurrentDevice"]);
            var row = new ListViewItem(Program.Text(item, "name") + (current ? " (this device)" : "")) {Tag = item};
            row.SubItems.Add(Program.Text(item, "platform")); row.SubItems.Add(current ? "Local" : Program.Text(item, "connectionState")); devices.Items.Add(row);
        }
    }
    Dictionary<string, object> Selected() {
        if (devices.SelectedItems.Count != 1) throw new Exception("Select a device first.");
        return (Dictionary<string, object>)devices.SelectedItems[0].Tag;
    }
    async Task RenameDevice() {
        var item = Selected();
        using (var form = new Form {Text = "Rename device", Width = 420, Height = 145, StartPosition = FormStartPosition.CenterParent}) {
            var name = new TextBox {Left = 12, Top = 12, Width = 380, Text = Program.Text(item, "name"), MaxLength = 120};
            var save = new Button {Text = "Rename", Left = 290, Top = 50, DialogResult = DialogResult.OK};
            form.Controls.Add(name); form.Controls.Add(save); form.AcceptButton = save;
            if (form.ShowDialog(this) != DialogResult.OK) return;
            await runtime.Call("devices:renameDevice", new {deviceId = item["deviceId"], displayName = name.Text}); await RefreshDevices();
        }
    }
    async Task ForgetDevice() {
        var item = Selected();
        if (Convert.ToBoolean(item["isCurrentDevice"])) throw new Exception("The current device cannot be forgotten.");
        if (MessageBox.Show(this, "Forget this device from your inventory? This does not revoke access or erase its data.", "Forget device", MessageBoxButtons.OKCancel) != DialogResult.OK) return;
        await runtime.Call("devices:removeDevice", new {deviceId = item["deviceId"]}); await RefreshDevices();
    }
    void OpenFolder() { if (config == null) throw new Exception("Configure Filer first."); Process.Start("explorer.exe", "\"" + Program.Text(config, "mountPoint") + "\""); }
    async void Quit() {
        if (busy || quitting) return;
        busy = true;
        try { status.Text = "Stopping..."; if (runtime != null) { await runtime.Stop(); runtime.Dispose(); } quitting = true; Close(); }
        catch (Exception error) { Notice(error.Message); }
        finally { busy = false; }
    }
}
