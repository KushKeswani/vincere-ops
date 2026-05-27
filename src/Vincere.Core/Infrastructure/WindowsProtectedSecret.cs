using System.Runtime.InteropServices;
using System.Text;

namespace Vincere.Core.Infrastructure;

public static class WindowsProtectedSecret
{
    public static string Protect(string secret)
    {
        if (!OperatingSystem.IsWindows())
            throw new PlatformNotSupportedException("Windows DPAPI is required to store NinjaTrader login secrets.");
        if (string.IsNullOrEmpty(secret))
            return "";

        var bytes = Encoding.UTF8.GetBytes(secret);
        var input = ToBlob(bytes);
        var output = new DataBlob();
        try
        {
            if (!CryptProtectData(ref input, "Vincere NinjaTrader login", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref output))
                throw new InvalidOperationException("Could not encrypt NinjaTrader login secret.");
            var protectedBytes = FromBlob(output);
            return Convert.ToBase64String(protectedBytes);
        }
        finally
        {
            FreeInputBlob(input);
            FreeOutputBlob(output);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn,
        string? szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        ref DataBlob pDataOut);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr LocalFree(IntPtr hMem);

    private static DataBlob ToBlob(byte[] bytes)
    {
        var blob = new DataBlob { cbData = bytes.Length };
        blob.pbData = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, blob.pbData, bytes.Length);
        return blob;
    }

    private static byte[] FromBlob(DataBlob blob)
    {
        if (blob.cbData <= 0 || blob.pbData == IntPtr.Zero)
            return Array.Empty<byte>();
        var bytes = new byte[blob.cbData];
        Marshal.Copy(blob.pbData, bytes, 0, blob.cbData);
        return bytes;
    }

    private static void FreeInputBlob(DataBlob blob)
    {
        if (blob.pbData == IntPtr.Zero)
            return;
        Marshal.FreeHGlobal(blob.pbData);
    }

    private static void FreeOutputBlob(DataBlob blob)
    {
        if (blob.pbData == IntPtr.Zero)
            return;
        LocalFree(blob.pbData);
    }
}
