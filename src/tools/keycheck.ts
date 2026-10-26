// Retained as a compatibility entrypoint so old local commands fail safely.
// This paper-only lab does not accept or validate broker or remote model credentials.
process.stderr.write("keycheck is disabled in the paper-only local lab; no credentials are used.\n");
process.exitCode = 1;
