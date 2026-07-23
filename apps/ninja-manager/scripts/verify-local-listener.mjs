import { execFile, spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const processQueryTimeout = 5_000;
const shutdownGrace = 5_000;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a test port"));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function connect(host, port, timeout = 750) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let complete = false;
    const finish = (connected) => {
      if (complete) return;
      complete = true;
      socket.destroy();
      resolve(connected);
    };
    socket.setTimeout(timeout, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForListener(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await connect("127.0.0.1", port, 250)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`LOCAL_ONLY production server did not listen on 127.0.0.1:${port}`);
}

async function waitForClosedSocket(port, timeout = shutdownGrace) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!await connect("127.0.0.1", port, 250)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !await connect("127.0.0.1", port, 250);
}

function windowsListenerAddresses(port) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `@(Get-NetTCPConnection -State Listen -LocalPort ${port} | Select-Object -ExpandProperty LocalAddress -Unique) -join ','`,
    ], {
      encoding: "utf8",
      timeout: processQueryTimeout,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        reject(new Error(`Timed out or failed while inspecting Windows listeners on port ${port}`, { cause: error }));
      } else {
        resolve(stdout.trim().split(",").filter(Boolean));
      }
    });
  });
}

function terminateWindowsTree(processId, force) {
  return new Promise((resolve, reject) => {
    const arguments_ = ["/PID", String(processId), "/T"];
    if (force) arguments_.push("/F");
    execFile("taskkill.exe", arguments_, {
      encoding: "utf8",
      timeout: processQueryTimeout,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }
      const detail = `${stdout}\n${stderr}\n${error.message}`;
      if (/not found|not running|no running instance/i.test(detail)) {
        resolve();
        return;
      }
      reject(new Error(`Failed to terminate owned Windows process tree ${processId}`, { cause: error }));
    });
  });
}

function waitForExit(exitPromise, timeout) {
  return Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(() => resolve(undefined), timeout)),
  ]);
}

async function terminateOwnedTree(child, exitPromise, getExitState, port) {
  const processId = child.pid;
  if (!getExitState()) {
    if (process.platform === "win32" && processId) {
      try {
        await terminateWindowsTree(processId, false);
      } catch {
        // The forced, bounded tree termination below is the authoritative fallback.
      }
    } else {
      child.kill("SIGTERM");
    }
  }

  let exitState = getExitState() ?? await waitForExit(exitPromise, shutdownGrace);
  let socketClosed = await waitForClosedSocket(port, shutdownGrace);

  if (!exitState || exitState.kind !== "exit" || !socketClosed) {
    if (process.platform === "win32" && processId) {
      await terminateWindowsTree(processId, true);
    } else if (!exitState || exitState.kind !== "exit") {
      child.kill("SIGKILL");
    }
    exitState = getExitState() ?? await waitForExit(exitPromise, shutdownGrace);
    socketClosed = await waitForClosedSocket(port, shutdownGrace);
  }

  if (!exitState || exitState.kind !== "exit") {
    throw new Error("LOCAL_ONLY launcher process did not exit after owned-tree termination");
  }
  if (!socketClosed) {
    throw new Error(`LOCAL_ONLY listener remained active after owned-tree termination on port ${port}`);
  }
}

const port = await reservePort();
const output = [];
const child = spawn(
  process.execPath,
  [path.join(projectRoot, "scripts", "next-runtime.mjs"), "start", "--mode", "LOCAL_ONLY", "--port", String(port)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      APP_URL: `http://127.0.0.1:${port}`,
      NINJA_MANAGER_BIND_HOST: "127.0.0.1",
      NINJA_MANAGER_MODE: "LOCAL_ONLY",
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let exitState;
const exitPromise = new Promise((resolve) => {
  child.once("error", (error) => {
    exitState = { kind: "error", error };
    resolve(exitState);
  });
  child.once("exit", (code, signal) => {
    exitState = { kind: "exit", code, signal };
    resolve(exitState);
  });
});
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));

let verificationError;
try {
  const startupResult = await Promise.race([
    waitForListener(port).then(() => ({ kind: "listener" })),
    exitPromise.then((state) => ({ kind: "exit", state })),
  ]);
  if (startupResult.kind === "exit") {
    const detail = startupResult.state.kind === "error"
      ? startupResult.state.error.message
      : `code ${startupResult.state.code}, signal ${startupResult.state.signal ?? "none"}`;
    throw new Error(`LOCAL_ONLY production server exited early with ${detail}\n${output.join("")}`);
  }

  const externalAddresses = Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === "IPv4" && !address.internal)
    .map((address) => address.address);
  for (const address of externalAddresses) {
    if (await connect(address, port)) {
      throw new Error(`LOCAL_ONLY unexpectedly accepted a connection on ${address}:${port}`);
    }
  }

  if (process.platform === "win32") {
    const listeners = await windowsListenerAddresses(port);
    if (listeners.length !== 1 || listeners[0] !== "127.0.0.1") {
      throw new Error(`Expected only 127.0.0.1:${port}; found ${listeners.join(", ") || "no listener"}`);
    }
  }
} catch (error) {
  verificationError = error;
}

let cleanupError;
try {
  await terminateOwnedTree(child, exitPromise, () => exitState, port);
} catch (error) {
  cleanupError = error;
}

if (verificationError && cleanupError) {
  throw new AggregateError([verificationError, cleanupError], "Listener verification and owned-tree cleanup both failed");
}
if (verificationError) throw verificationError;
if (cleanupError) throw cleanupError;

process.stdout.write(
  `Verified LOCAL_ONLY production listener at 127.0.0.1:${port}; no non-loopback listener detected; owned process tree exited and the socket closed.\n`,
);
