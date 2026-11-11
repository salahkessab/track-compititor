using System;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

// Compiled by the installed Windows .NET Framework during setup. No service or admin access is needed.
public static class RecipeIntelligenceFolderPicker
{
    [STAThread]
    public static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        if (args.Length == 2 && args[0] == "--error")
        {
            MessageBox.Show(args[1], "Recipe Intelligence", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        if (args.Length != 2) return;
        using (var form = new Form())
        {
            form.Text = "Recipe Intelligence - storage setup";
            form.ClientSize = new Size(620, 200);
            form.StartPosition = FormStartPosition.CenterScreen;
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.MaximizeBox = false;
            form.AutoScaleMode = AutoScaleMode.Dpi;
            form.Font = new Font("Segoe UI", 9);
            var label = new Label { Text = "Choose a local folder for the database, backups, and recipe files." };
            label.SetBounds(18, 18, 590, 26);
            var box = new TextBox();
            box.SetBounds(18, 55, 480, 28);
            box.Text = string.IsNullOrEmpty(args[1]) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RecipeAutomation") : args[1];
            var browse = new Button { Text = "Browse..." };
            browse.SetBounds(510, 53, 94, 30);
            browse.Click += delegate {
                using (var dialog = new FolderBrowserDialog())
                {
                    dialog.Description = "Choose a local Recipe Intelligence storage folder";
                    if (Directory.Exists(box.Text)) dialog.SelectedPath = box.Text;
                    if (dialog.ShowDialog(form) == DialogResult.OK) box.Text = dialog.SelectedPath;
                }
            };
            var note = new Label { Text = "Choose a local disk. Existing folders are kept. The first build can take a few minutes." };
            note.SetBounds(18, 98, 585, 32);
            var ok = new Button { Text = "Save and start", DialogResult = DialogResult.OK };
            ok.SetBounds(380, 146, 120, 32);
            var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel };
            cancel.SetBounds(510, 146, 94, 32);
            form.Controls.AddRange(new Control[] { label, box, browse, note, ok, cancel });
            form.AcceptButton = ok;
            form.CancelButton = cancel;
            if (form.ShowDialog() == DialogResult.OK) File.WriteAllText(args[0], box.Text.Trim(), new UTF8Encoding(false));
        }
    }
}
