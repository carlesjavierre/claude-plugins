import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { extname } from "node:path";
import { judge, mean } from "./consensus.ts";
import { stats } from "./stats.ts";
import { agreement, ask, consensus, defaultModels, enabled, loadInput, MIME, misrouted, providerStatus, resolveModels, routes, type Question } from "./providers.ts";

const configured = [...routes.keys()];
const defaults = defaultModels();

const question = z.object({
  name: z.string().optional().describe("Optional short label to find this question in the result."),
  type: z.enum(["yes_no", "choice", "score"]),
  question: z.string().describe("The question. Phrase yes_no so that a true answer means yes. No output-format instructions."),
  options: z.array(z.string()).min(2).max(255).optional()
    .describe('choice only. Each option is "name" or "name: description". Use descriptive names, not A/B/C.'),
  levels: z.array(z.string()).min(2).max(10).optional().describe("score only. Ordered levels, lowest first."),
});

const server = new McpServer({ name: "decision-models", version: "0.1.0" });

server.registerTool(
  "ask",
  {
    description: [
      "Ask cheap decision models (Jev, Clef, GPT-6 Luna) typed questions about text, files or images and get calibrated probabilities.",
      "Prefer this over reading in full, reasoning through, or delegating any yes/no, classification, ranking or score judgment: triaging diffs, logs, test output, search hits or findings; locating which candidate files implement a behavior; checking an edit against a project rule; checking a screenshot.",
      "Pass large inputs as file paths, not inline text: the server reads them, so their content never goes through your context.",
      "Batch every question about the same input into one call; the input is then sent and billed once.",
      "For many homogeneous units (file diffs, logs, findings, screenshots), write one file per unit and pass them as items: one call judges them all.",
      "Reading the result (one entry per question in results[], one per model in per_model[]):",
      "- yes_no: probability = chance the answer is yes (verdict yes when >= 0.5). Trust it below 0.2 or above 0.8; in between the model is unsure.",
      "- choice: choice = the picked option, probabilities = every option (an \"other\" option is always added), confidence = certainty of the pick, fit_probability = chance any listed option fits at all. none_fit=true (picked \"other\" or fit_probability < 0.5) means none of your options fits: ignore the pick.",
      "- score: score = probability-weighted level index from 0 (lowest level) and can fall between levels; level/label = nearest level; confidence = certainty.",
      `- answer = the combined verdict (yes/no, an option or none_fit, a level label), null when the models didn't agree. Agreement rule: ${agreement} (${agreement === "majority" ? "more than half of the models that answered" : "every model that answered"}); votes counts each verdict. agreed=false means no verdict: investigate yourself instead of trusting any model. partial=true means some models failed (see errors), so fewer models stand behind the answer.`,
      "- These are cheap evidence, not decisions: weigh them, and never let them alone decide a destructive or outward-facing action.",
      `Configured models: ${configured.join(", ") || "none (set an API key in the plugin options)"}. Used when asking all: ${enabled.join(", ") || "none"}. Default: ${defaults.models.join(",") || "none"} (consensus: ${consensus}).`,
    ].join("\n"),
    inputSchema: {
      questions: z.array(question).min(1).max(32),
      text: z.string().optional().describe("Short inline content. Prefer files for anything long."),
      files: z.array(z.string()).optional().describe("Absolute paths of text files to evaluate."),
      images: z.array(z.string()).optional().describe("Absolute paths of png/jpg/webp images (Jev: png/jpg only)."),
      items: z.array(z.string()).min(1).max(500).optional().describe(
        "Batch: absolute paths, one unit each (a text file, or a png/jpg/webp image). The same questions are asked about every item separately; text, if given, is framing shared by every item. Returns summary (per question: counts per answer, uncertain items) and items (per item, per question: answer, p_yes or confidence, votes when models split). Can't be combined with files or images.",
      ),
      models: z.string().optional().describe('One model, a comma-separated consensus set ("jev,clef"), or "all". Omit for the default.'),
    },
    annotations: { openWorldHint: true },
  },
  async ({ questions, text, files, images, items, models }) => {
    try {
      for (const q of questions as Question[]) {
        if (q.type === "choice" && !q.options) throw new Error(`choice question needs options: ${q.question}`);
        if (q.type === "score" && !q.levels) throw new Error(`score question needs levels: ${q.question}`);
      }
      if (items && (files?.length || images?.length)) throw new Error("items can't be combined with files or images; put shared framing in text.");
      const { models: chosen, note } = resolveModels(models);
      const json = (output: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }] });
      if (items) return json({ models: chosen, ...(note ? { note } : {}), ...(await batch(chosen, questions as Question[], items, text)) });
      // A question about general knowledge ("is the sky blue?") has no separate input: evaluate the question itself.
      const subject = text || files?.length || images?.length ? text : questions.map((q) => q.question).join("\n");
      const loaded = await loadInput({ text: subject, files, images });
      return json({ models: chosen, ...(note ? { note } : {}), ...(await judge(chosen, questions as Question[], loaded)) });
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: (e as Error).message }] };
    }
  },
);

