// Vincere Ops — NinjaTrader 8 Add-On
// Place in: Documents\NinjaTrader 8\bin\Custom\AddOns\VincereOperator\
// Then: NinjaScript Editor -> Compile. Must match VINCERE_IPC_PIPE_NAME in Vincere Ops .env (default: VincereOperator)
//
// NOTE: This file is compiled by NinjaTrader, not "dotnet build" in the main solution.
// If you get compile errors, check the Help Guide for your exact NT 8.1.x build and adjust usings / API.

#region Using declarations
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.Core;
using NinjaTrader.NinjaScript;
#endregion

// This namespace is required for Add Ons
namespace NinjaTrader.NinjaScript
{
	/// <summary>Named-pipe IPC for the external Vincere Operator app (JSON one line in, one line out).</summary>
	public class VincereOperatorIpcAddOn : AddOnBase
	{
		private const string PipeName = "VincereOperator";
		private CancellationTokenSource _cts;
		private Task _loop;
		private bool _started;

		protected override void OnStateChange()
		{
			if (State == State.SetDefaults)
			{
				Name = "VincereOperatorIpc";
				Description = @"Hosts a local named pipe for the Vincere Ops Windows app. See vincere-ops repo nt8-addon/README.md.";
			}
			else if (State == State.Configure)
			{
				// Add Ons: one-time configuration; start the server once.
				if (!_started)
				{
					_started = true;
					StartPipe();
				}
			}
			else if (State == State.Terminated)
			{
				StopPipe();
				_started = false;
			}
		}

		private void StartPipe()
		{
			try
			{
				StopPipe();
				_cts = new CancellationTokenSource();
				var tok = _cts.Token;
				_loop = Task.Run(() => PipeLoop(tok), tok);
				Print($"{DateTime.Now}: Vincere IPC: pipe server starting ({PipeName})...");
			}
			catch (Exception ex)
			{
				Print($"{DateTime.Now}: Vincere IPC: start failed: {ex.Message}");
			}
		}

		private void StopPipe()
		{
			try
			{
				if (_cts != null)
				{
					_cts.Cancel();
					try { _loop?.Wait(3000); } catch { }
				}
			}
			catch { }
			finally
			{
				_loop = null;
				_cts?.Dispose();
				_cts = null;
				Print($"{DateTime.Now}: Vincere IPC: pipe server stopped.");
			}
		}

		private void PipeLoop(CancellationToken ct)
		{
			Print($"{DateTime.Now}: Vincere IPC: loop running.");
			while (!ct.IsCancellationRequested)
			{
				NamedPipeServerStream stream = null;
				try
				{
					stream = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
						PipeTransmissionMode.Byte, PipeOptions.Asynchronous);

					stream.WaitForConnection(); // blocking; OK on background thread

					using (var sr = new StreamReader(stream, Encoding.UTF8, false, 65536, true))
					using (var sw = new StreamWriter(stream, Encoding.UTF8, 65536, true) { AutoFlush = true })
					{
						stream = null;
						string line = sr.ReadLine();
						if (string.IsNullOrWhiteSpace(line))
							continue;

						string reply = HandleRequest(line);
						sw.WriteLine(reply);
						sw.Flush();
					}
				}
				catch (Exception ex)
				{
					if (!ct.IsCancellationRequested)
						Print($"{DateTime.Now}: Vincere IPC: pipe error: {ex.Message}");
				}
				finally
				{
					try { stream?.Dispose(); } catch { }
				}
			}
		}

