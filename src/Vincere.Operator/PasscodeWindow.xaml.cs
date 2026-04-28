using System.Windows;

namespace Vincere.Operator;

public partial class PasscodeWindow : Window
{
    public string? Passcode { get; private set; }

    public PasscodeWindow()
    {
        InitializeComponent();
    }

    private void Ok_Click(object sender, RoutedEventArgs e)
    {
        Passcode = Box.Password;
        DialogResult = true;
        Close();
    }
}
