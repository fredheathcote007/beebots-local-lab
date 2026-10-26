// Retained as a compatibility entrypoint so old local commands fail safely.
// Remote chooser calls are disabled for Phase 1; the engine uses the deterministic chooser.
process.stderr.write("jev:check is disabled in the paper-only local lab; no remote model call was made.\n");
process.exitCode = 1;
