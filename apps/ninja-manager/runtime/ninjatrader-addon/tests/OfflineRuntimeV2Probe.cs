using System;
using System.IO;
using System.Reflection;

namespace Vincere.NinjaManager.OfflineTests
{
    public static class OfflineRuntimeV2Probe
    {
        public static int Main(string[] args)
        {
            if (args.Length != 2)
                return Fail("Expected Add-On source path and NinjaTrader bin path.");

            string sourcePath = Path.GetFullPath(args[0]);
            string ninjaTraderBin = Path.GetFullPath(args[1]);
            AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender, ResolveEventArgs eventArgs)
            {
                string name = new AssemblyName(eventArgs.Name).Name + ".dll";
                string candidate = Path.Combine(ninjaTraderBin, name);
                return File.Exists(candidate) ? Assembly.LoadFrom(candidate) : null;
            };

            try
            {
                RunBehaviorVectors();
                RunSourceSafetyChecks(sourcePath);
                Console.WriteLine(
                    "PASS runtime-v2 vectors: strategy=[Steady,Bad_Type,Strategy_9Edge,<rejected>] "
                    + "classification=[Simulator:simulation,Playback:simulation,Collective2:unknown]");
                return 0;
            }
            catch (Exception exception)
            {
                return Fail(exception.ToString());
            }
        }

        private static void RunBehaviorVectors()
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            Type addon = RequireType(
                assembly,
                "NinjaTrader.NinjaScript.AddOns.VincereNinjaManagerIpcAddOn");
            MethodInfo normalize = RequireMethod(addon, "NormalizeStrategyTypeCodeV2");
            AssertEqual("Steady", InvokeString(normalize, "Company.Algos.Steady"), "namespace normalization");
            AssertEqual("Bad_Type", InvokeString(normalize, "Company.Bad Type"), "invalid-character normalization");
            AssertEqual("Strategy_9Edge", InvokeString(normalize, "Company.9Edge"), "numeric-prefix normalization");
            AssertEqual(string.Empty, InvokeString(normalize, "Company." + new string('A', 81)), "oversize rejection");

