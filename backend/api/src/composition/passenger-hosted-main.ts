import { bindGracefulShutdown } from "./local-server.js";
import { startPasswordlessHostedServer } from "./hosted-server.js";
import { passengerEnvironment } from "./passenger-environment.js";
import { JsonLineOperationalLog } from "../runtime/operational-log.js";

// Phusion Passenger startup entry for the DirectAdmin/CloudLinux Node.js
// Selector on generic host. Passenger loads this file with require() instead of
// executing it as the process main module, so unlike the other executables it
// must start unconditionally — there is deliberately no direct-invocation
// guard here. Passenger intercepts the listen() call and manages the socket;
// DirectAdmin's STOP/RESTART controls deliver the SIGTERM handled by the
// existing graceful shutdown.
async function main(): Promise<void> {
  // The Passenger/lsnode runtime discards application stdout (/dev/null) and
  // captures only stderr into the selector's configured log file, so the
  // operational JSON lines must go to stderr here to be observable at all.
  const server = await startPasswordlessHostedServer(
    passengerEnvironment(process.env),
    new JsonLineOperationalLog(process.stderr),
  );
  bindGracefulShutdown(server, process, () => {
    process.exitCode = 1;
  });
}

// The reason belongs in the log: a swallowed error turned a 85-byte bundle
// overrun into a blind outage on 2026-09-07. Name and message only; the
// operational log already owns anything more.
void main().catch((error: unknown) => {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`MK8DX hosted API startup failed. ${reason}\n`);
  process.exitCode = 1;
});
