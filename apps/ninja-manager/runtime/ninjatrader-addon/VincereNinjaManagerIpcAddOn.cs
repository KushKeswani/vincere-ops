#region Using declarations
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
    [DataContract]
    internal sealed class VnmIpcRequest
    {
        [DataMember(Name = "protocolVersion", Order = 1)] public string ProtocolVersion { get; set; }
        [DataMember(Name = "requestId", Order = 2)] public string RequestId { get; set; }
        [DataMember(Name = "issuedAt", Order = 3)] public string IssuedAt { get; set; }
        [DataMember(Name = "nonce", Order = 4)] public string Nonce { get; set; }
        [DataMember(Name = "command", Order = 5)] public string Command { get; set; }
        [DataMember(Name = "payloadJson", Order = 6)] public string PayloadJson { get; set; }
        [DataMember(Name = "payloadSha256", Order = 7)] public string PayloadSha256 { get; set; }
        [DataMember(Name = "signature", Order = 8)] public string Signature { get; set; }
    }

    [DataContract]
    internal sealed class VnmIpcResponse
    {
        [DataMember(Name = "protocolVersion", Order = 1)] public string ProtocolVersion { get; set; }
        [DataMember(Name = "requestId", Order = 2)] public string RequestId { get; set; }
        [DataMember(Name = "respondedAt", Order = 3)] public string RespondedAt { get; set; }
        [DataMember(Name = "ok", Order = 4)] public bool Ok { get; set; }
        [DataMember(Name = "code", Order = 5)] public string Code { get; set; }
        [DataMember(Name = "payloadJson", Order = 6)] public string PayloadJson { get; set; }
        [DataMember(Name = "payloadSha256", Order = 7)] public string PayloadSha256 { get; set; }
        [DataMember(Name = "signature", Order = 8)] public string Signature { get; set; }
    }

    [DataContract]
    internal sealed class VnmPingPayload
    {
        [DataMember(Name = "addonVersion", Order = 1)] public string AddonVersion { get; set; }
        [DataMember(Name = "protocolVersion", Order = 2)] public string ProtocolVersion { get; set; }
    }

    [DataContract]
    internal sealed class VnmCapabilitiesPayload
    {
        [DataMember(Name = "addonVersion", Order = 1)] public string AddonVersion { get; set; }
        [DataMember(Name = "commands", Order = 2)] public List<string> Commands { get; set; }
        [DataMember(Name = "authority", Order = 3)] public string Authority { get; set; }
    }

    [DataContract]
    internal sealed class VnmRuntimeSnapshot
    {
        [DataMember(Name = "observedAt", Order = 1)] public string ObservedAt { get; set; }
        [DataMember(Name = "addonVersion", Order = 2)] public string AddonVersion { get; set; }
        [DataMember(Name = "accounts", Order = 3)] public List<VnmAccountObservation> Accounts { get; set; }
        [DataMember(Name = "strategies", Order = 4)] public List<VnmStrategyObservation> Strategies { get; set; }
    }

    [DataContract]
    internal sealed class VnmAccountObservation
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "accountName", Order = 2)] public string AccountName { get; set; }
        [DataMember(Name = "accountKind", Order = 3)] public string AccountKind { get; set; }
        [DataMember(Name = "connectionName", Order = 4)] public string ConnectionName { get; set; }
        [DataMember(Name = "connectionStatus", Order = 5)] public string ConnectionStatus { get; set; }
    }

    [DataContract]
    internal sealed class VnmStrategyObservation
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "accountLocalId", Order = 2)] public string AccountLocalId { get; set; }
        [DataMember(Name = "strategyName", Order = 3)] public string StrategyName { get; set; }
        [DataMember(Name = "strategyType", Order = 4)] public string StrategyType { get; set; }
        [DataMember(Name = "instrument", Order = 5)] public string Instrument { get; set; }
        [DataMember(Name = "timeframe", Order = 6)] public string Timeframe { get; set; }
        [DataMember(Name = "enabled", Order = 7)] public bool Enabled { get; set; }
        [DataMember(Name = "sync", Order = 8)] public bool? Sync { get; set; }
        [DataMember(Name = "runtimeState", Order = 9)] public string RuntimeState { get; set; }
        [DataMember(Name = "stateCode", Order = 10)] public string StateCode { get; set; }
    }

    internal sealed class VnmStrategyCandidate
    {
        public string CompositeKey { get; set; }
        public VnmStrategyObservation Observation { get; set; }
    }

    // Runtime v2 DTOs deliberately contain only evidence owned by the in-process
    // Add-On. Process/install/session identity, receipt time, manager ledgers,
    // item counts, and overall collection status are companion-owned concerns.
    [DataContract]
    internal sealed class VnmRuntimeObservationV2
    {
        [DataMember(Name = "protocolVersion", Order = 1)] public string ProtocolVersion { get; set; }
        [DataMember(Name = "observedAt", Order = 2)] public string ObservedAt { get; set; }
        [DataMember(Name = "addon", Order = 3)] public VnmAddonObservationV2 Addon { get; set; }
        [DataMember(Name = "connections", Order = 4)] public List<VnmConnectionObservationV2> Connections { get; set; }
        [DataMember(Name = "accounts", Order = 5)] public List<VnmAccountObservationV2> Accounts { get; set; }
        [DataMember(Name = "strategies", Order = 6)] public List<VnmStrategyObservationV2> Strategies { get; set; }
        [DataMember(Name = "positions", Order = 7)] public List<VnmPositionObservationV2> Positions { get; set; }
        [DataMember(Name = "orders", Order = 8)] public List<VnmOrderObservationV2> Orders { get; set; }
        [DataMember(Name = "executions", Order = 9)] public List<VnmExecutionObservationV2> Executions { get; set; }
        [DataMember(Name = "pnl", Order = 10)] public List<VnmPnlObservationV2> Pnl { get; set; }
        [DataMember(Name = "collectionScopes", Order = 11)] public VnmCollectionScopesV2 CollectionScopes { get; set; }
    }

    [DataContract]
    internal sealed class VnmAddonObservationV2
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "status", Order = 2)] public string Status { get; set; }
        [DataMember(Name = "health", Order = 3)] public string Health { get; set; }
        [DataMember(Name = "version", Order = 4)] public string Version { get; set; }
        [DataMember(Name = "ipcAuthenticated", Order = 5)] public bool IpcAuthenticated { get; set; }
        [DataMember(Name = "capabilities", Order = 6)] public List<string> Capabilities { get; set; }
    }

    [DataContract]
    internal sealed class VnmConnectionObservationV2
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "kind", Order = 2)] public string Kind { get; set; }
        [DataMember(Name = "providerCode", Order = 3)] public string ProviderCode { get; set; }
        [DataMember(Name = "status", Order = 4)] public string Status { get; set; }
        [DataMember(Name = "health", Order = 5)] public string Health { get; set; }
        [DataMember(Name = "marketDataStatus", Order = 6)] public string MarketDataStatus { get; set; }
        [DataMember(Name = "lastStateChangeAt", Order = 7)] public string LastStateChangeAt { get; set; }
    }

    [DataContract]
    internal sealed class VnmClassificationEvidenceV2
    {
        [DataMember(Name = "accountType", Order = 1)] public string AccountType { get; set; }
        [DataMember(Name = "isSimulation", Order = 2)] public bool? IsSimulation { get; set; }
        [DataMember(Name = "simulationMode", Order = 3)] public bool? SimulationMode { get; set; }
        [DataMember(Name = "unavailableReasonCode", Order = 4)] public string UnavailableReasonCode { get; set; }
    }

    [DataContract]
    internal sealed class VnmAccountObservationV2
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "accountIdentifier", Order = 2)] public string AccountIdentifier { get; set; }
        [DataMember(Name = "classificationEvidence", Order = 3)] public VnmClassificationEvidenceV2 ClassificationEvidence { get; set; }
        [DataMember(Name = "connectionLocalIds", Order = 4)] public List<string> ConnectionLocalIds { get; set; }
        [DataMember(Name = "status", Order = 5)] public string Status { get; set; }
    }

    [DataContract]
    internal sealed class VnmParameterValueV2
    {
        [DataMember(Name = "kind", Order = 1)] public string Kind { get; set; }
        [DataMember(Name = "value", Order = 2)] public object Value { get; set; }
    }

    [DataContract]
    internal sealed class VnmOperationalParameterV2
    {
        [DataMember(Name = "parameterCode", Order = 1)] public string ParameterCode { get; set; }
        [DataMember(Name = "value", Order = 2)] public VnmParameterValueV2 Value { get; set; }
    }

    [DataContract]
    internal sealed class VnmStrategyObservationV2
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "accountLocalId", Order = 2)] public string AccountLocalId { get; set; }
        [DataMember(Name = "strategyTypeCode", Order = 3)] public string StrategyTypeCode { get; set; }
        [DataMember(Name = "instrumentCode", Order = 4)] public string InstrumentCode { get; set; }
        [DataMember(Name = "enabled", Order = 5)] public bool Enabled { get; set; }
        [DataMember(Name = "runtimeState", Order = 6)] public string RuntimeState { get; set; }
        [DataMember(Name = "synchronizationState", Order = 7)] public string SynchronizationState { get; set; }
        [DataMember(Name = "operationalParameters", Order = 8)] public List<VnmOperationalParameterV2> OperationalParameters { get; set; }
        [DataMember(Name = "lastStateChangeAt", Order = 9)] public string LastStateChangeAt { get; set; }
    }

    [DataContract]
    internal sealed class VnmPositionObservationV2
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "accountLocalId", Order = 2)] public string AccountLocalId { get; set; }
        [DataMember(Name = "strategyLocalId", Order = 3)] public string StrategyLocalId { get; set; }
        [DataMember(Name = "instrumentCode", Order = 4)] public string InstrumentCode { get; set; }
        [DataMember(Name = "side", Order = 5)] public string Side { get; set; }
        [DataMember(Name = "quantity", Order = 6)] public int Quantity { get; set; }
        [DataMember(Name = "averagePrice", Order = 7)] public double AveragePrice { get; set; }
        [DataMember(Name = "markPrice", Order = 8)] public double? MarkPrice { get; set; }
    }

    [DataContract]
    internal sealed class VnmOrderObservationV2
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "accountLocalId", Order = 2)] public string AccountLocalId { get; set; }
        [DataMember(Name = "strategyLocalId", Order = 3)] public string StrategyLocalId { get; set; }
        [DataMember(Name = "instrumentCode", Order = 4)] public string InstrumentCode { get; set; }
        [DataMember(Name = "side", Order = 5)] public string Side { get; set; }
        [DataMember(Name = "orderType", Order = 6)] public string OrderType { get; set; }
        [DataMember(Name = "quantity", Order = 7)] public int Quantity { get; set; }
        [DataMember(Name = "filledQuantity", Order = 8)] public int FilledQuantity { get; set; }
        [DataMember(Name = "limitPrice", Order = 9)] public double? LimitPrice { get; set; }
        [DataMember(Name = "stopPrice", Order = 10)] public double? StopPrice { get; set; }
        [DataMember(Name = "submittedAt", Order = 11)] public string SubmittedAt { get; set; }
        [DataMember(Name = "lifecycle", Order = 12)] public string Lifecycle { get; set; }
        [DataMember(Name = "state", Order = 13)] public string State { get; set; }
        [DataMember(Name = "completedAt", Order = 14)] public string CompletedAt { get; set; }
    }

    [DataContract]
    internal sealed class VnmExecutionObservationV2
    {
        [DataMember(Name = "localId", Order = 1)] public string LocalId { get; set; }
        [DataMember(Name = "orderLocalId", Order = 2)] public string OrderLocalId { get; set; }
        [DataMember(Name = "accountLocalId", Order = 3)] public string AccountLocalId { get; set; }
        [DataMember(Name = "strategyLocalId", Order = 4)] public string StrategyLocalId { get; set; }
        [DataMember(Name = "instrumentCode", Order = 5)] public string InstrumentCode { get; set; }
        [DataMember(Name = "side", Order = 6)] public string Side { get; set; }
        [DataMember(Name = "quantity", Order = 7)] public int Quantity { get; set; }
        [DataMember(Name = "price", Order = 8)] public double Price { get; set; }
        [DataMember(Name = "commissionMinor", Order = 9)] public long? CommissionMinor { get; set; }
        [DataMember(Name = "executedAt", Order = 10)] public string ExecutedAt { get; set; }
    }

    [DataContract]
    internal sealed class VnmMoneyObservationV2
    {
        [DataMember(Name = "availability", Order = 1)] public string Availability { get; set; }
        [DataMember(Name = "currency", Order = 2)] public string Currency { get; set; }
        [DataMember(Name = "amountMinor", Order = 3)] public long? AmountMinor { get; set; }
        [DataMember(Name = "source", Order = 4)] public string Source { get; set; }
        [DataMember(Name = "reasonCode", Order = 5, EmitDefaultValue = false)] public string ReasonCode { get; set; }
    }

    [DataContract]
    internal sealed class VnmDailyPnlObservationV2
    {
        [DataMember(Name = "realized", Order = 1)] public VnmMoneyObservationV2 Realized { get; set; }
        [DataMember(Name = "unrealized", Order = 2)] public VnmMoneyObservationV2 Unrealized { get; set; }
    }

    [DataContract]
    internal sealed class VnmPnlObservationV2
    {
        [DataMember(Name = "accountLocalId", Order = 1)] public string AccountLocalId { get; set; }
        [DataMember(Name = "sessionDate", Order = 2)] public string SessionDate { get; set; }
        [DataMember(Name = "daily", Order = 3)] public VnmDailyPnlObservationV2 Daily { get; set; }
        [DataMember(Name = "nativeLifetime", Order = 4)] public VnmMoneyObservationV2 NativeLifetime { get; set; }
    }

    [DataContract]
    internal sealed class VnmCollectionErrorV2
    {
        [DataMember(Name = "code", Order = 1)] public string Code { get; set; }
        [DataMember(Name = "retryable", Order = 2)] public bool Retryable { get; set; }
    }

    [DataContract]
    internal sealed class VnmCollectionScopeV2
    {
        [DataMember(Name = "status", Order = 1)] public string Status { get; set; }
        [DataMember(Name = "errors", Order = 2)] public List<VnmCollectionErrorV2> Errors { get; set; }
    }

    [DataContract]
    internal sealed class VnmCollectionScopesV2
    {
        [DataMember(Name = "addon", Order = 1)] public VnmCollectionScopeV2 Addon { get; set; }
        [DataMember(Name = "connections", Order = 2)] public VnmCollectionScopeV2 Connections { get; set; }
        [DataMember(Name = "accounts", Order = 3)] public VnmCollectionScopeV2 Accounts { get; set; }
        [DataMember(Name = "strategies", Order = 4)] public VnmCollectionScopeV2 Strategies { get; set; }
        [DataMember(Name = "positions", Order = 5)] public VnmCollectionScopeV2 Positions { get; set; }
        [DataMember(Name = "orders", Order = 6)] public VnmCollectionScopeV2 Orders { get; set; }
        [DataMember(Name = "executions", Order = 7)] public VnmCollectionScopeV2 Executions { get; set; }
        [DataMember(Name = "pnl", Order = 8)] public VnmCollectionScopeV2 Pnl { get; set; }
    }

    // Internal capture metadata never crosses the pipe.
    internal sealed class VnmStrategySourceV2
    {
        public StrategyBase Source { get; set; }
        public VnmStrategyObservationV2 Observation { get; set; }
    }

    internal sealed class VnmStrategyCandidateV2
    {
        public string CompositeKey { get; set; }
        public StrategyBase Source { get; set; }
        public VnmStrategyObservationV2 Observation { get; set; }
    }

    internal sealed class VnmRuntimeBuildV2
    {
        public VnmRuntimeObservationV2 Snapshot { get; set; }
        public HashSet<string> WorkingOrderLocalIds { get; set; }
    }

    // Internal bounded-history candidate. It never crosses the pipe.
    internal sealed class VnmExecutionCandidateV2
    {
        public VnmExecutionObservationV2 Observation { get; set; }
        public VnmOrderObservationV2 DependencyOrder { get; set; }
    }

    public class VincereNinjaManagerIpcAddOn : AddOnBase
    {
        private const string AddonVersion = "0.1.0";
        private const string ProtocolVersion = "1.0";
        private const string RuntimeObservationV2Protocol = "ninjatrader-addon-snapshot/2.0";
        private const string PipeName = "VincereNinjaManager.v1";
        private const int MaximumMessageBytes = 5 * 1024 * 1024;
        private const int MaximumRuntimeItems = 10000;
        private const int MaximumClockSkewSeconds = 30;
        private static readonly object LifecycleLock = new object();
        private static readonly object ReplayLock = new object();
        private static readonly Dictionary<string, DateTimeOffset> SeenNonces = new Dictionary<string, DateTimeOffset>();
        private static CancellationTokenSource listenerCancellation;
        private static Task listenerTask;
        private static NamedPipeServerStream waitingPipe;
        private bool ownsListener;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "Vincere Ninja Manager Read-Only IPC";
                Description = "Authenticated read-only runtime discovery for Vincere Ninja Manager.";
            }
            else if (State == State.Active)
            {
                StartListener();
            }
            else if (State == State.Terminated)
            {
                StopListener();
            }
        }

        private void StartListener()
        {
            lock (LifecycleLock)
            {
                if (listenerTask != null && !listenerTask.IsCompleted)
                    return;
                listenerCancellation = new CancellationTokenSource();
                listenerTask = Task.Run(() => ListenLoop(listenerCancellation.Token));
                ownsListener = true;
                Print(DateTime.Now + ": Vincere Ninja Manager read-only IPC started.");
            }
        }

        private void StopListener()
        {
            lock (LifecycleLock)
            {
                if (!ownsListener)
                    return;
                try { listenerCancellation.Cancel(); } catch { }
                try { if (waitingPipe != null) waitingPipe.Dispose(); } catch { }
                try { if (listenerTask != null) listenerTask.Wait(3000); } catch { }
                if (listenerCancellation != null) listenerCancellation.Dispose();
                listenerCancellation = null;
                listenerTask = null;
                waitingPipe = null;
                ownsListener = false;
                Print(DateTime.Now + ": Vincere Ninja Manager read-only IPC stopped.");
            }
        }

        private void ListenLoop(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    using (NamedPipeServerStream pipe = CreatePipe())
                    {
                        waitingPipe = pipe;
                        pipe.WaitForConnection();
                        waitingPipe = null;
                        string line = ReadUtf8Line(pipe);
                        VnmIpcResponse response = HandleLine(line);
                        WriteUtf8Line(pipe, Serialize(response));
                    }
                }
                catch (ObjectDisposedException) { }
                catch (Exception exception)
                {
                    if (!cancellationToken.IsCancellationRequested)
                        Print(DateTime.Now + ": Vincere Ninja Manager IPC error: " + exception.GetType().Name);
                    Thread.Sleep(250);
                }
            }
        }

        private static NamedPipeServerStream CreatePipe()
        {
            WindowsIdentity identity = WindowsIdentity.GetCurrent();
            if (identity.User == null)
                throw new InvalidOperationException("Current Windows user SID is unavailable.");
            PipeSecurity security = new PipeSecurity();
            security.SetOwner(identity.User);
            security.SetAccessRuleProtection(true, false);
            security.AddAccessRule(new PipeAccessRule(identity.User, PipeAccessRights.FullControl, AccessControlType.Allow));
            return new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.None,
                65536,
                65536,
                security);
        }

        private static VnmIpcResponse HandleLine(string line)
        {
            byte[] secret = LoadSecret();
            if (secret == null)
                return UnsignedError(Guid.NewGuid().ToString(), "SECRET_UNAVAILABLE");
            VnmIpcRequest request;
            try { request = Deserialize<VnmIpcRequest>(line); }
            catch { return SignedError(Guid.NewGuid().ToString(), "INVALID_REQUEST", secret); }

            string requestId;
            Guid parsedId;
            if (!Guid.TryParse(request.RequestId, out parsedId))
                return SignedError(Guid.NewGuid().ToString(), "INVALID_REQUEST", secret);
            requestId = parsedId.ToString();
            if (request.ProtocolVersion != ProtocolVersion
                || string.IsNullOrEmpty(request.Nonce)
                || string.IsNullOrEmpty(request.Command)
                || request.PayloadJson == null
                || !Regex.IsMatch(request.Nonce, "^[A-Za-z0-9_-]{20,40}$"))
                return SignedError(requestId, "INVALID_REQUEST", secret);

            string expectedPayloadHash = Sha256(request.PayloadJson);
            if (!ConstantTimeEquals(expectedPayloadHash, request.PayloadSha256))
                return SignedError(requestId, "INVALID_REQUEST", secret);

            DateTimeOffset issuedAt;
            if (!DateTimeOffset.TryParse(request.IssuedAt, out issuedAt)
                || Math.Abs((DateTimeOffset.UtcNow - issuedAt.ToUniversalTime()).TotalSeconds) > MaximumClockSkewSeconds)
                return SignedError(requestId, "CLOCK_SKEW", secret);

            string signingInput = string.Join("\n", new[] {
                request.ProtocolVersion,
                request.RequestId,
                request.IssuedAt,
                request.Nonce,
                request.Command,
                request.PayloadSha256
            });
            if (!ConstantTimeEquals(Hmac(secret, signingInput), request.Signature))
                return SignedError(requestId, "UNAUTHORIZED", secret);
            if (!RememberNonce(request.Nonce, issuedAt))
                return SignedError(requestId, "REPLAY", secret);

            try
            {
                switch (request.Command)
                {
                    case "PING":
                        return SignedSuccess(requestId, Serialize(new VnmPingPayload {
                            AddonVersion = AddonVersion,
                            ProtocolVersion = ProtocolVersion
                        }), secret);
                    case "GET_CAPABILITIES":
                        return SignedSuccess(requestId, Serialize(new VnmCapabilitiesPayload {
                            AddonVersion = AddonVersion,
                            Commands = RuntimeCapabilities(),
                            Authority = "read_only_supervised_simulation"
                        }), secret);
                    case "GET_RUNTIME_SNAPSHOT":
                        return SignedSuccess(requestId, Serialize(BuildSnapshot()), secret);
                    case "GET_RUNTIME_OBSERVATION_V2":
                        return BuildRuntimeObservationV2Response(requestId, secret);
                    default:
                        return SignedError(requestId, "UNSUPPORTED_COMMAND", secret);
                }
            }
            catch
            {
                return SignedError(requestId, "INTERNAL_ERROR", secret);
            }
        }

        private static bool RememberNonce(string nonce, DateTimeOffset issuedAt)
        {
            lock (ReplayLock)
            {
                DateTimeOffset cutoff = DateTimeOffset.UtcNow.AddMinutes(-5);
                foreach (string oldNonce in SeenNonces.Where(item => item.Value < cutoff).Select(item => item.Key).ToList())
                    SeenNonces.Remove(oldNonce);
                if (SeenNonces.ContainsKey(nonce))
                    return false;
                if (SeenNonces.Count >= 2048)
                {
                    string oldest = SeenNonces.OrderBy(item => item.Value).First().Key;
                    SeenNonces.Remove(oldest);
                }
                SeenNonces[nonce] = issuedAt;
                return true;
            }
        }

        private static VnmIpcResponse SignedSuccess(string requestId, string payloadJson, byte[] secret)
        {
            return CreateSignedResponse(requestId, true, "OK", payloadJson, secret);
        }

        private static VnmIpcResponse SignedError(string requestId, string code, byte[] secret)
        {
            return CreateSignedResponse(requestId, false, code, "{}", secret);
        }

        private static VnmIpcResponse UnsignedError(string requestId, string code)
        {
            return new VnmIpcResponse {
                ProtocolVersion = ProtocolVersion,
                RequestId = requestId,
                RespondedAt = DateTimeOffset.UtcNow.ToString("o"),
                Ok = false,
                Code = code,
                PayloadJson = "{}",
                PayloadSha256 = Sha256("{}"),
                Signature = "hmac-sha256:" + new string('0', 64)
            };
        }

        private static VnmIpcResponse CreateSignedResponse(string requestId, bool ok, string code, string payloadJson, byte[] secret)
        {
            VnmIpcResponse response = new VnmIpcResponse {
                ProtocolVersion = ProtocolVersion,
                RequestId = requestId,
                RespondedAt = DateTimeOffset.UtcNow.ToString("o"),
                Ok = ok,
                Code = code,
                PayloadJson = payloadJson,
                PayloadSha256 = Sha256(payloadJson)
            };
            string signingInput = string.Join("\n", new[] {
                response.ProtocolVersion,
                response.RequestId,
                response.RespondedAt,
                response.Ok ? "true" : "false",
                response.Code,
                response.PayloadSha256
            });
            response.Signature = Hmac(secret, signingInput);
            return response;
        }

        private static byte[] LoadSecret()
        {
            try
            {
                string path = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Vincere", "NinjaManager", "secrets", "ipc-secret.bin");
                byte[] value = File.ReadAllBytes(path);
                return value.Length == 32 ? value : null;
            }
            catch { return null; }
        }

        private static string Sha256(string value)
        {
            using (SHA256 algorithm = SHA256.Create())
                return "sha256:" + ToHex(algorithm.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty)));
        }

        private static string Hmac(byte[] secret, string value)
        {
            using (HMACSHA256 algorithm = new HMACSHA256(secret))
                return "hmac-sha256:" + ToHex(algorithm.ComputeHash(Encoding.UTF8.GetBytes(value ?? string.Empty)));
        }

        private static string ToHex(byte[] bytes)
        {
            StringBuilder result = new StringBuilder(bytes.Length * 2);
            foreach (byte item in bytes)
                result.Append(item.ToString("x2"));
            return result.ToString();
        }

        private static bool ConstantTimeEquals(string left, string right)
        {
            byte[] leftBytes = Encoding.UTF8.GetBytes(left ?? string.Empty);
            byte[] rightBytes = Encoding.UTF8.GetBytes(right ?? string.Empty);
            int difference = leftBytes.Length ^ rightBytes.Length;
            int maximum = Math.Max(leftBytes.Length, rightBytes.Length);
            for (int index = 0; index < maximum; index++)
            {
                byte leftByte = index < leftBytes.Length ? leftBytes[index] : (byte)0;
                byte rightByte = index < rightBytes.Length ? rightBytes[index] : (byte)0;
                difference |= leftByte ^ rightByte;
            }
            return difference == 0;
        }

        private static VnmRuntimeSnapshot BuildSnapshot()
        {
            List<Account> sourceAccounts;
            lock (Account.All)
                sourceAccounts = Account.All.Where(account => account != null).OrderBy(account => account.Name).ToList();

            List<VnmAccountObservation> accounts = new List<VnmAccountObservation>();
            List<VnmStrategyCandidate> candidates = new List<VnmStrategyCandidate>();
            foreach (Account account in sourceAccounts)
            {
                string accountName = account.Name ?? string.Empty;
                string connectionName = ReadNestedString(account, "Connection", "Options", "Name");
                accounts.Add(new VnmAccountObservation {
                    LocalId = accountName,
                    AccountName = accountName,
                    AccountKind = accountName.StartsWith("Sim", StringComparison.OrdinalIgnoreCase) ? "simulation" : "unknown",
                    ConnectionName = connectionName,
                    ConnectionStatus = MapConnectionStatus(ReadConnectionStatus(account))
                });

                lock (account.Strategies)
                {
                    foreach (StrategyBase strategy in account.Strategies.Where(item => item != null))
                    {
                        string instrument = ReadInstrument(strategy);
                        string timeframe = ReadTimeframe(strategy);
                        string strategyType = strategy.GetType().FullName ?? strategy.GetType().Name;
                        string strategyName = strategy.Name ?? strategy.GetType().Name;
                        string template = ReadPropertyString(strategy, "Template");
                        bool enabled = IsEnabledLifecycle(strategy.State);
                        bool? sync = CalculateSync(strategy, enabled);
                        string runtimeState;
                        string stateCode;
                        if (!enabled)
                        {
                            runtimeState = "disabled";
                            stateCode = "DISABLED_BY_CONFIGURATION";
                        }
                        else if (strategy.State == State.Realtime && sync == true)
                        {
                            runtimeState = "running";
                            stateCode = "SYNCHRONIZED";
                        }
                        else if (strategy.State == State.Realtime && sync == false)
                        {
                            runtimeState = "waiting_sync";
                            stateCode = "AWAITING_SYNC";
                        }
                        else
                        {
                            runtimeState = "unknown";
                            stateCode = "UNKNOWN";
                        }

                        string composite = string.Join("|", new[] {
                            accountName,
                            strategyType,
                            strategyName,
                            template,
                            instrument,
                            timeframe
                        });
                        candidates.Add(new VnmStrategyCandidate {
                            CompositeKey = composite,
                            Observation = new VnmStrategyObservation {
                                AccountLocalId = accountName,
                                StrategyName = strategyName,
                                StrategyType = strategyType,
                                Instrument = instrument,
                                Timeframe = timeframe,
                                Enabled = enabled,
                                Sync = sync,
                                RuntimeState = runtimeState,
                                StateCode = stateCode
                            }
                        });
                    }
                }
            }

            Dictionary<string, int> occurrenceByComposite = new Dictionary<string, int>(StringComparer.Ordinal);
            List<VnmStrategyObservation> strategies = new List<VnmStrategyObservation>();
            foreach (VnmStrategyCandidate candidate in candidates.OrderBy(item => item.CompositeKey, StringComparer.Ordinal))
            {
                int occurrence;
                occurrenceByComposite.TryGetValue(candidate.CompositeKey, out occurrence);
                occurrence += 1;
                occurrenceByComposite[candidate.CompositeKey] = occurrence;
                candidate.Observation.LocalId = candidate.CompositeKey + "|" + occurrence;
                strategies.Add(candidate.Observation);
            }

            return new VnmRuntimeSnapshot {
                ObservedAt = DateTimeOffset.UtcNow.ToString("o"),
                AddonVersion = AddonVersion,
                Accounts = accounts,
                Strategies = strategies
            };
        }

        private static List<string> RuntimeCapabilities()
        {
            return new List<string> {
                "GET_CAPABILITIES",
                "GET_RUNTIME_OBSERVATION_V2",
                "GET_RUNTIME_SNAPSHOT",
                "PING"
            };
        }

        private static VnmCollectionScopeV2 CompleteScope()
        {
            return new VnmCollectionScopeV2 {
                Status = "complete",
                Errors = new List<VnmCollectionErrorV2>()
            };
        }

        private static void AddScopeError(VnmCollectionScopeV2 scope, string code, bool retryable)
        {
            if (scope.Errors.Any(item => item.Code == code))
                return;
            scope.Status = scope.Status == "unavailable" ? "unavailable" : "partial";
            scope.Errors.Add(new VnmCollectionErrorV2 { Code = code, Retryable = retryable });
        }

        private static void SetScopeUnavailable(VnmCollectionScopeV2 scope, string code, bool retryable)
        {
            scope.Status = "unavailable";
            scope.Errors.Clear();
            scope.Errors.Add(new VnmCollectionErrorV2 { Code = code, Retryable = retryable });
        }

        private static VnmRuntimeBuildV2 BuildRuntimeObservationV2()
        {
            DateTimeOffset observedAt = DateTimeOffset.UtcNow;
            VnmCollectionScopesV2 scopes = new VnmCollectionScopesV2 {
                Addon = CompleteScope(),
                Connections = CompleteScope(),
                Accounts = CompleteScope(),
                Strategies = CompleteScope(),
                Positions = CompleteScope(),
                Orders = CompleteScope(),
                Executions = CompleteScope(),
                Pnl = CompleteScope()
            };
            VnmRuntimeObservationV2 snapshot = new VnmRuntimeObservationV2 {
                ProtocolVersion = RuntimeObservationV2Protocol,
                ObservedAt = observedAt.ToString("o"),
                Addon = new VnmAddonObservationV2 {
                    LocalId = "VincereNinjaManagerIpcAddOn",
                    Status = "connected",
                    Health = "healthy",
                    Version = AddonVersion,
                    IpcAuthenticated = true,
                    Capabilities = RuntimeCapabilities()
                },
                Connections = new List<VnmConnectionObservationV2>(),
                Accounts = new List<VnmAccountObservationV2>(),
                Strategies = new List<VnmStrategyObservationV2>(),
                Positions = new List<VnmPositionObservationV2>(),
                Orders = new List<VnmOrderObservationV2>(),
                Executions = new List<VnmExecutionObservationV2>(),
                Pnl = new List<VnmPnlObservationV2>(),
                CollectionScopes = scopes
            };

            List<Account> sourceAccounts;
            try
            {
                lock (Account.All)
                    sourceAccounts = Account.All.Where(item => item != null)
                        .OrderBy(item => item.Name, StringComparer.Ordinal).ToList();
                if (sourceAccounts.Count > 500)
                    throw new InvalidOperationException("Account inventory exceeds the protocol limit.");
            }
            catch
            {
                sourceAccounts = new List<Account>();
                SetScopeUnavailable(scopes.Accounts, "SOURCE_ERROR", true);
                SetScopeUnavailable(scopes.Strategies, "SOURCE_ERROR", true);
                SetScopeUnavailable(scopes.Positions, "SOURCE_ERROR", true);
                SetScopeUnavailable(scopes.Orders, "SOURCE_ERROR", true);
                SetScopeUnavailable(scopes.Executions, "SOURCE_ERROR", true);
                SetScopeUnavailable(scopes.Pnl, "SOURCE_ERROR", true);
            }

            Dictionary<Connection, string> connectionIds = CaptureConnectionsV2(
                sourceAccounts, snapshot.Connections, scopes.Connections);
            Dictionary<Account, string> accountIds = CaptureAccountsV2(
                sourceAccounts, connectionIds, snapshot.Accounts, scopes.Accounts);
            Dictionary<string, string> orderStrategyIds;
            HashSet<string> ambiguousOrderStrategyIds;
            CaptureStrategiesV2(
                accountIds, snapshot.Strategies, scopes.Strategies,
                out orderStrategyIds, out ambiguousOrderStrategyIds);

            CapturePositionsV2(accountIds, snapshot.Positions, scopes.Positions);
            HashSet<string> workingOrderIds = CaptureOrdersV2(
                accountIds, orderStrategyIds, ambiguousOrderStrategyIds,
                snapshot.Orders, scopes.Orders);
            CaptureExecutionsV2(
                accountIds, orderStrategyIds, ambiguousOrderStrategyIds,
                snapshot.Orders, workingOrderIds, snapshot.Executions,
                scopes.Orders, scopes.Executions);
            CapturePnlV2(accountIds, observedAt, snapshot.Pnl, scopes.Pnl);

            // These collections are captured one after another from a changing
            // runtime. They are truthful display evidence, but not an atomic
            // safety preflight for a later mutation.
            MarkSequentialScopesPartialV2(scopes);

            if (snapshot.Connections.Count > 100
                || snapshot.Strategies.Count > MaximumRuntimeItems
                || snapshot.Positions.Count > MaximumRuntimeItems)
                throw new InvalidOperationException("Current runtime inventory exceeds the protocol limit.");

            return new VnmRuntimeBuildV2 {
                Snapshot = snapshot,
                WorkingOrderLocalIds = workingOrderIds
            };
        }

        private static void MarkSequentialScopesPartialV2(VnmCollectionScopesV2 scopes)
        {
            foreach (VnmCollectionScopeV2 scope in new[] {
                scopes.Connections,
                scopes.Accounts,
                scopes.Strategies,
                scopes.Positions,
                scopes.Orders,
                scopes.Executions,
                scopes.Pnl
            })
                AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
        }

        private static Dictionary<Connection, string> CaptureConnectionsV2(
            List<Account> sourceAccounts,
            List<VnmConnectionObservationV2> target,
            VnmCollectionScopeV2 scope)
        {
            List<Connection> sources = new List<Connection>();
            try
            {
                lock (Connection.Connections)
                    sources.AddRange(Connection.Connections.Where(item => item != null));
            }
            catch
            {
                AddScopeError(scope, "SOURCE_ERROR", true);
            }
            foreach (Account account in sourceAccounts)
                try
                {
                    if (account.Connection != null && !sources.Contains(account.Connection))
                        sources.Add(account.Connection);
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                }

            Dictionary<Connection, string> ids = new Dictionary<Connection, string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (Connection connection in sources)
            {
                try
                {
                    string localId = connection.Options == null ? string.Empty : connection.Options.Name;
                    if (!ValidLocalId(localId) || !seen.Add(localId))
                    {
                        AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                        continue;
                    }
                    string status = MapConnectionStatusV2(connection.Status);
                    string priceStatus = MapConnectionStatusV2(connection.PriceStatus);
                    string provider = connection.Options == null
                        ? string.Empty
                        : Convert.ToString(connection.Options.Provider, CultureInfo.InvariantCulture);
                    string providerCode = SafeUpperCode(provider);
                    if (string.IsNullOrEmpty(providerCode))
                        providerCode = null;
                    target.Add(new VnmConnectionObservationV2 {
                        LocalId = localId,
                        Kind = MapConnectionKindV2(connection),
                        ProviderCode = providerCode,
                        Status = status,
                        Health = status == "connected" && priceStatus == "connected" ? "healthy"
                            : status == "disconnected" ? "offline"
                            : status == "unknown" ? "unknown" : "degraded",
                        MarketDataStatus = status == "disconnected" || status == "error"
                            || priceStatus == "disconnected" || priceStatus == "error"
                            ? "unavailable" : "unknown",
                        LastStateChangeAt = null
                    });
                    ids.Add(connection, localId);
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                }
            }
            return ids;
        }

        private static Dictionary<Account, string> CaptureAccountsV2(
            List<Account> sources,
            Dictionary<Connection, string> connectionIds,
            List<VnmAccountObservationV2> target,
            VnmCollectionScopeV2 scope)
        {
            Dictionary<Account, string> ids = new Dictionary<Account, string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (Account account in sources)
            {
                try
                {
                    string localId = account.Name ?? string.Empty;
                    if (!ValidLocalId(localId) || localId.Length > 256 || !seen.Add(localId))
                    {
                        AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                        continue;
                    }
                    List<string> accountConnections = new List<string>();
                    Connection connection = account.Connection;
                    string connectionId;
                    if (connection != null && connectionIds.TryGetValue(connection, out connectionId))
                        accountConnections.Add(connectionId);
                    else if (connection != null)
                        AddScopeError(scope, "CONNECTION_UNAVAILABLE", true);

                    string connectionStatus = connection == null
                        ? "unavailable"
                        : MapConnectionStatusV2(connection.Status);
                    target.Add(new VnmAccountObservationV2 {
                        LocalId = localId,
                        AccountIdentifier = localId,
                        ClassificationEvidence = ClassifyAccountV2(account),
                        ConnectionLocalIds = accountConnections.OrderBy(item => item, StringComparer.Ordinal).ToList(),
                        Status = connectionStatus == "connected" ? "connected"
                            : connectionStatus == "disconnected" ? "disconnected"
                            : connectionStatus == "unavailable" ? "unavailable" : "unknown"
                    });
                    ids.Add(account, localId);
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                }
            }
            return ids;
        }

        private static VnmClassificationEvidenceV2 ClassifyAccountV2(Account account)
        {
            try
            {
                return ClassifyAccountProviderV2(account.Provider);
            }
            catch
            {
                return UnavailableClassificationV2("CLASSIFICATION_UNAVAILABLE");
            }
        }

        private static VnmClassificationEvidenceV2 ClassifyAccountProviderV2(Provider provider)
        {
            if (provider != Provider.Simulator && provider != Provider.Playback)
                return UnavailableClassificationV2("CLASSIFICATION_UNAVAILABLE");
            return new VnmClassificationEvidenceV2 {
                AccountType = "simulation",
                IsSimulation = null,
                SimulationMode = null,
                UnavailableReasonCode = null
            };
        }

        private static VnmClassificationEvidenceV2 UnavailableClassificationV2(string reason)
        {
            return new VnmClassificationEvidenceV2 {
                AccountType = "unknown",
                IsSimulation = null,
                SimulationMode = null,
                UnavailableReasonCode = reason
            };
        }

        private static string MapConnectionStatusV2(ConnectionStatus status)
        {
            if (status == ConnectionStatus.Connected) return "connected";
            if (status == ConnectionStatus.Connecting) return "connecting";
            if (status == ConnectionStatus.Disconnecting) return "disconnecting";
            if (status == ConnectionStatus.Disconnected) return "disconnected";
            if (status == ConnectionStatus.ConnectionLost) return "error";
            return "unknown";
        }

        private static string MapConnectionKindV2(Connection connection)
        {
            if (connection == null || connection.Options == null)
                return "unknown";
            if (connection.Options.Provider == Provider.Playback)
                return "playback";
            bool providerSimulation = connection.Options.Provider == Provider.Simulator;
            bool modeSimulation = connection.Options.Mode == Mode.Simulation;
            bool demoSimulation = connection.Options.IsDemo;
            if (providerSimulation != modeSimulation
                || modeSimulation != demoSimulation)
                return "unknown";
            if (providerSimulation)
                return "simulation";
            if (connection.Options.IsDataProviderOnly)
                return "market_data";
            return "brokerage";
        }

        private static bool ValidLocalId(string value)
        {
            return !string.IsNullOrEmpty(value) && value.Length <= 1024;
        }

        private static string SafeUpperCode(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return string.Empty;
            string result = Regex.Replace(value.ToUpperInvariant(), "[^A-Z0-9_.-]", "_");
            if (result.Length == 0)
                return string.Empty;
            if (result[0] < 'A' || result[0] > 'Z')
                result = "VALUE_" + result;
            return result.Length > 80 ? result.Substring(0, 80) : result;
        }

        // Must remain byte-for-byte equivalent to runtime-adapter.ts strategyType:
        // take the final namespace segment, sanitize, prefix non-letter starts,
        // then enforce the shared 80-character protocol grammar.
        private static string NormalizeStrategyTypeCodeV2(string value)
        {
            string source = value ?? string.Empty;
            int finalSeparator = source.LastIndexOf('.');
            string typeName = finalSeparator < 0
                ? source : source.Substring(finalSeparator + 1);
            typeName = Regex.Replace(typeName, "[^A-Za-z0-9_.-]", "_");
            string normalized = Regex.IsMatch(typeName, "^[A-Za-z]")
                ? typeName : "Strategy_" + typeName;
            return Regex.IsMatch(normalized, "^[A-Za-z][A-Za-z0-9_.-]{0,79}$")
                ? normalized : string.Empty;
        }

        private static string InstrumentCode(string value)
        {
            string result = (value ?? string.Empty).ToUpperInvariant();
            return result.Length <= 40
                && Regex.IsMatch(result, "^[A-Z0-9][A-Z0-9 .:/_-]{0,39}$")
                ? result : string.Empty;
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private static bool IsBoundedPrice(double value)
        {
            return IsFinite(value) && value >= 0 && value <= 100000000;
        }

        private static List<VnmStrategySourceV2> CaptureStrategiesV2(
            Dictionary<Account, string> accountIds,
            List<VnmStrategyObservationV2> target,
            VnmCollectionScopeV2 scope,
            out Dictionary<string, string> orderStrategyIds,
            out HashSet<string> ambiguousOrderStrategyIds)
        {
            List<VnmStrategyCandidateV2> candidates = new List<VnmStrategyCandidateV2>();
            foreach (KeyValuePair<Account, string> pair in accountIds.OrderBy(item => item.Value, StringComparer.Ordinal))
            {
                try
                {
                    lock (pair.Key.Strategies)
                    {
                        foreach (StrategyBase strategy in pair.Key.Strategies.Where(item => item != null))
                        {
                            string instrumentRaw = ReadInstrument(strategy);
                            string strategyType = strategy.GetType().FullName ?? strategy.GetType().Name;
                            string strategyName = strategy.Name ?? strategy.GetType().Name;
                            string composite = string.Join("|", new[] {
                                pair.Value,
                                strategyType,
                                strategyName,
                                ReadPropertyString(strategy, "Template"),
                                instrumentRaw,
                                ReadTimeframe(strategy)
                            });
                            VnmStrategyObservationV2 observation = null;
                            string instrument = InstrumentCode(instrumentRaw);
                            string strategyTypeCode = NormalizeStrategyTypeCodeV2(strategyType);
                            if (!string.IsNullOrEmpty(strategyTypeCode)
                                && instrumentRaw != "UNSUPPORTED"
                                && !string.IsNullOrEmpty(instrument))
                            {
                                bool enabled = IsEnabledLifecycle(strategy.State);
                                bool? sync = CalculateSync(strategy, enabled);
                                bool parametersComplete;
                                List<VnmOperationalParameterV2> parameters =
                                    ReadOperationalParametersV2(strategy, out parametersComplete);
                                if (!parametersComplete)
                                    AddScopeError(scope, "SOURCE_ERROR", true);
                                observation = new VnmStrategyObservationV2 {
                                    AccountLocalId = pair.Value,
                                    StrategyTypeCode = strategyTypeCode,
                                    InstrumentCode = instrument,
                                    Enabled = enabled,
                                    RuntimeState = MapStrategyRuntimeStateV2(strategy, enabled, sync),
                                    SynchronizationState = MapSynchronizationStateV2(strategy, enabled, sync),
                                    OperationalParameters = parameters,
                                    LastStateChangeAt = null
                                };
                            }
                            else
                            {
                                AddScopeError(scope, "SOURCE_ERROR", false);
                            }
                            candidates.Add(new VnmStrategyCandidateV2 {
                                CompositeKey = composite,
                                Source = strategy,
                                Observation = observation
                            });
                        }
                    }
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                }
            }

            if (candidates.Count > 0)
                AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
            Dictionary<string, int> occurrences = new Dictionary<string, int>(StringComparer.Ordinal);
            List<VnmStrategySourceV2> sources = new List<VnmStrategySourceV2>();
            foreach (VnmStrategyCandidateV2 candidate in candidates.OrderBy(item => item.CompositeKey, StringComparer.Ordinal))
            {
                int occurrence;
                occurrences.TryGetValue(candidate.CompositeKey, out occurrence);
                occurrence += 1;
                occurrences[candidate.CompositeKey] = occurrence;
                string localId = candidate.CompositeKey + "|" + occurrence;
                if (candidate.Observation == null)
                    continue;
                if (!ValidLocalId(localId))
                {
                    AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                    continue;
                }
                candidate.Observation.LocalId = localId;
                target.Add(candidate.Observation);
                sources.Add(new VnmStrategySourceV2 {
                    Source = candidate.Source,
                    Observation = candidate.Observation
                });
            }

            BuildOrderStrategyMapV2(sources, out orderStrategyIds, out ambiguousOrderStrategyIds, scope);
            return sources;
        }

        private static List<VnmOperationalParameterV2> ReadOperationalParametersV2(
            StrategyBase strategy, out bool complete)
        {
            complete = true;
            List<VnmOperationalParameterV2> values = new List<VnmOperationalParameterV2>();
            AddIntegerParameterV2(values, strategy, "BARS_REQUIRED_TO_TRADE", "BarsRequiredToTrade", ref complete);
            AddIntegerParameterV2(values, strategy, "ENTRIES_PER_DIRECTION", "EntriesPerDirection", ref complete);
            AddBooleanParameterV2(values, strategy, "IS_UNMANAGED", "IsUnmanaged", ref complete);
            AddIntegerParameterV2(values, strategy, "SLIPPAGE", "Slippage", ref complete);
            AddBooleanParameterV2(values, strategy, "TRACE_ORDERS", "TraceOrders", ref complete);
            AddCodeParameterV2(values, strategy, "ENTRY_HANDLING", "EntryHandling", ref complete);
            AddCodeParameterV2(values, strategy, "REALTIME_ERROR_HANDLING", "RealtimeErrorHandling", ref complete);
            AddCodeParameterV2(values, strategy, "START_BEHAVIOR", "StartBehavior", ref complete);
            return values.OrderBy(item => item.ParameterCode, StringComparer.Ordinal).ToList();
        }

        private static void AddBooleanParameterV2(
            List<VnmOperationalParameterV2> target, object source,
            string code, string propertyName, ref bool complete)
        {
            object value = ReadProperty(source, propertyName);
            if (!(value is bool))
            {
                complete = false;
                return;
            }
            target.Add(new VnmOperationalParameterV2 {
                ParameterCode = code,
                Value = new VnmParameterValueV2 { Kind = "boolean", Value = (bool)value }
            });
        }

        private static void AddIntegerParameterV2(
            List<VnmOperationalParameterV2> target, object source,
            string code, string propertyName, ref bool complete)
        {
            object value = ReadProperty(source, propertyName);
            long converted;
            try { converted = Convert.ToInt64(value, CultureInfo.InvariantCulture); }
            catch { complete = false; return; }
            if (converted < -1000000000L || converted > 1000000000L)
            {
                complete = false;
                return;
            }
            target.Add(new VnmOperationalParameterV2 {
                ParameterCode = code,
                Value = new VnmParameterValueV2 { Kind = "integer", Value = converted }
            });
        }

        private static void AddCodeParameterV2(
            List<VnmOperationalParameterV2> target, object source,
            string code, string propertyName, ref bool complete)
        {
            object value = ReadProperty(source, propertyName);
            string safe = SafeUpperCode(value == null ? string.Empty
                : Convert.ToString(value, CultureInfo.InvariantCulture));
            if (string.IsNullOrEmpty(safe))
            {
                complete = false;
                return;
            }
            target.Add(new VnmOperationalParameterV2 {
                ParameterCode = code,
                Value = new VnmParameterValueV2 { Kind = "code", Value = safe }
            });
        }

        private static string MapStrategyRuntimeStateV2(
            StrategyBase strategy, bool enabled, bool? sync)
        {
            if (!enabled) return "disabled";
            if (strategy.State == State.Historical) return "enabling";
            if (strategy.State == State.Transition) return "waiting_sync";
            if (strategy.State == State.Realtime && sync == true) return "running";
            if (strategy.State == State.Realtime && sync == false) return "waiting_sync";
            return "unknown";
        }

        private static string MapSynchronizationStateV2(
            StrategyBase strategy, bool enabled, bool? sync)
        {
            if (!enabled) return "not_applicable";
            if (sync == true) return "synchronized";
            if (sync == false) return "not_synchronized";
            if (strategy.State == State.Historical || strategy.State == State.Transition)
                return "pending";
            return "unknown";
        }

        private static void BuildOrderStrategyMapV2(
            List<VnmStrategySourceV2> strategies,
            out Dictionary<string, string> orderStrategyIds,
            out HashSet<string> ambiguousOrderStrategyIds,
            VnmCollectionScopeV2 scope)
        {
            orderStrategyIds = new Dictionary<string, string>(StringComparer.Ordinal);
            ambiguousOrderStrategyIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (VnmStrategySourceV2 strategy in strategies)
            {
                try
                {
                    lock (strategy.Source.Orders)
                    {
                        foreach (Order order in strategy.Source.Orders.Where(item => item != null))
                        {
                            if (order.Account == null
                                || order.Account.Name != strategy.Observation.AccountLocalId)
                            {
                                AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                                continue;
                            }
                            string orderLocalId = BuildOrderLocalIdV2(
                                strategy.Observation.AccountLocalId, order);
                            string prior;
                            if (orderStrategyIds.TryGetValue(orderLocalId, out prior)
                                && prior != strategy.Observation.LocalId)
                            {
                                orderStrategyIds.Remove(orderLocalId);
                                ambiguousOrderStrategyIds.Add(orderLocalId);
                                AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                            }
                            else if (!ambiguousOrderStrategyIds.Contains(orderLocalId))
                            {
                                orderStrategyIds[orderLocalId] = strategy.Observation.LocalId;
                            }
                        }
                    }
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                }
            }
        }

        private static string BuildOrderLocalIdV2(string accountLocalId, Order order)
        {
            string native = string.IsNullOrEmpty(order.OrderId)
                ? order.Id.ToString(CultureInfo.InvariantCulture) : order.OrderId;
            return accountLocalId + "|" + native;
        }

        private static void CapturePositionsV2(
            Dictionary<Account, string> accountIds,
            List<VnmPositionObservationV2> target,
            VnmCollectionScopeV2 scope)
        {
            HashSet<string> seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (KeyValuePair<Account, string> pair in accountIds)
            {
                List<Position> positions;
                try
                {
                    lock (pair.Key.Positions)
                        positions = pair.Key.Positions.Where(item => item != null).ToList();
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                    continue;
                }
                foreach (Position position in positions)
                {
                    try
                    {
                        if (position.MarketPosition == MarketPosition.Flat)
                            continue;
                        if (position.MarketPosition != MarketPosition.Long
                            && position.MarketPosition != MarketPosition.Short)
                        {
                            AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
                            continue;
                        }
                        string instrument = InstrumentCode(
                            position.Instrument == null ? string.Empty : position.Instrument.FullName);
                        int quantity = position.Quantity == int.MinValue
                            ? -1 : Math.Abs(position.Quantity);
                        string localId = pair.Value + "|" + instrument;
                        if (string.IsNullOrEmpty(instrument)
                            || quantity < 1 || quantity > 1000000
                            || !IsBoundedPrice(position.AveragePrice)
                            || !ValidLocalId(localId)
                            || !seen.Add(localId))
                        {
                            AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                            continue;
                        }
                        double? markPrice = null;
                        try
                        {
                            if (position.Instrument.MarketData != null
                                && position.Instrument.MarketData.Last != null
                                && IsBoundedPrice(position.Instrument.MarketData.Last.Price))
                                markPrice = position.Instrument.MarketData.Last.Price;
                        }
                        catch { }
                        target.Add(new VnmPositionObservationV2 {
                            LocalId = localId,
                            AccountLocalId = pair.Value,
                            StrategyLocalId = null,
                            InstrumentCode = instrument,
                            Side = position.MarketPosition == MarketPosition.Long ? "long" : "short",
                            Quantity = quantity,
                            AveragePrice = position.AveragePrice,
                            MarkPrice = markPrice
                        });
                    }
                    catch
                    {
                        AddScopeError(scope, "SOURCE_ERROR", true);
                    }
                }
            }
        }

        private static string EvidenceTimestamp(DateTime value)
        {
            if (value == DateTime.MinValue || value == DateTime.MaxValue)
                return string.Empty;
            try
            {
                DateTimeOffset offset;
                if (value.Kind == DateTimeKind.Utc)
                    offset = new DateTimeOffset(value, TimeSpan.Zero);
                else if (value.Kind == DateTimeKind.Local)
                {
                    if (TimeZoneInfo.Local.IsInvalidTime(value)
                        || TimeZoneInfo.Local.IsAmbiguousTime(value))
                        return string.Empty;
                    offset = new DateTimeOffset(value);
                }
                else
                {
                    TimeZoneInfo applicationZone =
                        NinjaTrader.Core.Globals.GeneralOptions.TimeZoneInfo;
                    if (applicationZone == null
                        || applicationZone.IsInvalidTime(value)
                        || applicationZone.IsAmbiguousTime(value))
                        return string.Empty;
                    offset = new DateTimeOffset(value, applicationZone.GetUtcOffset(value));
                }
                return offset.ToUniversalTime().ToString("o");
            }
            catch { return string.Empty; }
        }

        private static HashSet<string> CaptureOrdersV2(
            Dictionary<Account, string> accountIds,
            Dictionary<string, string> orderStrategyIds,
            HashSet<string> ambiguousOrderStrategyIds,
            List<VnmOrderObservationV2> target,
            VnmCollectionScopeV2 scope)
        {
            Dictionary<string, VnmOrderObservationV2> working =
                new Dictionary<string, VnmOrderObservationV2>(StringComparer.Ordinal);
            Dictionary<string, VnmOrderObservationV2> completed =
                new Dictionary<string, VnmOrderObservationV2>(StringComparer.Ordinal);
            foreach (KeyValuePair<Account, string> pair in accountIds)
            {
                bool unsafeWorkingState = false;
                try
                {
                    lock (pair.Key.Orders)
                    {
                        foreach (Order order in pair.Key.Orders)
                        {
                            if (order == null)
                                continue;
                            bool terminalAtRead = IsTerminalOrderStateV2(order.OrderState);
                            VnmOrderObservationV2 observation = BuildOrderObservationV2(
                                pair.Value, order, orderStrategyIds,
                                ambiguousOrderStrategyIds, scope);
                            if (observation == null)
                            {
                                if (!terminalAtRead)
                                {
                                    unsafeWorkingState = true;
                                    break;
                                }
                                continue;
                            }

                            if (observation.Lifecycle == "working")
                            {
                                if (working.ContainsKey(observation.LocalId)
                                    || completed.ContainsKey(observation.LocalId))
                                {
                                    unsafeWorkingState = true;
                                    break;
                                }
                                working.Add(observation.LocalId, observation);
                                if (working.Count > MaximumRuntimeItems)
                                {
                                    unsafeWorkingState = true;
                                    break;
                                }
                            }
                            else
                            {
                                if (working.ContainsKey(observation.LocalId)
                                    || completed.ContainsKey(observation.LocalId))
                                {
                                    AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                                    continue;
                                }
                                completed.Add(observation.LocalId, observation);
                                if (completed.Count > MaximumRuntimeItems * 2)
                                    RetainNewestCompletedOrdersV2(
                                        completed, MaximumRuntimeItems, scope);
                            }
                        }
                    }
                }
                catch
                {
                    throw new InvalidOperationException(
                        "Working order inventory could not be captured completely.");
                }
                if (unsafeWorkingState)
                    throw new InvalidOperationException(
                        "Working order state exceeds or cannot satisfy the protocol contract.");
            }

            RetainNewestCompletedOrdersV2(
                completed, MaximumRuntimeItems - working.Count, scope);
            target.AddRange(working.Values);
            target.AddRange(completed.Values);
            return new HashSet<string>(working.Keys, StringComparer.Ordinal);
        }

        private static void RetainNewestCompletedOrdersV2(
            Dictionary<string, VnmOrderObservationV2> completed,
            int limit,
            VnmCollectionScopeV2 scope)
        {
            if (completed.Count <= limit)
                return;
            List<VnmOrderObservationV2> retained = completed.Values
                .OrderByDescending(item => item.CompletedAt, StringComparer.Ordinal)
                .ThenByDescending(item => item.LocalId, StringComparer.Ordinal)
                .Take(limit)
                .ToList();
            completed.Clear();
            foreach (VnmOrderObservationV2 item in retained)
                completed.Add(item.LocalId, item);
            AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
        }

        private static VnmOrderObservationV2 BuildOrderObservationV2(
            string accountLocalId,
            Order order,
            Dictionary<string, string> orderStrategyIds,
            HashSet<string> ambiguousOrderStrategyIds,
            VnmCollectionScopeV2 scope)
        {
            try
            {
                string localId = BuildOrderLocalIdV2(accountLocalId, order);
                string instrument = InstrumentCode(
                    order.Instrument == null ? string.Empty : order.Instrument.FullName);
                if (!ValidLocalId(localId)
                    || string.IsNullOrEmpty(instrument)
                    || order.Quantity < 1 || order.Quantity > 1000000
                    || order.Filled < 0 || order.Filled > order.Quantity
                    || order.Filled > 1000000
                    || (order.OrderState == OrderState.Filled && order.Filled != order.Quantity))
                {
                    AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                    return null;
                }

                bool completed = IsTerminalOrderStateV2(order.OrderState);
                string submittedAt = null;
                string completedAt = null;
                try
                {
                    lock (order.OrderUpdates)
                    {
                        foreach (OrderEventArgs update in order.OrderUpdates)
                        {
                            if (update == null)
                                continue;
                            string timestamp = EvidenceTimestamp(update.Time);
                            if (string.IsNullOrEmpty(timestamp))
                                continue;
                            if (update.OrderState == OrderState.Submitted
                                && (submittedAt == null
                                    || string.CompareOrdinal(timestamp, submittedAt) < 0))
                                submittedAt = timestamp;
                            if (completed
                                && update.OrderState == order.OrderState
                                && (completedAt == null
                                    || string.CompareOrdinal(timestamp, completedAt) > 0))
                                completedAt = timestamp;
                        }
                    }
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                    return null;
                }
                if (string.IsNullOrEmpty(submittedAt))
                {
                    AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
                    return null;
                }

                if (completed)
                {
                    if (string.IsNullOrEmpty(completedAt)
                        || string.CompareOrdinal(completedAt, submittedAt) < 0)
                    {
                        AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
                        return null;
                    }
                }

                double? limitPrice = null;
                double? stopPrice = null;
                if (order.OrderType == OrderType.Limit || order.OrderType == OrderType.StopLimit)
                {
                    if (!IsBoundedPrice(order.LimitPrice) || order.LimitPrice <= 0)
                    {
                        AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                        return null;
                    }
                    limitPrice = order.LimitPrice;
                }
                if (order.OrderType == OrderType.StopMarket || order.OrderType == OrderType.StopLimit)
                {
                    if (!IsBoundedPrice(order.StopPrice) || order.StopPrice <= 0)
                    {
                        AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                        return null;
                    }
                    stopPrice = order.StopPrice;
                }

                string strategyLocalId = null;
                if (ambiguousOrderStrategyIds.Contains(localId))
                    AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                else
                    orderStrategyIds.TryGetValue(localId, out strategyLocalId);
                string side = MapOrderSideV2(order.OrderAction);
                if (string.IsNullOrEmpty(side))
                {
                    AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
                    return null;
                }
                return new VnmOrderObservationV2 {
                    LocalId = localId,
                    AccountLocalId = accountLocalId,
                    StrategyLocalId = strategyLocalId,
                    InstrumentCode = instrument,
                    Side = side,
                    OrderType = MapOrderTypeV2(order.OrderType),
                    Quantity = order.Quantity,
                    FilledQuantity = order.Filled,
                    LimitPrice = limitPrice,
                    StopPrice = stopPrice,
                    SubmittedAt = submittedAt,
                    Lifecycle = completed ? "completed" : "working",
                    State = completed
                        ? MapCompletedOrderStateV2(order.OrderState)
                        : MapWorkingOrderStateV2(order.OrderState),
                    CompletedAt = completedAt
                };
            }
            catch
            {
                AddScopeError(scope, "SOURCE_ERROR", true);
                return null;
            }
        }

        private static bool IsTerminalOrderStateV2(OrderState state)
        {
            return state == OrderState.Filled
                || state == OrderState.Cancelled
                || state == OrderState.Rejected;
        }

        private static string MapOrderSideV2(OrderAction action)
        {
            if (action == OrderAction.Buy || action == OrderAction.BuyToCover)
                return "buy";
            if (action == OrderAction.Sell || action == OrderAction.SellShort)
                return "sell";
            return string.Empty;
        }

        private static string MapOrderTypeV2(OrderType type)
        {
            if (type == OrderType.Market) return "market";
            if (type == OrderType.Limit) return "limit";
            if (type == OrderType.StopMarket) return "stop_market";
            if (type == OrderType.StopLimit) return "stop_limit";
            return "unknown";
        }

        private static string MapCompletedOrderStateV2(OrderState state)
        {
            if (state == OrderState.Filled) return "filled";
            if (state == OrderState.Cancelled) return "cancelled";
            if (state == OrderState.Rejected) return "rejected";
            return "rejected";
        }

        private static string MapWorkingOrderStateV2(OrderState state)
        {
            if (state == OrderState.Submitted) return "submitted";
            if (state == OrderState.Accepted || state == OrderState.AcceptedByRisk)
                return "accepted";
            if (state == OrderState.ChangePending || state == OrderState.ChangeSubmitted)
                return "change_pending";
            if (state == OrderState.CancelPending || state == OrderState.CancelSubmitted)
                return "cancel_pending";
            if (state == OrderState.Working || state == OrderState.PartFilled
                || state == OrderState.TriggerPending)
                return "working";
            return "unknown";
        }

        private static void CaptureExecutionsV2(
            Dictionary<Account, string> accountIds,
            Dictionary<string, string> orderStrategyIds,
            HashSet<string> ambiguousOrderStrategyIds,
            List<VnmOrderObservationV2> orders,
            HashSet<string> workingOrderIds,
            List<VnmExecutionObservationV2> target,
            VnmCollectionScopeV2 orderScope,
            VnmCollectionScopeV2 scope)
        {
            Dictionary<string, VnmOrderObservationV2> orderById = orders
                .GroupBy(item => item.LocalId, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            Dictionary<string, VnmExecutionCandidateV2> candidates =
                new Dictionary<string, VnmExecutionCandidateV2>(StringComparer.Ordinal);
            foreach (KeyValuePair<Account, string> pair in accountIds)
            {
                try
                {
                    lock (pair.Key.Executions)
                    {
                        foreach (Execution execution in pair.Key.Executions)
                        {
                            if (execution == null)
                                continue;
                            VnmExecutionCandidateV2 candidate = BuildExecutionCandidateV2(
                                pair.Key, pair.Value, execution, orderById,
                                orderStrategyIds, ambiguousOrderStrategyIds,
                                orderScope, scope);
                            if (candidate == null)
                                continue;
                            if (candidates.ContainsKey(candidate.Observation.LocalId))
                            {
                                AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                                continue;
                            }
                            candidates.Add(candidate.Observation.LocalId, candidate);
                            if (candidates.Count > MaximumRuntimeItems * 2)
                                RetainNewestExecutionCandidatesV2(
                                    candidates, MaximumRuntimeItems, scope);
                        }
                    }
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                }
            }

            RetainNewestExecutionCandidatesV2(
                candidates, MaximumRuntimeItems, scope);
            HashSet<string> referencedOrderIds = new HashSet<string>(StringComparer.Ordinal);
            Dictionary<string, long> observedQuantityByOrder =
                new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (VnmExecutionCandidateV2 candidate in candidates.Values
                .OrderByDescending(item => item.Observation.ExecutedAt, StringComparer.Ordinal)
                .ThenByDescending(item => item.Observation.LocalId, StringComparer.Ordinal))
            {
                VnmOrderObservationV2 order;
                if (!orderById.TryGetValue(candidate.Observation.OrderLocalId, out order))
                {
                    while (orders.Count >= MaximumRuntimeItems
                        && RemoveOldestUnreferencedCompletedOrderV2(
                            orders, orderById, workingOrderIds,
                            referencedOrderIds, orderScope))
                    {
                    }
                    if (orders.Count >= MaximumRuntimeItems)
                    {
                        AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
                        continue;
                    }
                    order = candidate.DependencyOrder;
                    orders.Add(order);
                    orderById.Add(order.LocalId, order);
                    if (order.Lifecycle == "working")
                        workingOrderIds.Add(order.LocalId);
                }

                long observedQuantity;
                observedQuantityByOrder.TryGetValue(order.LocalId, out observedQuantity);
                if (observedQuantity + candidate.Observation.Quantity > order.FilledQuantity)
                {
                    AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                    continue;
                }
                observedQuantityByOrder[order.LocalId] =
                    observedQuantity + candidate.Observation.Quantity;
                target.Add(candidate.Observation);
                referencedOrderIds.Add(order.LocalId);
            }
        }

        private static VnmExecutionCandidateV2 BuildExecutionCandidateV2(
            Account account,
            string accountLocalId,
            Execution execution,
            Dictionary<string, VnmOrderObservationV2> orderById,
            Dictionary<string, string> orderStrategyIds,
            HashSet<string> ambiguousOrderStrategyIds,
            VnmCollectionScopeV2 orderScope,
            VnmCollectionScopeV2 scope)
        {
            try
            {
                if (execution.Order == null || execution.Account != account)
                {
                    AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                    return null;
                }
                string orderLocalId = BuildOrderLocalIdV2(accountLocalId, execution.Order);
                VnmOrderObservationV2 order;
                if (!orderById.TryGetValue(orderLocalId, out order))
                {
                    order = BuildOrderObservationV2(
                        accountLocalId, execution.Order, orderStrategyIds,
                        ambiguousOrderStrategyIds, orderScope);
                    if (order == null)
                    {
                        AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
                        return null;
                    }
                }

                string nativeId = string.IsNullOrEmpty(execution.ExecutionId)
                    ? execution.Id.ToString(CultureInfo.InvariantCulture)
                    : execution.ExecutionId;
                string localId = accountLocalId + "|" + nativeId;
                string instrument = InstrumentCode(
                    execution.Instrument == null ? string.Empty : execution.Instrument.FullName);
                string executedAt = EvidenceTimestamp(execution.Time);
                string side = MapOrderSideV2(execution.Order.OrderAction);
                if (!ValidLocalId(localId)
                    || string.IsNullOrEmpty(instrument)
                    || instrument != order.InstrumentCode
                    || string.IsNullOrEmpty(side)
                    || execution.Quantity < 1 || execution.Quantity > 1000000
                    || execution.Quantity > order.FilledQuantity
                    || !IsBoundedPrice(execution.Price)
                    || string.IsNullOrEmpty(executedAt)
                    || string.CompareOrdinal(executedAt, order.SubmittedAt) < 0
                    || (order.CompletedAt != null
                        && string.CompareOrdinal(executedAt, order.CompletedAt) > 0))
                {
                    AddScopeError(scope, "INCONSISTENT_RUNTIME_STATE", false);
                    return null;
                }

                long? commissionMinor = null;
                if (account.Denomination == Currency.UsDollar)
                {
                    long converted;
                    if (TryMoneyMinorV2(execution.Commission, out converted))
                        commissionMinor = converted;
                    else
                        AddScopeError(scope, "SOURCE_ERROR", false);
                }
                return new VnmExecutionCandidateV2 {
                    Observation = new VnmExecutionObservationV2 {
                        LocalId = localId,
                        OrderLocalId = order.LocalId,
                        AccountLocalId = accountLocalId,
                        StrategyLocalId = order.StrategyLocalId,
                        InstrumentCode = instrument,
                        Side = side,
                        Quantity = execution.Quantity,
                        Price = execution.Price,
                        CommissionMinor = commissionMinor,
                        ExecutedAt = executedAt
                    },
                    DependencyOrder = order
                };
            }
            catch
            {
                AddScopeError(scope, "SOURCE_ERROR", true);
                return null;
            }
        }

        private static void RetainNewestExecutionCandidatesV2(
            Dictionary<string, VnmExecutionCandidateV2> candidates,
            int limit,
            VnmCollectionScopeV2 scope)
        {
            if (candidates.Count <= limit)
                return;
            List<VnmExecutionCandidateV2> retained = candidates.Values
                .OrderByDescending(item => item.Observation.ExecutedAt, StringComparer.Ordinal)
                .ThenByDescending(item => item.Observation.LocalId, StringComparer.Ordinal)
                .Take(limit)
                .ToList();
            candidates.Clear();
            foreach (VnmExecutionCandidateV2 item in retained)
                candidates.Add(item.Observation.LocalId, item);
            AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
        }

        private static bool RemoveOldestUnreferencedCompletedOrderV2(
            List<VnmOrderObservationV2> orders,
            Dictionary<string, VnmOrderObservationV2> orderById,
            HashSet<string> workingOrderIds,
            HashSet<string> referencedOrderIds,
            VnmCollectionScopeV2 scope)
        {
            VnmOrderObservationV2 removable = orders
                .Where(item => item.Lifecycle == "completed"
                    && !workingOrderIds.Contains(item.LocalId)
                    && !referencedOrderIds.Contains(item.LocalId))
                .OrderBy(item => item.CompletedAt, StringComparer.Ordinal)
                .ThenBy(item => item.LocalId, StringComparer.Ordinal)
                .FirstOrDefault();
            if (removable == null)
                return false;
            orders.Remove(removable);
            orderById.Remove(removable.LocalId);
            AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
            return true;
        }

        private static void CapturePnlV2(
            Dictionary<Account, string> accountIds,
            DateTimeOffset observedAt,
            List<VnmPnlObservationV2> target,
            VnmCollectionScopeV2 scope)
        {
            if (accountIds.Count > 0)
                AddScopeError(scope, "CAPABILITY_UNSUPPORTED", false);
            string sessionDate;
            try
            {
                TimeZoneInfo eastern = TimeZoneInfo.FindSystemTimeZoneById("Eastern Standard Time");
                sessionDate = TimeZoneInfo.ConvertTime(observedAt, eastern).ToString("yyyy-MM-dd");
            }
            catch
            {
                SetScopeUnavailable(scope, "SOURCE_ERROR", false);
                return;
            }

            foreach (KeyValuePair<Account, string> pair in accountIds)
            {
                try
                {
                    // AccountItem.RealizedProfitLoss session/reset semantics are
                    // not yet proven for this environment. Do not label it daily.
                    VnmMoneyObservationV2 realized =
                        UnavailableMoneyV2("SOURCE_UNSUPPORTED");
                    VnmMoneyObservationV2 unrealized;
                    string status = pair.Key.Connection == null
                        ? "unavailable" : MapConnectionStatusV2(pair.Key.Connection.Status);
                    if (status != "connected")
                    {
                        unrealized = UnavailableMoneyV2("ACCOUNT_DISCONNECTED");
                    }
                    else if (pair.Key.Denomination != Currency.UsDollar)
                    {
                        unrealized = UnavailableMoneyV2("SOURCE_UNSUPPORTED");
                    }
                    else
                    {
                        unrealized = ReadAccountMoneyV2(
                            pair.Key, AccountItem.UnrealizedProfitLoss,
                            "ninjatrader_account_item", scope);
                    }
                    target.Add(new VnmPnlObservationV2 {
                        AccountLocalId = pair.Value,
                        SessionDate = sessionDate,
                        Daily = new VnmDailyPnlObservationV2 {
                            Realized = realized,
                            Unrealized = unrealized
                        },
                        NativeLifetime = UnavailableMoneyV2("SOURCE_UNSUPPORTED")
                    });
                }
                catch
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                    target.Add(new VnmPnlObservationV2 {
                        AccountLocalId = pair.Value,
                        SessionDate = sessionDate,
                        Daily = new VnmDailyPnlObservationV2 {
                            Realized = UnavailableMoneyV2("SOURCE_UNSUPPORTED"),
                            Unrealized = UnavailableMoneyV2("SOURCE_ERROR")
                        },
                        NativeLifetime = UnavailableMoneyV2("SOURCE_UNSUPPORTED")
                    });
                }
            }
        }

        private static VnmMoneyObservationV2 ReadAccountMoneyV2(
            Account account, AccountItem item, string source, VnmCollectionScopeV2 scope)
        {
            try
            {
                double observation = account.Get(item, Currency.UsDollar);
                long amountMinor;
                if (!TryMoneyMinorV2(observation, out amountMinor))
                {
                    AddScopeError(scope, "SOURCE_ERROR", true);
                    return UnavailableMoneyV2("SOURCE_ERROR");
                }
                return new VnmMoneyObservationV2 {
                    Availability = "available",
                    Currency = "USD",
                    AmountMinor = amountMinor,
                    Source = source,
                    ReasonCode = null
                };
            }
            catch
            {
                AddScopeError(scope, "SOURCE_ERROR", true);
                return UnavailableMoneyV2("SOURCE_ERROR");
            }
        }

        private static VnmMoneyObservationV2 UnavailableMoneyV2(string reason)
        {
            return new VnmMoneyObservationV2 {
                Availability = "unavailable",
                Currency = "USD",
                AmountMinor = null,
                Source = null,
                ReasonCode = reason
            };
        }

        private static bool TryMoneyMinorV2(double value, out long amountMinor)
        {
            amountMinor = 0;
            if (!IsFinite(value))
                return false;
            try
            {
                decimal rounded = decimal.Round(
                    Convert.ToDecimal(value, CultureInfo.InvariantCulture) * 100m,
                    0,
                    MidpointRounding.AwayFromZero);
                if (rounded < -100000000000m || rounded > 100000000000m)
                    return false;
                amountMinor = decimal.ToInt64(rounded);
                return true;
            }
            catch { return false; }
        }

        private static VnmIpcResponse BuildRuntimeObservationV2Response(string requestId, byte[] secret)
        {
            VnmRuntimeBuildV2 build = BuildRuntimeObservationV2();
            if (build.WorkingOrderLocalIds.Count > MaximumRuntimeItems)
                throw new InvalidOperationException("Working order state exceeds the protocol limit.");

            while (true)
            {
                SortRuntimeObservationV2(build.Snapshot);
                string payloadJson = Serialize(build.Snapshot);
                VnmIpcResponse response = SignedSuccess(requestId, payloadJson, secret);
                if (Encoding.UTF8.GetByteCount(Serialize(response) + "\n") <= MaximumMessageBytes)
                    return response;
                if (!TrimOldestHistoryBatchV2(build))
                    throw new InvalidOperationException("Current runtime state exceeds the signed response limit.");
            }
        }

        private static bool TrimOldestHistoryBatchV2(VnmRuntimeBuildV2 build)
        {
            HashSet<string> referenced = new HashSet<string>(
                build.Snapshot.Executions.Select(item => item.OrderLocalId),
                StringComparer.Ordinal);
            List<VnmOrderObservationV2> removableOrders = build.Snapshot.Orders
                .Where(item => item.Lifecycle == "completed"
                    && !build.WorkingOrderLocalIds.Contains(item.LocalId)
                    && !referenced.Contains(item.LocalId))
                .OrderBy(item => item.CompletedAt, StringComparer.Ordinal)
                .ThenBy(item => item.LocalId, StringComparer.Ordinal)
                .ToList();
            int historyCount = removableOrders.Count + build.Snapshot.Executions.Count;
            if (historyCount == 0)
                return false;

            int removeBudget = Math.Max(1, historyCount / 2);
            List<VnmOrderObservationV2> ordersToRemove = removableOrders
                .Take(removeBudget)
                .ToList();
            foreach (VnmOrderObservationV2 order in ordersToRemove)
                build.Snapshot.Orders.Remove(order);
            if (ordersToRemove.Count > 0)
                AddScopeError(
                    build.Snapshot.CollectionScopes.Orders,
                    "CAPABILITY_UNSUPPORTED", false);

            int remaining = removeBudget - ordersToRemove.Count;
            List<VnmExecutionObservationV2> executionsToRemove = build.Snapshot.Executions
                .OrderBy(item => item.ExecutedAt, StringComparer.Ordinal)
                .ThenBy(item => item.LocalId, StringComparer.Ordinal)
                .Take(remaining)
                .ToList();
            foreach (VnmExecutionObservationV2 execution in executionsToRemove)
                build.Snapshot.Executions.Remove(execution);
            if (executionsToRemove.Count > 0)
                AddScopeError(
                    build.Snapshot.CollectionScopes.Executions,
                    "CAPABILITY_UNSUPPORTED", false);
            return ordersToRemove.Count + executionsToRemove.Count > 0;
        }

        private static void SortRuntimeObservationV2(VnmRuntimeObservationV2 snapshot)
        {
            snapshot.Connections = snapshot.Connections.OrderBy(item => item.LocalId, StringComparer.Ordinal).ToList();
            snapshot.Accounts = snapshot.Accounts.OrderBy(item => item.LocalId, StringComparer.Ordinal).ToList();
            snapshot.Strategies = snapshot.Strategies.OrderBy(item => item.LocalId, StringComparer.Ordinal).ToList();
            snapshot.Positions = snapshot.Positions.OrderBy(item => item.LocalId, StringComparer.Ordinal).ToList();
            snapshot.Orders = snapshot.Orders.OrderBy(item => item.LocalId, StringComparer.Ordinal).ToList();
            snapshot.Executions = snapshot.Executions.OrderBy(item => item.LocalId, StringComparer.Ordinal).ToList();
            snapshot.Pnl = snapshot.Pnl.OrderBy(item => item.AccountLocalId, StringComparer.Ordinal).ToList();
        }

        private static bool IsEnabledLifecycle(State state)
        {
            return state == State.Historical || state == State.Transition || state == State.Realtime;
        }

        private static bool? CalculateSync(StrategyBase strategy, bool enabled)
        {
            if (!enabled || strategy.State != State.Realtime)
                return null;
            try
            {
                if (strategy.Instruments == null || strategy.Instruments.Length != 1)
                    return null;
                object strategyPosition = ReadProperty(strategy, "Position");
                object accountPosition = ReadProperty(strategy, "PositionAccount");
                if (strategyPosition == null || accountPosition == null)
                    return null;
                string strategyMarketPosition = ReadPropertyString(strategyPosition, "MarketPosition");
                string accountMarketPosition = ReadPropertyString(accountPosition, "MarketPosition");
                string strategyQuantity = ReadPropertyString(strategyPosition, "Quantity");
                string accountQuantity = ReadPropertyString(accountPosition, "Quantity");
                if (string.IsNullOrEmpty(strategyMarketPosition) || string.IsNullOrEmpty(accountMarketPosition))
                    return null;
                return strategyMarketPosition == accountMarketPosition && strategyQuantity == accountQuantity;
            }
            catch { return null; }
        }

        private static string ReadInstrument(StrategyBase strategy)
        {
            try
            {
                if (strategy.Instruments != null && strategy.Instruments.Length > 0 && strategy.Instruments[0] != null)
                    return strategy.Instruments[0].FullName ?? string.Empty;
            }
            catch { }
            return "UNSUPPORTED";
        }

        private static string ReadTimeframe(StrategyBase strategy)
        {
            object barsPeriod = ReadProperty(strategy, "BarsPeriod");
            if (barsPeriod == null)
                return "Unsupported:Missing";
            string periodType = ReadPropertyString(barsPeriod, "BarsPeriodType");
            string valueText = ReadPropertyString(barsPeriod, "Value");
            int value;
            if (!int.TryParse(valueText, out value) || value < 1)
                value = 1;
            if (periodType == "Second" || periodType == "Minute" || periodType == "Day")
                return value + " " + periodType;
            if (periodType == "Tick" || periodType == "Range")
                return periodType;
            return "Unsupported:" + (periodType ?? "Unknown");
        }

        private static string ReadConnectionStatus(Account account)
        {
            object connection = ReadProperty(account, "Connection");
            if (connection == null)
                return string.Empty;
            foreach (string name in new[] { "Status", "ConnectionStatus", "PriceStatus" })
            {
                string value = ReadPropertyString(connection, name);
                if (!string.IsNullOrEmpty(value))
                    return value;
            }
            return string.Empty;
        }

        private static string MapConnectionStatus(string value)
        {
            if (string.IsNullOrEmpty(value)) return "unknown";
            if (value.IndexOf("Disconnect", StringComparison.OrdinalIgnoreCase) >= 0) return "disconnected";
            if (value.IndexOf("Connecting", StringComparison.OrdinalIgnoreCase) >= 0) return "connecting";
            if (value.IndexOf("Connected", StringComparison.OrdinalIgnoreCase) >= 0) return "connected";
            return "unknown";
        }

        private static object ReadProperty(object target, string propertyName)
        {
            if (target == null) return null;
            try
            {
                PropertyInfo property = target.GetType().GetProperty(propertyName, BindingFlags.Instance | BindingFlags.Public);
                return property == null ? null : property.GetValue(target, null);
            }
            catch { return null; }
        }

        private static string ReadPropertyString(object target, string propertyName)
        {
            object value = ReadProperty(target, propertyName);
            return value == null ? string.Empty : Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
        }

        private static string ReadNestedString(object target, params string[] propertyNames)
        {
            object current = target;
            foreach (string propertyName in propertyNames)
            {
                current = ReadProperty(current, propertyName);
                if (current == null) return string.Empty;
            }
            return Convert.ToString(current, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty;
        }

        private static string ReadUtf8Line(Stream stream)
        {
            List<byte> bytes = new List<byte>();
            while (bytes.Count <= MaximumMessageBytes)
            {
                int value = stream.ReadByte();
                if (value < 0 || value == 10) break;
                if (value != 13) bytes.Add((byte)value);
            }
            if (bytes.Count == 0 || bytes.Count > MaximumMessageBytes)
                throw new InvalidDataException("Invalid local IPC message length.");
            return Encoding.UTF8.GetString(bytes.ToArray());
        }

        private static void WriteUtf8Line(Stream stream, string value)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(value + "\n");
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }

        private static string Serialize<T>(T value)
        {
            using (MemoryStream stream = new MemoryStream())
            {
                new DataContractJsonSerializer(typeof(T)).WriteObject(stream, value);
                return Encoding.UTF8.GetString(stream.ToArray());
            }
        }

        private static T Deserialize<T>(string value)
        {
            if (string.IsNullOrEmpty(value))
                throw new InvalidDataException("Empty local IPC message.");
            using (MemoryStream stream = new MemoryStream(Encoding.UTF8.GetBytes(value)))
                return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(stream);
        }
    }
}
