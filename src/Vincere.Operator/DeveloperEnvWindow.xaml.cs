using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Extensions.DependencyInjection;
using Vincere.Core.Infrastructure;

namespace Vincere.Operator;

public partial class DeveloperEnvWindow : Window
{
    private readonly IServiceProvider _sp;

    public sealed class EnvRow : INotifyPropertyChanged
    {
        private string _key = "";
        private string _value = "";
        public string Key
        {
            get => _key;
            set { _key = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Key))); }
        }
        public string Value
        {
            get => _value;
            set { _value = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Value))); }
        }
        public event PropertyChangedEventHandler? PropertyChanged;
    }

    public ObservableCollection<EnvRow> Rows { get; } = new();

    public DeveloperEnvWindow(IServiceProvider sp)
    {
        _sp = sp;
        InitializeComponent();
        Grid.ItemsSource = Rows;
        PathText.Text = AppPaths.EnvFilePath;
        LoadRows();
    }

    private void LoadRows()
    {
        Rows.Clear();
        var settings = _sp.GetRequiredService<AppSettingsProvider>();
        foreach (var kv in settings.Merged.OrderBy(k => k.Key, StringComparer.OrdinalIgnoreCase))
            Rows.Add(new EnvRow { Key = kv.Key, Value = kv.Value });
    }

    private void Reload_Click(object sender, RoutedEventArgs e)
    {
        _sp.GetRequiredService<AppSettingsProvider>().Reload();
        LoadRows();
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        var dict = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var r in Rows)
        {
            if (string.IsNullOrWhiteSpace(r.Key))
                continue;
            dict[r.Key.Trim()] = r.Value ?? "";
        }

        _sp.GetRequiredService<AppSettingsProvider>().UpdateAndSaveEnvFile(dict);
        MessageBox.Show("Saved. Restart the app if some services need a full process recycle.", "Vincere",
            MessageBoxButton.OK, MessageBoxImage.Information);
        Close();
    }

    private void Grid_OnBeginningEdit(object sender, DataGridBeginningEditEventArgs e)
    {
        // prevent editing key column accidental - allow all for power users
    }
}
