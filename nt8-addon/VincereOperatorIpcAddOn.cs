// Vincere Ops - NinjaTrader 8 Add-On
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

// AddOns must be declared under NinjaTrader.NinjaScript.AddOns so NT instantiates them on startup.
namespace NinjaTrader.NinjaScript.AddOns
{
	/// <summary>Named-pipe IPC for the external Vincere Operator app (JSON one line in, one line out).</summary>
	public class VincereOperatorIpcAddOn : AddOnBase
	{
		private const string PipeName = "VincereOperator2";
		private static readonly object StartStopLock = new object();
		private static bool _globalStarted;
		private static CancellationTokenSource _globalCts;
		private static Task _globalLoop;
		private static NamedPipeServerStream _globalWaitingPipe;
		private bool _started;
		private bool _ownsPipe;

		private void TraceInfo(string message)
		{
			string full = $"{DateTime.Now}: Vincere IPC: {message}";
			try { Print(full); } catch { }
			try { Log("Vincere IPC: " + message, LogLevel.Information); } catch { }
		}

		protected override void OnStateChange()
		{
			if (State == State.SetDefaults)
			{
				Name = "VincereOperatorIpc";
				Description = @"Hosts a local named pipe for the Vincere Ops Windows app. See vincere-ops repo nt8-addon/README.md.";
				TraceInfo("SetDefaults reached.");
			}
			else if (State == State.Configure)
			{
				// Add Ons: one-time configuration; start one process-wide pipe listener.
				if (!_started)
				{
					_started = true;
					TraceInfo("Configure reached; starting pipe...");
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
			lock (StartStopLock)
			{
				try
				{
					if (_globalStarted && _globalLoop != null && !_globalLoop.IsCompleted)
					{
						TraceInfo("start skipped: global listener already running.");
						return;
					}

					StopPipeCore();
					_globalCts = new CancellationTokenSource();
					var tok = _globalCts.Token;
					_globalLoop = Task.Run(() => PipeLoop(tok), tok);
					_globalStarted = true;
					_ownsPipe = true;
					TraceInfo($"pipe server starting ({PipeName})...");
				}
				catch (Exception ex)
				{
					TraceInfo("start failed: " + ex.Message);
				}
			}
		}

		private void StopPipe()
		{
			lock (StartStopLock)
			{
				if (_ownsPipe)
				{
					StopPipeCore();
					_ownsPipe = false;
				}
			}
		}

		private void StopPipeCore()
		{
			try
			{
				if (_globalCts != null)
				{
					_globalCts.Cancel();
					try { _globalWaitingPipe?.Dispose(); } catch { }
					try { _globalLoop?.Wait(3000); } catch { }
				}
			}
			catch { }
			finally
			{
				_globalLoop = null;
				_globalCts?.Dispose();
				_globalCts = null;
				_globalWaitingPipe = null;
				_globalStarted = false;
				TraceInfo("pipe server stopped.");
			}
		}

		private void PipeLoop(CancellationToken ct)
		{
			TraceInfo("loop running.");
			while (!ct.IsCancellationRequested)
			{
				try
				{
					// Own the pipe with one using; the outer using disposes it after each request.
					using (var pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
						       PipeTransmissionMode.Byte, PipeOptions.None, 65536, 65536))
					{
						_globalWaitingPipe = pipe;
						TraceInfo("waiting for client...");
						pipe.WaitForConnection(); // blocking; OK on background thread
						_globalWaitingPipe = null;
						TraceInfo("client connected.");

						TraceInfo("reading request...");
						string line = ReadUtf8Line(pipe, 5000);
						if (string.IsNullOrWhiteSpace(line))
						{
							TraceInfo("empty request or read timeout.");
							continue;
						}

						TraceInfo("request received.");
						string reply = HandleRequestWithTimeout(line);
						using (var sw = new StreamWriter(pipe, new UTF8Encoding(false), 65536, true) { AutoFlush = true })
						{
							sw.WriteLine(reply);
							sw.Flush();
						}
					}
				}
				catch (Exception ex)
				{
					if (!ct.IsCancellationRequested)
					{
						TraceInfo("pipe error: " + ex.Message);
						Thread.Sleep(250);
					}
				}
			}
		}

		private string ReadUtf8Line(Stream stream, int timeoutMs)
		{
			var bytes = new List<byte>(1024);
			try { stream.ReadTimeout = timeoutMs; } catch { }

			try
			{
				while (bytes.Count < 65536)
				{
					int value = stream.ReadByte();
					if (value < 0)
						break;
					if (value == 10)
						break;
					if (value != 13)
						bytes.Add((byte)value);
				}

				if (bytes.Count == 0)
					return null;
				return Encoding.UTF8.GetString(bytes.ToArray());
			}
			catch
			{
				return null;
			}
		}

		private string HandleRequestWithTimeout(string jsonLine)
		{
			string id = Extract(jsonLine, @"""id""\s*:\s*""([^""]*)""") ?? Guid.NewGuid().ToString("N");
			string cmd = Extract(jsonLine, @"""command""\s*:\s*""([^""]*)""") ?? "UNKNOWN";

			try
			{
				var task = Task.Run(() => HandleRequest(jsonLine));
				if (task.Wait(TimeSpan.FromSeconds(8)))
					return task.Result;

				TraceInfo("request timeout: " + cmd);
				return JsonResp(id, false, "request timeout: " + cmd);
			}
			catch (Exception ex)
			{
				TraceInfo("request wrapper error: " + ex.Message);
				return JsonResp(id, false, ex.Message);
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
						TraceInfo("PING received.");
						return JsonResp(id, true, "pong");

					case "GET_STATUS":
						return JsonResp(id, true, "running");

					case "LIST_CONNECTIONS":
						return JsonPayloadResp(id, true, "connections listed", "connections", ListConnectionNames());

					case "LIST_ACCOUNTS":
						return JsonPayloadResp(id, true, "accounts listed", "accounts", ListAccountNames());

					case "REFRESH_CONNECTION":
						var connName = ExtractPayloadConnectionName(jsonLine);
						if (string.IsNullOrWhiteSpace(connName))
							return JsonResp(id, false, "missing connection name in payload");
						RefreshConnection(connName);
						return JsonResp(id, true, "refresh requested");

					case "CONNECT_CONNECTION":
						var connectName = ExtractPayloadConnectionName(jsonLine);
						if (string.IsNullOrWhiteSpace(connectName))
							return JsonResp(id, false, "missing connection name in payload");
						var connectResult = ConnectConnection(connectName);
						return JsonResp(id, true, connectResult);

					case "DISCONNECT_CONNECTION":
						var disconnectName = ExtractPayloadConnectionName(jsonLine);
						if (string.IsNullOrWhiteSpace(disconnectName))
							return JsonResp(id, false, "missing connection name in payload");
						DisconnectConnection(disconnectName);
						return JsonResp(id, true, "disconnect requested");

					case "ENABLE_ALL_STRATEGIES":
						Print($"{DateTime.Now}: Vincere IPC: ENABLE_ALL_STRATEGIES - extend this Add-On with your NT version's Strategy APIs.");
						return JsonResp(id, true, "stub ok - enable-all not implemented");

					case "DISABLE_ALL_STRATEGIES":
						Print($"{DateTime.Now}: Vincere IPC: DISABLE_ALL_STRATEGIES - stub.");
						return JsonResp(id, true, "stub ok - disable-all not implemented");

					case "APPLY_STACK":
						Print($"{DateTime.Now}: Vincere IPC: APPLY_STACK payload: " + TrimForLog(jsonLine));
						Print($"{DateTime.Now}: Vincere IPC: Implement strategy instantiation here for your algos/templates.");
						return JsonResp(id, true, "stub ok - logged payload; attach strategies in Add-On");

					case "GET_ACCOUNT_STATE":
						Print($"{DateTime.Now}: Vincere IPC: GET_ACCOUNT_STATE - extend this Add-On with account P&L/position snapshot APIs.");
						return JsonResp(id, false, "not implemented - account state/P&L snapshot needs NT account API wiring");

					case "FLATTEN_ALL":
						Print($"{DateTime.Now}: Vincere IPC: FLATTEN_ALL payload: " + TrimForLog(jsonLine));
						Print($"{DateTime.Now}: Vincere IPC: Implement cancel-orders, flatten positions, and disable-strategies here before live use.");
						return JsonResp(id, false, "not implemented - flatten-all needs NT account/order API wiring");

					case "FLATTEN_ACCOUNT":
						Print($"{DateTime.Now}: Vincere IPC: FLATTEN_ACCOUNT payload: " + TrimForLog(jsonLine));
						return JsonResp(id, false, "not implemented - account flatten needs NT account/order API wiring");

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

		private static string JsonPayloadResp(string id, bool ok, string message, string payloadName, IEnumerable<string> values)
		{
			var sb = new StringBuilder();
			sb.Append("{\"id\":\"").Append(EscapeJson(id)).Append("\",\"ok\":").Append(ok ? "true" : "false");
			sb.Append(",\"message\":\"").Append(EscapeJson(message ?? "")).Append("\",\"payload\":{\"");
			sb.Append(EscapeJson(payloadName)).Append("\":[");
			bool first = true;
			foreach (string value in values)
			{
				if (!first)
					sb.Append(",");
				sb.Append("\"").Append(EscapeJson(value ?? "")).Append("\"");
				first = false;
			}
			sb.Append("]}}");
			return sb.ToString();
		}

		private static string EscapeJson(string m)
		{
			// .NET Framework (NinjaScript) has no Replace(string, string, StringComparison); use 2-arg overloads.
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
			try
			{
				DisconnectConnection(connectionDisplayName);
				Thread.Sleep(750);
				ConnectConnection(connectionDisplayName);
			}
			catch (Exception ex)
			{
				Print($"{DateTime.Now}: Vincere IPC: RefreshConnection error: {ex}");
			}
		}

		private static List<string> ListConnectionNames()
		{
			var names = new List<string>();
			try
			{
				// Avoid taking NT's ConnectOptions lock from the IPC thread; a stale lock here can block the pipe server.
				foreach (ConnectOptions o in Core.Globals.ConnectOptions)
				{
					if (o != null && !string.IsNullOrWhiteSpace(o.Name) && !names.Contains(o.Name))
						names.Add(o.Name);
				}
			}
			catch { }
			names.Sort(StringComparer.OrdinalIgnoreCase);
			return names;
		}

		private static List<string> ListAccountNames()
		{
			var names = new List<string>();
			try
			{
				foreach (Account account in Account.All)
				{
					if (account != null && !string.IsNullOrWhiteSpace(account.Name) && !names.Contains(account.Name))
						names.Add(account.Name);
				}
			}
			catch { }
			names.Sort(StringComparer.OrdinalIgnoreCase);
			return names;
		}

		private string ConnectConnection(string connectionDisplayName)
		{
			// Forum guidance: ConnectOptions + Connection.Connect. If this misbehaves off the UI thread, marshal with NinjaTrader dispatcher per NT docs.
			try
			{
				Connection existing = FindConnection(connectionDisplayName);
				if (existing != null)
				{
					var status = DescribeConnectionStatus(existing);
					if (IsConnectionActive(existing))
					{
						var activeMessage = $"'{connectionDisplayName}' already active ({status}); skipped duplicate connect.";
						Print($"{DateTime.Now}: Vincere IPC: {activeMessage}");
						return activeMessage;
					}

					Print($"{DateTime.Now}: Vincere IPC: '{connectionDisplayName}' exists but is not active ({status}); reconnecting via ConnectOptions.");
				}

				ConnectOptions opts = FindConnectOptions(connectionDisplayName);
				if (opts == null)
				{
					var missingMessage = $"no ConnectOptions named '{connectionDisplayName}'";
					Print($"{DateTime.Now}: Vincere IPC: {missingMessage}.");
					return missingMessage;
				}

				Print($"{DateTime.Now}: Vincere IPC: connecting {connectionDisplayName}...");
				Connection connected = Connection.Connect(opts);
				if (connected == null)
				{
					Print($"{DateTime.Now}: Vincere IPC: Connect returned null.");
					return $"connect invoked for '{connectionDisplayName}' but returned null";
				}
				else
				{
					Print($"{DateTime.Now}: Vincere IPC: Connect invoked (status may still be connecting).");
					return $"connect invoked for '{connectionDisplayName}'";
				}
			}
			catch (Exception ex)
			{
				Print($"{DateTime.Now}: Vincere IPC: ConnectConnection error: {ex}");
				return $"connect error for '{connectionDisplayName}': {ex.Message}";
			}
		}

		private void DisconnectConnection(string connectionDisplayName)
		{
			try
			{
				Connection existing = FindConnection(connectionDisplayName);
				if (existing == null)
				{
					Print($"{DateTime.Now}: Vincere IPC: no active connection named '{connectionDisplayName}' to disconnect.");
					return;
				}

				Print($"{DateTime.Now}: Vincere IPC: disconnecting {connectionDisplayName}...");
				existing.Disconnect();
			}
			catch (Exception ex)
			{
				Print($"{DateTime.Now}: Vincere IPC: DisconnectConnection error: {ex}");
			}
		}

		private static ConnectOptions FindConnectOptions(string connectionDisplayName)
		{
			foreach (ConnectOptions o in Core.Globals.ConnectOptions)
			{
				if (o != null && o.Name == connectionDisplayName)
					return o;
			}
			return null;
		}

		private static Connection FindConnection(string connectionDisplayName)
		{
			lock (Connection.Connections)
			{
				foreach (Connection c in Connection.Connections)
				{
					if (c?.Options != null && c.Options.Name == connectionDisplayName)
						return c;
				}
			}
			return null;
		}

		private static bool IsConnectionActive(Connection connection)
		{
			var status = DescribeConnectionStatus(connection);
			if (status.IndexOf("Disconnect", StringComparison.OrdinalIgnoreCase) >= 0)
				return false;
			return status.IndexOf("Connected", StringComparison.OrdinalIgnoreCase) >= 0 ||
			       status.IndexOf("Connecting", StringComparison.OrdinalIgnoreCase) >= 0;
		}

		private static string DescribeConnectionStatus(Connection connection)
		{
			if (connection == null)
				return "null";

			var parts = new List<string>();
			AddPropertyValue(connection, "Status", parts);
			AddPropertyValue(connection, "PriceStatus", parts);
			AddPropertyValue(connection, "PreviousStatus", parts);
			return parts.Count == 0 ? "unknown status" : string.Join(", ", parts);
		}

		private static void AddPropertyValue(object target, string propertyName, List<string> parts)
		{
			try
			{
				var property = target.GetType().GetProperty(propertyName);
				if (property == null)
					return;

				var value = property.GetValue(target, null);
				if (value != null)
					parts.Add(propertyName + "=" + value);
			}
			catch
			{
				// Best effort status details only.
			}
		}
	}
}