            Type provider = RequireType(
                Assembly.Load("NinjaTrader.Core"),
                "NinjaTrader.Cbi.Provider");
            MethodInfo classify = RequireMethod(addon, "ClassifyAccountProviderV2");
            AssertClassification(classify, provider, "Simulator", "simulation", null);
            AssertClassification(classify, provider, "Playback", "simulation", null);
            AssertClassification(
                classify, provider, "Collective2", "unknown", "CLASSIFICATION_UNAVAILABLE");
        }

        private static void RunSourceSafetyChecks(string sourcePath)
        {
            string source = File.ReadAllText(sourcePath);
            string accountClassifier = Slice(
                source,
                "private static VnmClassificationEvidenceV2 ClassifyAccountV2",
                "private static VnmClassificationEvidenceV2 ClassifyAccountProviderV2");
            AssertFalse(accountClassifier.Contains(".Connection"), "account classification reads connection evidence");
            AssertFalse(accountClassifier.Contains("Mode"), "account classification reads connection mode");
            AssertFalse(accountClassifier.Contains("IsDemo"), "account classification reads demo state");
            AssertFalse(source.Contains("GetAccountItem("), "undocumented GetAccountItem API remains");
            AssertTrue(source.Contains("account.Get(item, Currency.UsDollar)"), "documented Account.Get API is absent");
            AssertTrue(
                source.Contains(
                    "Realized = UnavailableMoneyV2(" + (char)34
                    + "SOURCE_UNSUPPORTED" + (char)34 + ")"),
                "daily realized P&L is not fail-closed");
            AssertFalse(
                source.Contains("pair.Key.Orders.Where(item => item != null).ToList()"),
                "order history is copied without a bound");
            AssertFalse(
                source.Contains("pair.Key.Executions.Where(item => item != null).ToList()"),
                "execution history is copied without a bound");
            AssertFalse(
                source.Contains("order.OrderUpdates.Where(item => item != null).ToList()"),
                "order update history is copied without a bound");
            AssertTrue(
                source.Contains("TrimOldestHistoryBatchV2"),
                "signed-response history does not use batch trimming");
            AssertTrue(
                source.Contains("MarkSequentialScopesPartialV2"),
                "sequential runtime scopes are not marked non-atomic");
            AssertTrue(
                source.Contains("case \"GET_MUTATION_READINESS_PREFLIGHT\":"),
                "mutation-readiness command is absent from the authenticated dispatcher");
            AssertTrue(
                source.Contains("CaptureMutationSafetySummary(secret)"),
                "mutation-readiness command does not capture its dedicated safety summary");
            AssertTrue(
                source.Contains("MutationStateToken"),
                "mutation-readiness keyed state input is not length-framed");
            AssertTrue(
                source.Contains("bounded_consecutive_stability"),
                "mutation-readiness response does not disclose its limited consistency method");
            AssertTrue(
                source.Contains("Atomicity = \"not_guaranteed\""),
                "mutation-readiness response overclaims atomicity");
            AssertTrue(
                source.Contains("RUNTIME_CHANGED_DURING_PREFLIGHT"),
                "mutation-readiness does not fail closed when consecutive samples differ");
            string readinessDtos = Slice(
                source,
                "// Mutation-readiness is a separate, short-lived read-only contract.",
                "// Internal capture metadata never crosses the pipe.");
            AssertFalse(readinessDtos.Contains("localId"), "preflight DTO exposes a local identifier");
            AssertFalse(readinessDtos.Contains("accountName"), "preflight DTO exposes an account name");
            AssertFalse(readinessDtos.Contains("orderId"), "preflight DTO exposes an order identifier");
        }

        private static void AssertClassification(
            MethodInfo classify,
            Type provider,
            string providerName,
            string expectedAccountType,
            string expectedReason)
        {
            object evidence = classify.Invoke(
                null,
                new[] { Enum.Parse(provider, providerName) });
            Type evidenceType = evidence.GetType();
            AssertEqual(
                expectedAccountType,
                Convert.ToString(evidenceType.GetProperty("AccountType").GetValue(evidence, null)),
                providerName + " account type");
            AssertEqual(
                expectedReason,
                evidenceType.GetProperty("UnavailableReasonCode").GetValue(evidence, null),
                providerName + " unavailable reason");
            AssertEqual(null, evidenceType.GetProperty("IsSimulation").GetValue(evidence, null), providerName + " isSimulation");
            AssertEqual(null, evidenceType.GetProperty("SimulationMode").GetValue(evidence, null), providerName + " simulationMode");
        }

        private static string InvokeString(MethodInfo method, string value)
        {
            return Convert.ToString(method.Invoke(null, new object[] { value }));
        }

        private static Type RequireType(Assembly assembly, string name)
        {
            Type type = assembly.GetType(name, false);
            if (type == null)
                throw new InvalidOperationException("Missing type: " + name);
            return type;
        }

        private static MethodInfo RequireMethod(Type type, string name)
        {
            MethodInfo method = type.GetMethod(
                name,
                BindingFlags.NonPublic | BindingFlags.Static);
            if (method == null)
                throw new InvalidOperationException("Missing method: " + name);
            return method;
        }

        private static string Slice(string value, string start, string end)
        {
            int first = value.IndexOf(start, StringComparison.Ordinal);
            int last = value.IndexOf(end, first + start.Length, StringComparison.Ordinal);
            if (first < 0 || last < 0)
                throw new InvalidOperationException("Cannot locate source safety slice.");
            return value.Substring(first, last - first);
        }

        private static void AssertTrue(bool value, string message)
        {
            if (!value)
                throw new InvalidOperationException(message);
        }

        private static void AssertFalse(bool value, string message)
        {
            AssertTrue(!value, message);
        }

        private static void AssertEqual(object expected, object actual, string label)
        {
            if (!object.Equals(expected, actual))
                throw new InvalidOperationException(
                    label + ": expected <" + expected + "> but got <" + actual + ">.");
        }

        private static int Fail(string message)
        {
            Console.Error.WriteLine("FAIL runtime-v2 offline probe: " + message);
            return 1;
        }
    }
}