		private string HandleRequest(string jsonLine)
		{
			string id = Extract(jsonLine, @"""id""\s*:\s*""([^""]*)""") ?? Guid.NewGuid().ToString("N");
			string cmd = Extract(jsonLine, @"""command""\s*:\s*""([^""]*)""");

			try
			{
				if (string.IsNullOrEmpty(cmd))
					return JsonResp(id, false, "missing command");

				cmd = cmd.Trim();

				switch (cmd)
				{
					case "PING":
						return JsonResp(id, true, "pong");

					case "GET_STATUS":
						return JsonResp(id, true, "running");

					case "REFRESH_CONNECTION":
						var connName = ExtractPayloadConnectionName(jsonLine);
						if (string.IsNullOrWhiteSpace(connName))
							return JsonResp(id, false, "missing connection name in payload");
						RefreshConnection(connName);
						return JsonResp(id, true, "refresh requested");

					case "ENABLE_ALL_STRATEGIES":
						Print($"{DateTime.Now}: Vincere IPC: ENABLE_ALL_STRATEGIES — extend this Add-On with your NT version's Strategy APIs.");
						return JsonResp(id, true, "stub ok — enable-all not implemented");

					case "DISABLE_ALL_STRATEGIES":
						Print($"{DateTime.Now}: Vincere IPC: DISABLE_ALL_STRATEGIES — stub.");
						return JsonResp(id, true, "stub ok — disable-all not implemented");

					case "APPLY_STACK":
						Print($"{DateTime.Now}: Vincere IPC: APPLY_STACK payload: " + TrimForLog(jsonLine));
						Print($"{DateTime.Now}: Vincere IPC: Implement strategy instantiation here for your algos/templates.");
						return JsonResp(id, true, "stub ok — logged payload; attach strategies in Add-On");

					default:
						return JsonResp(id, false, "unknown command: " + cmd);
				}
			}
			catch (Exception ex)
			{
				return JsonResp(id, false, ex.Message);
			}
		}

		private static string TrimForLog(string s)
		{
			if (s == null) return "";
			return s.Length <= 800 ? s : s.Substring(0, 800) + "...";
		}

		private static string JsonResp(string id, bool ok, string message)
		{
			string esc = EscapeJson(message ?? "");
			return $"{{\"id\":\"{id}\",\"ok\":{(ok ? "true" : "false")},\"message\":\"{esc}\"}}";
		}

		private static string EscapeJson(string m)
		{
			// .NET Framework (NinjaScript) has no Replace(string, string, StringComparison) — use 2-arg overloads.
			if (m == null) return "";
			return m.Replace("\\", "\\\\").Replace("\"", "\\\"");
		}

		private static string Extract(string input, string pattern)
		{
			if (string.IsNullOrEmpty(input)) return null;
			var m = Regex.Match(input, pattern);
			return m.Success ? m.Groups[1].Value : null;
		}

		private static string ExtractPayloadConnectionName(string jsonLine)
		{
			// Try \"connectionName\":\"PROP\"
			var direct = Extract(jsonLine, @"""connectionName""\s*:\s*""([^""]*)""");
			if (!string.IsNullOrEmpty(direct))
				return direct;
			return null;
		}

		private void RefreshConnection(string connectionDisplayName)
		{
			// Forum guidance: Disconnect / Connect — if this misbehaves off the UI thread, marshal with NinjaTrader dispatcher per NT docs.
			try
			{
				ConnectOptions opts = null;
				lock (Core.Globals.ConnectOptions)
				{
					foreach (ConnectOptions o in Core.Globals.ConnectOptions)
					{
						if (o != null && o.Name == connectionDisplayName)
						{
							opts = o;
							break;
						}
					}
				}

				if (opts == null)
				{
					Print($"{DateTime.Now}: Vincere IPC: no ConnectOptions named '{connectionDisplayName}'.");
					return;
				}

				Connection existing = null;
				lock (Connection.Connections)
				{
					foreach (Connection c in Connection.Connections)
					{
						if (c?.Options != null && c.Options.Name == connectionDisplayName)
						{
							existing = c;
							break;
						}
					}
				}

				if (existing != null)
				{
					Print($"{DateTime.Now}: Vincere IPC: disconnecting {connectionDisplayName}...");
					existing.Disconnect();
					Thread.Sleep(750);
				}

				Print($"{DateTime.Now}: Vincere IPC: connecting {connectionDisplayName}...");
				Connection connected = Connection.Connect(opts);
				if (connected == null)
					Print($"{DateTime.Now}: Vincere IPC: Connect returned null.");
				else
					Print($"{DateTime.Now}: Vincere IPC: Connect invoked (status may still be connecting).");
			}
			catch (Exception ex)
			{
				Print($"{DateTime.Now}: Vincere IPC: RefreshConnection error: {ex}");
			}
		}
	}
}
