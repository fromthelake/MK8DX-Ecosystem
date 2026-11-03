import { bindGracefulShutdown } from "./local-server.js";
import { startPasswordlessHostedServer } from "./hosted-server.js";
import { hostedSmtpEnvironment } from "./hosted-smtp-environment.js";

async function main(): Promise<void> {
  // The installer stores arbitrary SMTP passwords as canonical base64 in the
  // private env file. Compose interpolation must never reinterpret $, # or '.
  const environment = hostedSmtpEnvironment(process.env);
  const server = await startPasswordlessHostedServer(environment);
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
