import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// Numbers and the project folder only: no question text, inputs or error messages are logged.
export type Source = "ask" | "commit" | "triage" | "early-stop";

export interface CallRecord {
  t: string;
  questions: number;
  source?: Source; // source and project are missing on calls logged before 0.4.0.
  project?: string;
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
    // Claude Code sets CLAUDE_PROJECT_DIR (the session's project folder) for both the MCP server and hooks.
    await appendFile(file, JSON.stringify({ ...entry, project: process.env.CLAUDE_PROJECT_DIR ?? process.cwd() }) + "\n");
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
  if (!all.length) return { calls: 0, note: "No calls recorded yet." };
  const brief = (calls: CallRecord[]) => {
    const { questions, cost_usd, cost_estimated } = summarize(calls);
    return { calls: calls.length, questions, cost_usd, cost_estimated };
  };
  // Map.groupBy needs Node 21; the bundle targets Node 20.
  const group = (calls: CallRecord[], key: (c: CallRecord) => string) => {
    const m = new Map<string, CallRecord[]>();
    for (const c of calls) m.set(key(c), [...(m.get(key(c)) ?? []), c]);
    return [...m];
  };
  const bySource = (calls: CallRecord[]) => Object.fromEntries(group(calls, (c) => c.source ?? "untagged").map(([s, cs]) => [s, brief(cs)]));
  const home = homedir();
  const project = (c: CallRecord) => (!c.project ? "unknown" : c.project.startsWith(home) ? "~" + c.project.slice(home.length) : c.project);
  const byProject = (calls: CallRecord[]) => Object.fromEntries(group(calls, project).map(([p, cs]) => [p, { ...brief(cs), by_source: bySource(cs) }]));
  const day = (c: CallRecord) => new Date(c.t).toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time
  // Today and the 6 calendar days before it.
  const weekStart = new Date();
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - 6);
  const weekCalls = all.filter((c) => new Date(c.t) >= weekStart);
  return {
    prices_as_of: PRICES_AS_OF,
    since: all[0].t,
    all_time: { ...summarize(all), by_source: bySource(all), by_project: byProject(all) },
    last_7_days: group(weekCalls, day).map(([date, calls]) => ({ date, ...brief(calls), by_source: bySource(calls) })),
    last_7_days_by_project: byProject(weekCalls),
  };
}

export async function clearStats() {
  if (!file) return { error: "No plugin data folder (CLAUDE_PLUGIN_DATA is unset), so nothing is recorded." };
  const calls = await readFile(file, "utf8").then((t) => t.split("\n").filter(Boolean).length, () => 0);
  await rm(file, { force: true });
  return { cleared_calls: calls };
}
