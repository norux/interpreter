import { spawn } from "node:child_process";

// Run the real integration and retained default-profile quality gates. A failed
// command stays failed; later independent checks still record their evidence.
const commands = [
  "typecheck:framework",
  "test:framework:chrome:preparation",
  "test:framework:chrome:tab-input",
  "test:framework:chrome:tab-host",
  "test:framework:chrome:channel",
  "test:framework:chrome:overlay",
  "test:framework:chrome:composition",
  "test:framework:chrome:translation",
  "test:framework:chrome:sustained",
  "test:framework:chrome:live:gpu-recovery",
  "test:framework:chrome:eof",
  "test:framework:chrome:quiet",
  "test:framework:chrome:noise:learned",
  "test:framework:chrome:live:sustained:learned",
];
const results = [];
for (const command of commands) {
  const began = performance.now();
  const result = await new Promise(resolve => {
    const child = spawn("npm", ["run", command], { stdio: "inherit" });
    child.once("error", error => resolve({ error: error.message }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  results.push({ command, ...result, durationMs: performance.now() - began });
  console.log(JSON.stringify({ chromeAcceptance: results.at(-1) }));
  // Functional failures stop the run. Accuracy/latency suites retain their
  // nonzero results while the remaining distinct quality fixtures execute.
  if (result.code !== 0 && !["test:framework:chrome:live:gpu-recovery", "test:framework:chrome:eof", "test:framework:chrome:quiet",
    "test:framework:chrome:noise:learned", "test:framework:chrome:live:sustained:learned"].includes(command)) break;
}
const passed = results.length === commands.length && results.every(result => result.code === 0);
console.log(JSON.stringify({ chromeAcceptanceSummary: { passed, results } }));
if (!passed) process.exitCode = 1;
