import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Hooks get the plugin options as CLAUDE_PLUGIN_OPTION_<KEY>; the MCP server gets them under the DM_* names in
// plugin.json's server env. Map one onto the other before providers.ts loads, so both read the same settings.
const manifest = JSON.parse(readFileSync(join(process.env.CLAUDE_PLUGIN_ROOT!, ".claude-plugin/plugin.json"), "utf8"));
const option = (key: string): string | undefined =>
  process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] ?? manifest.userConfig[key]?.default?.toString();
for (const [name, value] of Object.entries<string>(manifest.mcpServers["decision-models"].env)) {
  const key = value.match(/^\$\{user_config\.(\w+)\}$/)?.[1];
  const v = key && option(key);
  if (v) process.env[name] = v;
}
const { judge } = await import("./consensus.ts");
const { loadInput, resolveModels, routes } = await import("./providers.ts");

// Flag only what the models are sure of; the ask tool documents 0.2-0.8 as unsure.
const SURE = 0.8;
const sure = (r: { answer: string | null; mean_probability?: number }) => r.answer === "yes" && r.mean_probability! >= SURE;

type HookInput = Record<string, any>;

function lastPrompt(transcript?: string): string {
  if (!transcript) return "";
  const lines = readFileSync(transcript, "utf8").trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "user" || entry.isMeta) continue;
      const content = entry.message?.content;
      // Tool results are user entries too, with no text blocks.
      const text = typeof content === "string" ? content : content?.filter((b: HookInput) => b.type === "text").map((b: HookInput) => b.text).join("\n");
      if (text) return text.slice(0, 2000);
    } catch {
      // A line being written right now isn't complete JSON yet.
    }
  }
  return "";
}

// ponytail: judges the first 30 files at once with no rate limiting; a bigger commit gets a partial check.
const MAX_FILES = 30;
const MAX_DIFF = 12_000;

async function checkCommit(input: HookInput) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: input.cwd, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  // Output filters (rtk and the like) drop git's "[branch sha]" line, so go by time instead: HEAD counts only
  // if it was committed while this command ran. A failed commit leaves an older HEAD, which is skipped.
  let sha: string, time: string;
  try {
    [sha, time] = git("log", "-1", "--format=%h %ct").trim().split(" ");
  } catch {
    return; // Not a git repo, or no commits yet.
  }
  if (Date.now() / 1000 - Number(time) > (input.duration_ms ?? 30_000) / 1000 + 2) return;
  const files = git("show", "--name-only", "--format=", sha).split("\n").filter(Boolean);
  if (files.length < 2) return;
  const message = git("log", "-1", "--format=%B", sha).trim();
  const { models } = resolveModels();
  const verdicts = await Promise.all(files.slice(0, MAX_FILES).map(async (file) => {
    const diff = git("show", "--format=", sha, "--", file).slice(0, MAX_DIFF);
    const loaded = await loadInput({ text: `Commit message:\n${message}\n\nChange to ${file}:\n${diff}` });
    const out = await judge(models, [{ type: "yes_no", question: "Is this file's change unrelated to what the commit message describes?" }], loaded);
    return { file, ...out.results[0] };
  }));
  const flagged = verdicts.filter(sure);
  if (!flagged.length) return;
  const list = flagged.map((f) => `${f.file} (p=${f.mean_probability})`).join(", ");
  return {
    decision: "block",
    reason: `decision-models: in commit ${sha}, ${list} ${flagged.length === 1 ? "looks" : "look"} unrelated to its message "${message.split("\n")[0]}". Move whatever doesn't belong into its own commit; if it all belongs, carry on.`,
  };
}

// ponytail: judges the first 320 lines, 32 questions per call; a longer output gets a partial triage.
const MIN_LINES = 40;
const MAX_LINES = 320;
const PER_CALL = 32;

async function triageOutput(input: HookInput) {
  const r = input.tool_response;
  const text = typeof r === "string" ? r : [r?.stdout, r?.stderr, r?.content, r?.filenames?.join("\n")].filter(Boolean).join("\n");
  const lines = text.split("\n").filter((l: string) => l.trim());
  if (lines.length < MIN_LINES) return;
  const task = lastPrompt(input.transcript_path);
  if (!task) return;
  const judged: string[] = lines.slice(0, MAX_LINES);
  const loaded = await loadInput({ text: `The user's task:\n${task}\n\nClaude ran ${input.tool_name}: ${JSON.stringify(input.tool_input).slice(0, 500)}` });
  const { models } = resolveModels();
  const chunks = Array.from({ length: Math.ceil(judged.length / PER_CALL) }, (_, i) => judged.slice(i * PER_CALL, (i + 1) * PER_CALL));
  const outs = await Promise.all(chunks.map((chunk) =>
    judge(models, chunk.map((line) => ({ type: "yes_no" as const, question: `Is this output line relevant to the user's task? Line: ${line.slice(0, 300)}` })), loaded)));
  const results = outs.flatMap((o) => o.results);
  const relevant = judged.filter((_, i) => sure(results[i]));
  const count = lines.length > judged.length ? `the first ${judged.length} of ${lines.length}` : `${judged.length}`;
  const shown = relevant.slice(0, 20).map((l) => `  ${l.slice(0, 200)}`).join("\n") + (relevant.length > 20 ? `\n  … ${relevant.length - 20} more` : "");
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `decision-models triaged ${count} output lines against the user's latest prompt: ${relevant.length} look relevant${relevant.length ? `:\n${shown}` : "."}`,
    },
  };
}

async function catchEarlyStop(input: HookInput) {
  // stop_hook_active: Claude is already continuing because of a stop hook; judging again could loop.
  if (input.stop_hook_active || !input.last_assistant_message) return;
  const task = lastPrompt(input.transcript_path);
  const loaded = await loadInput({ text: `User's request:\n${task}\n\nAssistant's final message:\n${String(input.last_assistant_message).slice(-4000)}` });
  const question = "Did the assistant stop partway through the task: it says or implies there are steps it will still do, yet ended its turn without doing them and without asking the user anything?";
  const r = (await judge(resolveModels().models, [{ type: "yes_no", question }], loaded)).results[0];
  if (!sure(r)) return;
  return {
    decision: "block",
    reason: `decision-models: your last message reads as stopping partway through the task (p=${r.mean_probability}). If steps are left, continue with them now. If you're done or need the user, say so plainly.`,
  };
}

async function run(input: HookInput) {
  if (!routes.size) return; // No API key set: nothing to judge with.
  if (input.hook_event_name === "Stop") return option("catchEarlyStops") === "true" ? catchEarlyStop(input) : undefined;
  if (input.tool_name === "Bash" && /\bgit\b.*\bcommit\b/.test(input.tool_input?.command ?? "")) {
    return option("checkCommits") === "true" ? checkCommit(input) : undefined;
  }
  if (option("triageOutput") === "true") return triageOutput(input);
}

try {
  const out = await run(JSON.parse(readFileSync(0, "utf8")));
  if (out) process.stdout.write(JSON.stringify(out));
} catch (e) {
  // Exit 1 is a non-blocking hook error: shown to the user, the tool call or stop goes ahead.
  process.stderr.write(`decision-models hook: ${(e as Error).message}\n`);
  process.exit(1);
}
