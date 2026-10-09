// Production popup/reference lifetime is checked with actual browser models and capture.
// Use the focused lifecycle scenario; the engine harness also checks all four input forms.
process.argv.push("--lifecycle");
await import("./framework-chrome-tab-engine.mjs");