// ponytail: fixed fan-out of 16 items at a time and no retries; failed items are listed for the caller to re-run.
const BATCH_CONCURRENCY = 16;

// Same questions over many items, one judgment per item, with a compact per-item table so bulk results stay small.
async function batch(chosen: string[], questions: Question[], items: string[], framing?: string) {
  const names = questions.map((q, i) => q.name ?? `q${i + 1}`);
  const table: Record<string, unknown> = {};
  const failed: Record<string, string> = {};
  const summary = Object.fromEntries(names.map((n) => [n, { counts: {} as Record<string, number>, uncertain: [] as string[] }]));
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        const isImage = extname(item).toLowerCase() in MIME;
        const loaded = await loadInput({ text: framing, ...(isImage ? { images: [item] } : { files: [item] }) });
        const out = await judge(chosen, questions, loaded);
        const row: Record<string, unknown> = out.partial ? { partial: true } : {};
        out.results.forEach((r, i) => {
          const per = r.per_model as { probability?: number; confidence?: number }[];
          const confidence = r.type === "yes_no" ? undefined : mean(per.map((p) => p.confidence!));
          const disputed = Object.keys(r.votes).length > 1;
          row[names[i]] = {
            answer: r.answer,
            ...(r.type === "yes_no" ? { p_yes: r.mean_probability } : { confidence }),
            ...(r.type === "score" ? { score: r.mean_score } : {}),
            ...(disputed ? { votes: r.votes } : {}),
          };
          const s = summary[names[i]];
          const key = r.answer ?? "disagreed";
          s.counts[key] = (s.counts[key] ?? 0) + 1;
          const p = r.mean_probability;
          if (r.answer === null || r.answer === "none_fit" || (p !== undefined && p > 0.2 && p < 0.8) || (confidence !== undefined && confidence < 0.8)) s.uncertain.push(item);
        });
        table[item] = row;
      } catch (e) {
        failed[item] = (e as Error).message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, items.length) }, worker));
  return { agreement_rule: agreement, total: items.length, summary, ...(Object.keys(failed).length ? { failed } : {}), items: table };
}

server.registerTool(
  "status",
  {
    description: "Show which decision-model providers are configured (never the keys), the default model, and test each configured model with one tiny question.",
    annotations: { openWorldHint: true },
  },
  async () => {
    const ping = { text: "hello", files: {}, images: [] };
    const pings = await Promise.all(configured.map(async (model) => {
      try {
        const r = await ask(model, [{ type: "yes_no", question: "Is this a greeting?" }], ping);
        return { model, enabled: enabled.includes(model), provider: r.provider, ok: true, latency_ms: r.latency_ms };
      } catch (e) {
        return { model, enabled: enabled.includes(model), ok: false, error: (e as Error).message };
      }
    }));
    const output = { providers: providerStatus, default: defaults, consensus, models: pings, ...(Object.keys(misrouted).length ? { misrouted } : {}) };
    return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
  },
);

server.registerTool(
  "stats",
  {
    description: "Usage stats of the ask tool, per model and provider: calls, errors, p50/p95 latency, input tokens, and how often multi-model questions agreed. For today, the last 7 days and all time. Setup pings are not counted.",
    annotations: { readOnlyHint: true },
  },
  async () => ({ content: [{ type: "text", text: JSON.stringify(await stats(), null, 2) }] }),
);

await server.connect(new StdioServerTransport());
