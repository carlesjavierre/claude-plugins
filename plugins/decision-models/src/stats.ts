import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Numbers only: no question text, inputs or error messages are logged.
export interface CallRecord {
  t: string;
  questions: number;
  models: { model: string; provider: string; host?: string; ok: boolean; latency_ms?: number; input_tokens?: number; cost_usd?: number }[];
  agreed?: boolean[];
}

// Claude Code exports CLAUDE_PLUGIN_DATA to plugin MCP servers. An unexpanded "${...}" (set by hand in a
// server env) would otherwise create a literal "${CLAUDE_PLUGIN_DATA}" folder in the working directory.
const raw = process.env.CLAUDE_PLUGIN_DATA;
const dir = raw && !raw.includes("${") ? raw : undefined;
const file = dir ? join(dir, "calls.jsonl") : undefined;

export async function record(entry: CallRecord) {
  if (!file) return;
  try {
    await mkdir(dir!, { recursive: true });
    await appendFile(file, JSON.stringify(entry) + "\n");
  } catch {
    // Stats are best-effort; a full disk must not fail the user's question.
  }
}

// USD per 1M input tokens, public list prices as of 2026-11-01 (output tokens are free on all four).
// Only used when the provider doesn't report the actual charge; update when prices change.
const PRICE_PER_M: Record<string, number> = { jev: 0.042, clef: 0.24, "clef-flash": 0.038, "gpt-6-luna": 0.1 };
export const PRICES_AS_OF = "2026-11-01";

const percentile = (sorted: number[], q: number) => (sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null);

function summarize(calls: CallRecord[]) {
  const byRoute = new Map<string, { latencies: number[]; calls: number; errors: number; input_tokens: number; cost: number; estimated: boolean; unpriced: boolean }>();
  let consensusQuestions = 0;
  let agreed = 0;
  for (const call of calls) {
    for (const m of call.models) {
      const key = `${m.model} via ${m.provider}${m.host ? ` (${m.host})` : ""}`;
      const s = byRoute.get(key) ?? { latencies: [], calls: 0, errors: 0, input_tokens: 0, cost: 0, estimated: false, unpriced: false };
      s.calls++;
      if (!m.ok) s.errors++;
      if (m.ok && m.latency_ms !== undefined) s.latencies.push(m.latency_ms);
      s.input_tokens += m.input_tokens ?? 0;
      if (m.cost_usd !== undefined) s.cost += m.cost_usd;
      else if (m.input_tokens && PRICE_PER_M[m.model] !== undefined) {
        s.cost += (m.input_tokens * PRICE_PER_M[m.model]) / 1e6;
        s.estimated = true;
      } else if (m.ok && m.input_tokens) {
        s.unpriced = true; // e.g. a custom-gateway model with no public price here
      }
      byRoute.set(key, s);
    }
    consensusQuestions += call.agreed?.length ?? 0;
    agreed += call.agreed?.filter(Boolean).length ?? 0;
  }
  const models = [...byRoute].map(([route, s]) => {
    const sorted = s.latencies.sort((a, b) => a - b);
    return {
      route, calls: s.calls, errors: s.errors, p50_ms: percentile(sorted, 0.5), p95_ms: percentile(sorted, 0.95),
      input_tokens: s.input_tokens, cost_usd: Number(s.cost.toFixed(6)), cost_estimated: s.estimated, ...(s.unpriced ? { cost_unknown: true } : {}),
    };
  });
  return {
    calls: calls.length,
    questions: calls.reduce((n, c) => n + c.questions, 0),
    cost_usd: Number(models.reduce((sum, m) => sum + m.cost_usd, 0).toFixed(6)),
    cost_estimated: models.some((m) => m.cost_estimated),
    ...(models.some((m) => m.cost_unknown) ? { cost_incomplete: true } : {}),
    models,
    consensus: { questions: consensusQuestions, agreed },
  };
}

export async function stats() {
  if (!file) return { error: "No plugin data folder (CLAUDE_PLUGIN_DATA is unset), so nothing is recorded." };
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { calls: 0, note: "No calls recorded yet." };
  }
  // A line cut short by a crash mid-append is skipped rather than failing the whole report.
  const all: CallRecord[] = text.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  return {
    prices_as_of: PRICES_AS_OF,
    today: summarize(all.filter((c) => new Date(c.t) >= midnight)),
    last_7_days: summarize(all.filter((c) => Date.parse(c.t) >= weekAgo)),
    all_time: summarize(all),
  };
}
