export interface BenchmarkOptions {
  count: number;
  concurrency: number;
  fixture: "minimal" | "bee-realistic";
  timeout: number;
  samples: number;
  socket: string | null;
  stats: boolean;
}
export interface SyntheticRequest {
  model: string;
  state: { bee: string; [key: string]: unknown };
  questions: {
    action: { type: "choice"; instructions: string; criteria: Record<string, string | null> };
    conviction: { type: "score"; instructions: string; criteria: string[] };
  };
}
export function percentile(values: number[], p: number): number | null;
export function validDistribution(choice: unknown, probabilities: unknown, labels: string[]): boolean;
export function summariseRows(rows: Array<{ status: string; modelAccepted?: boolean; latencyMs: number }>): { ok: number; modelAccepted: number; timeouts: number; statusCounts: Record<string, number>; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; p50OkMs: number | null; p95OkMs: number | null; p99OkMs: number | null };
export function fixture(type: "minimal" | "bee-realistic", index?: number): SyntheticRequest;
export function parseArgs(argv: string[]): BenchmarkOptions & { help?: true };
export function runBenchmark(options: BenchmarkOptions): Promise<Record<string, unknown>>;
export const LOOPBACK_ORIGIN: string;
export const SYSTEM_ONE_PATH: string;
export const ALLOWED_SOCKET: string;
export const EXPECTED_MODEL: string;
export const MAX_RUN_MS: number;
export const HELP: string;
