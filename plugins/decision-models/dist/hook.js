import{createRequire}from'node:module';const require=createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/providers.ts
var providers_exports = {};
__export(providers_exports, {
  MIME: () => MIME,
  agreement: () => agreement,
  ask: () => ask,
  cheapest: () => cheapest,
  consensus: () => consensus,
  defaultModels: () => defaultModels,
  enabled: () => enabled,
  loadInput: () => loadInput,
  misrouted: () => misrouted,
  providerStatus: () => providerStatus,
  resolveModels: () => resolveModels,
  routes: () => routes
});
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
function allRoutes() {
  const routes3 = /* @__PURE__ */ new Map();
  const add = (provider, format, url, keyVars, models, needs = keyVars.slice(1).join(" or "), envelope = false) => {
    const key = env(...keyVars);
    const status = providerStatus.find((s) => s.provider === provider) ?? (providerStatus.push({ provider, models: [], configured: !!key }), providerStatus.at(-1));
    status.models.push(...Object.keys(models));
    if (!key) return void (status.needs = needs);
    status.key_source = sourceOf(keyVars);
    for (const [model, upstream] of Object.entries(models)) {
      routes3.set(model, [...routes3.get(model) ?? [], { provider, format, url, key, upstream, envelope }]);
    }
  };
  add(
    "typesafe",
    "systemone",
    () => "https://api.typesafe.ai/v1/systemone",
    ["DM_TYPESAFE_API_KEY", "TYPESAFE_API_KEY"],
    { jev: "jev-latest" }
  );
  const account = env("DM_CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID");
  const cloudflareKey = account ? ["DM_CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN"] : [];
  const cloudflareNeeds = "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN";
  add(
    "cloudflare",
    "cloudflare",
    (m) => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${m}`,
    cloudflareKey,
    { clef: "clef", "clef-flash": "clef-flash" },
    cloudflareNeeds
  );
  const cloudflareStatus = providerStatus.find((s) => s.provider === "cloudflare");
  if (account) cloudflareStatus.account = `\u2026${account.slice(-4)}`;
  if (cloudflareGateway) cloudflareStatus.gateway = cloudflareGateway;
  add(
    "openai",
    "openai",
    () => "https://api.openai.com/v1/decisions",
    ["DM_OPENAI_API_KEY", "OPENAI_API_KEY"],
    { "gpt-6-luna": "gpt-6-luna" }
  );
  add(
    "openrouter",
    "systemone",
    () => "https://openrouter.ai/api/alpha/decisions",
    ["DM_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"],
    {
      jev: "~typesafe/jev-latest",
      clef: "cloudflare/clef",
      "clef-flash": "cloudflare/clef-flash",
      "gpt-6-luna": "openai/gpt-6-luna-decisions"
    }
  );
  const vercel = ["DM_VERCEL_API_KEY", "AI_GATEWAY_API_KEY"];
  add("vercel", "systemone", () => "https://ai-gateway.vercel.sh/typesafe/v1/systemone", vercel, { jev: "typesafe-ai/jev" });
  add("vercel", "openai", () => "https://ai-gateway.vercel.sh/v1/decisions", vercel, { "gpt-6-luna": "openai/gpt-6-luna-decisions" });
  const universal = () => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`;
  add("cloudflare", "systemone", universal, cloudflareKey, { jev: "typesafe/jev-1.14.0" }, cloudflareNeeds, true);
  add("cloudflare", "openai", universal, cloudflareKey, { "gpt-6-luna": "openai/decisions" }, cloudflareNeeds, true);
  add(
    "opencode",
    "systemone",
    () => "https://opencode.ai/zen/v1/systemone",
    ["DM_OPENCODE_API_KEY", "OPENCODE_API_KEY"],
    { jev: "jev-1.13" }
  );
  const customUrl = env("DM_CUSTOM_URL");
  if (customUrl) {
    const format = env("DM_CUSTOM_FORMAT") === "openai" ? "openai" : "systemone";
    const models = Object.fromEntries(
      (env("DM_CUSTOM_MODELS") ?? "").split(",").map((pair) => pair.split("=").map((s) => s.trim())).filter(([name, upstream]) => name && upstream)
    );
    add("custom", format, () => customUrl, ["DM_CUSTOM_API_KEY"], models, "the customApiKey option");
  }
  for (const [model, variable] of Object.entries(USE_OPTION)) {
    const pinned = env(variable);
    if (!pinned || NOT_PINNED.includes(pinned)) continue;
    const list = routes3.get(model)?.filter((r) => r.provider === pinned) ?? [];
    if (list.length) {
      routes3.set(model, list);
      continue;
    }
    routes3.delete(model);
    const configured = providerStatus.find((s) => s.provider === pinned)?.configured;
    misrouted[model] = `${model} is set to go through ${pinned} ("Use ${USE_TITLE[model]}" option), which ${configured ? "doesn't serve it" : "has no key set"}.`;
  }
  return routes3;
}
function defaultModels() {
  if (consensus !== "off") return { models: enabled };
  const configured = env("DM_DEFAULT_MODEL");
  if (configured && configured !== "cheapest") return { models: [configured] };
  const fallback = cheapest();
  if (!fallback) return { models: [] };
  return { models: [fallback], note: `Default model is "cheapest": using ${fallback}.` };
}
function resolveModels(spec) {
  const resolved = !spec ? defaultModels() : spec.trim() === "all" ? { models: enabled } : { models: splitModels(spec) };
  if (resolved.models.length === 0) {
    throw new Error(routes.size ? "Every configured model is switched off in the plugin options (Use <model>)." : "No decision model is configured. Set an API key in the plugin options.");
  }
  const unknown = resolved.models.filter((m) => !routes.has(m));
  if (unknown.length) {
    const reasons = unknown.map((m) => misrouted[m]).filter(Boolean).join(" ");
    throw new Error(`Not configured: ${unknown.join(", ")}. ${reasons ? reasons + " " : ""}Available: ${[...routes.keys()].join(", ") || "none"}.`);
  }
  const skipped = spec?.trim() === "all" || !spec && consensus !== "off" ? Object.values(misrouted) : [];
  if (skipped.length) resolved.note = [resolved.note, `Skipped: ${skipped.join(" ")}`].filter(Boolean).join(" ");
  return resolved;
}
async function loadInput(input) {
  const files = {};
  for (const path of input.files ?? []) files[path] = await readFile(resolve(path), "utf8");
  const images = [];
  for (const path of input.images ?? []) {
    const mime = MIME[extname(path).toLowerCase()];
    if (!mime) throw new Error(`Unsupported image type: ${path} (use png, jpg or webp).`);
    images.push({ mime, base64: (await readFile(resolve(path))).toString("base64") });
  }
  if (!input.text && !input.files?.length && !images.length) throw new Error("Give text, files or images to ask about.");
  return { text: input.text, files, images };
}
function stateOf(loaded, extra = {}) {
  if (!Object.keys(loaded.files).length && !Object.keys(extra).length) return loaded.text ?? "See the attached images.";
  return { ...loaded.text ? { text: loaded.text } : {}, ...Object.keys(loaded.files).length ? { files: loaded.files } : {}, ...extra };
}
function systemOneBody(route, questions, loaded) {
  const qs = {};
  questions.forEach((q, i) => {
    if (q.type === "yes_no") qs[`q${i}`] = { type: "noul", instructions: q.question };
    if (q.type === "score") qs[`q${i}`] = { type: "score", instructions: q.question, criteria: q.levels };
    if (q.type === "choice") {
      qs[`q${i}`] = {
        type: "choice",
        instructions: q.question,
        criteria: Object.fromEntries(choiceOptions(q).map((o) => [o.name, o.description ?? null]))
      };
      qs[`q${i}_fits`] = { type: "noul", instructions: fitsQuestion(q) };
    }
  });
  const body = { model: route.upstream, questions: qs };
  const headers = {};
  if (route.format === "cloudflare") {
    body.state = stateOf(loaded);
    if (loaded.images.length) body.images = loaded.images.map((img) => `data:${img.mime};base64,${img.base64}`);
  } else if (loaded.images.length) {
    const assets = {};
    const placeholders = loaded.images.map((img, i) => {
      if (img.mime === "image/webp") throw new Error("Jev accepts png and jpg images only.");
      const id = `image-${i}-${crypto.randomUUID()}`;
      assets[id] = { type: "image", format: img.mime === "image/png" ? "png" : "jpg", data_base64: img.base64 };
      return id;
    });
    body.state = stateOf(loaded, { images: placeholders });
    body.assets = assets;
    headers["TypeSafe-Danger-Zone-Images"] = "true";
  } else {
    body.state = stateOf(loaded);
  }
  return { body, headers };
}
function openAiBody(route, questions, loaded) {
  const qs = [];
  questions.forEach((q, i) => {
    if (q.type === "yes_no") qs.push({ type: "predicate", name: `q${i}`, instructions: q.question });
    if (q.type === "score") qs.push({ type: "score", name: `q${i}`, instructions: q.question, levels: q.levels.map((label) => ({ label })) });
    if (q.type === "choice") {
      qs.push({ type: "choice", name: `q${i}`, instructions: q.question, choices: choiceOptions(q).map((o) => ({ value: o.name, ...o.description ? { description: o.description } : {} })) });
      qs.push({ type: "predicate", name: `q${i}_fits`, instructions: fitsQuestion(q) });
    }
  });
  const state = stateOf(loaded);
  const content = [typeof state === "string" ? { type: "input_text", text: state } : { type: "input_json", data: state }];
  for (const img of loaded.images) content.push({ type: "input_image", image_url: `data:${img.mime};base64,${img.base64}` });
  return { body: { model: route.upstream, input: [{ role: "user", content }], questions: qs }, headers: {} };
}
function parseAnswers(format, json, questions) {
  const byId = {};
  if (format === "openai") {
    for (const a of json.answers ?? []) {
      if (a.type === "refusal") throw new Error(`refused question ${a.name}`);
      byId[a.name] = a;
    }
  } else {
    Object.assign(byId, json.answers ?? {});
  }
  return questions.map((q, i) => {
    const a = byId[`q${i}`];
    if (!a) throw new Error(`no answer for question ${i + 1}`);
    if (q.type === "yes_no") return { type: "yes_no", probability: a.noul ?? a.probability };
    if (q.type === "choice") {
      const probabilities = Array.isArray(a.probabilities) ? Object.fromEntries(a.probabilities.map((p) => [p.value, p.probability])) : a.probabilities;
      const fits = byId[`q${i}_fits`];
      const fit_probability = fits?.noul ?? fits?.probability ?? 1;
      return { type: "choice", choice: a.choice, confidence: a.confidence, probabilities, fit_probability, none_fit: fit_probability < 0.5 || a.choice === OTHER };
    }
    const level = Math.min(q.levels.length - 1, Math.max(0, Math.round(a.score)));
    return { type: "score", score: a.score, level, label: q.levels[level], confidence: a.confidence };
  });
}
async function ask(model, questions, loaded) {
  const route = routes.get(model)[0];
  if (route.provider === "opencode" && loaded.images.length) {
    throw new Error("OpenCode Zen's Jev takes text only. Set Use Jev to typesafe, openrouter or another provider to send images.");
  }
  const { body, headers } = route.format === "openai" ? openAiBody(route, questions, loaded) : systemOneBody(route, questions, loaded);
  if (route.provider === "cloudflare" && cloudflareGateway) headers["cf-aig-gateway-id"] = cloudflareGateway;
  if (route.provider === "openrouter" && (openrouterSort === "latency" || openrouterSort === "price")) {
    body.provider = { sort: openrouterSort };
  }
  const started = performance.now();
  const res = await fetch(route.url(route.upstream), {
    method: "POST",
    headers: { authorization: `Bearer ${route.key}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(route.envelope ? { model: route.upstream, input: { ...body, model: void 0 } } : body),
    signal: AbortSignal.timeout(6e4)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route.provider} HTTP ${res.status}: ${text.slice(0, 500)}`);
  let json = JSON.parse(text);
  if ("success" in json && "result" in json) {
    if (!json.success) throw new Error(`${route.provider}: ${JSON.stringify(json.errors).slice(0, 500)}`);
    json = json.result;
  }
  return {
    model,
    provider: route.provider,
    latency_ms: Math.round(performance.now() - started),
    input_tokens: json.usage?.input_tokens,
    ...actualCost(json),
    ...servingHost(json),
    answers: parseAnswers(route.format, json, questions)
  };
}
var env, sourceOf, cloudflareGateway, openrouterSort, providerStatus, USE_OPTION, USE_TITLE, OFF, NOT_PINNED, misrouted, routes, enabled, CHEAPEST, cheapest, consensus, agreement, splitModels, MIME, parseOption, fitsQuestion, OTHER, choiceOptions, actualCost, servingHost;
var init_providers = __esm({
  "src/providers.ts"() {
    "use strict";
    env = (...names) => names.map((n) => process.env[n]?.trim()).find(Boolean);
    sourceOf = (names) => {
      const name = names.find((n) => process.env[n]?.trim());
      return !name ? void 0 : name.startsWith("DM_") ? "plugin option" : `env ${name}`;
    };
    cloudflareGateway = env("DM_CLOUDFLARE_GATEWAY_ID");
    openrouterSort = env("DM_OPENROUTER_SORT");
    providerStatus = [];
    USE_OPTION = { jev: "DM_USE_JEV", clef: "DM_USE_CLEF", "clef-flash": "DM_USE_CLEF_FLASH", "gpt-6-luna": "DM_USE_GPT_6_LUNA" };
    USE_TITLE = { jev: "Jev", clef: "Clef", "clef-flash": "Clef-flash", "gpt-6-luna": "GPT-6 Luna" };
    OFF = ["off", "false", "0"];
    NOT_PINNED = ["auto", "true", "1", ...OFF];
    misrouted = {};
    routes = allRoutes();
    enabled = [...routes.keys()].filter((m) => !OFF.includes(process.env[USE_OPTION[m]]?.trim() ?? ""));
    CHEAPEST = ["jev", "clef-flash", "gpt-6-luna", "clef"];
    cheapest = () => CHEAPEST.find((m) => enabled.includes(m)) ?? enabled[0];
    consensus = env("DM_CONSENSUS") ?? "off";
    agreement = consensus === "majority" ? "majority" : "unanimous";
    splitModels = (spec) => spec.split(",").map((s) => s.trim()).filter(Boolean);
    MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
    parseOption = (option2) => {
      const i = option2.indexOf(":");
      return i === -1 ? { name: option2.trim() } : { name: option2.slice(0, i).trim(), description: option2.slice(i + 1).trim() };
    };
    fitsQuestion = (q) => `Does the content fit any of these options: ${q.options.join("; ")}? (Question: ${q.question})`;
    OTHER = "other";
    choiceOptions = (q) => {
      const options = q.options.map(parseOption);
      return options.some((o) => o.name === OTHER) ? options : [...options, { name: OTHER, description: "None of the other options fits." }];
    };
    actualCost = (json) => {
      const cost = json.usage?.cost ?? json.provider_metadata?.gateway?.cost;
      return cost !== void 0 && !Number.isNaN(Number(cost)) ? { cost_usd: Number(cost) } : {};
    };
    servingHost = (json) => {
      const host = typeof json.provider === "string" ? json.provider : json.provider_metadata?.gateway?.routing?.finalProvider;
      return host ? { host } : {};
    };
  }
});

// src/stats.ts
import { appendFile, mkdir, readFile as readFile2, rm } from "node:fs/promises";
import { join } from "node:path";
async function record(entry) {
  if (!file) return;
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(file, JSON.stringify({ ...entry, project: process.env.CLAUDE_PROJECT_DIR ?? process.cwd() }) + "\n");
  } catch {
  }
}
var raw, dir, file;
var init_stats = __esm({
  "src/stats.ts"() {
    "use strict";
    raw = process.env.CLAUDE_PLUGIN_DATA;
    dir = raw && !raw.includes("${") ? raw : void 0;
    file = dir ? join(dir, "calls.jsonl") : void 0;
  }
});

// src/consensus.ts
var consensus_exports = {};
__export(consensus_exports, {
  combine: () => combine,
  judge: () => judge,
  mean: () => mean
});
function combine(questions, results, errors, rule) {
  if (results.length === 0) throw new Error(`Every model failed: ${JSON.stringify(errors)}`);
  return {
    agreement_rule: rule,
    partial: Object.keys(errors).length > 0,
    errors,
    usage: results.map(({ model, provider, host, latency_ms, input_tokens }) => ({ model, provider, ...host ? { host } : {}, latency_ms, input_tokens })),
    results: questions.map((q, i) => {
      const per = results.map((r) => ({ model: r.model, provider: r.provider, ...r.host ? { host: r.host } : {}, verdict: verdict(r.answers[i]), ...r.answers[i] }));
      const votes = {};
      for (const p of per) votes[p.verdict] = (votes[p.verdict] ?? 0) + 1;
      const [top, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      const agreed = rule === "unanimous" ? count === per.length : count * 2 > per.length;
      return {
        ...q.name ? { name: q.name } : {},
        type: q.type,
        question: q.question,
        ...q.options ? { options: q.options } : {},
        ...q.levels ? { levels: q.levels } : {},
        agreed,
        answer: agreed ? top : null,
        votes,
        ...q.type === "yes_no" ? { mean_probability: mean(per.map((p) => p.probability)) } : {},
        ...q.type === "score" ? { mean_score: mean(per.map((p) => p.score)) } : {},
        per_model: per
      };
    })
  };
}
async function judge(chosen, questions, loaded, source) {
  const settled = await Promise.allSettled(chosen.map((m) => ask(m, questions, loaded)));
  const results = [];
  const errors = {};
  settled.forEach((s, i) => s.status === "fulfilled" ? results.push(s.value) : errors[chosen[i]] = String(s.reason?.message ?? s.reason));
  const output = combine(questions, results, errors, agreement);
  await record({
    t: (/* @__PURE__ */ new Date()).toISOString(),
    questions: questions.length,
    source,
    models: settled.map((s, i) => s.status === "fulfilled" ? { model: chosen[i], provider: s.value.provider, host: s.value.host, ok: true, latency_ms: s.value.latency_ms, input_tokens: s.value.input_tokens, cost_usd: s.value.cost_usd } : { model: chosen[i], provider: routes.get(chosen[i])[0].provider, ok: false }),
    ...results.length > 1 ? { agreed: output.results.map((r) => r.agreed) } : {}
  });
  return output;
}
var verdict, mean;
var init_consensus = __esm({
  "src/consensus.ts"() {
    "use strict";
    init_providers();
    init_stats();
    verdict = (a) => a.type === "yes_no" ? a.probability >= 0.5 ? "yes" : "no" : a.type === "choice" ? a.none_fit ? "none_fit" : a.choice : a.label;
    mean = (xs) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 1e3) / 1e3;
  }
});

// src/hook.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join as join2 } from "node:path";
var manifest = JSON.parse(readFileSync(join2(process.env.CLAUDE_PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8"));
var option = (key) => process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] ?? manifest.userConfig[key]?.default?.toString();
for (const [name, value] of Object.entries(manifest.mcpServers["decision-models"].env)) {
  const key = value.match(/^\$\{user_config\.(\w+)\}$/)?.[1];
  const v = key && option(key);
  if (v) process.env[name] = v;
}
var { judge: judge2 } = await Promise.resolve().then(() => (init_consensus(), consensus_exports));
var { cheapest: cheapest2, loadInput: loadInput2, resolveModels: resolveModels2, routes: routes2 } = await Promise.resolve().then(() => (init_providers(), providers_exports));
var SURE = 0.8;
var sure = (r) => r.answer === "yes" && r.mean_probability >= SURE;
function lastPrompt(transcript) {
  if (!transcript) return "";
  const lines = readFileSync(transcript, "utf8").trimEnd().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== "user" || entry.isMeta) continue;
      const content = entry.message?.content;
      const text = typeof content === "string" ? content : content?.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      if (text) return text.slice(0, 2e3);
    } catch {
    }
  }
  return "";
}
var MAX_FILES = 30;
var MAX_DIFF = 12e3;
async function checkCommit(input, models) {
  const git = (...args) => execFileSync("git", args, { cwd: input.cwd, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  let sha, time;
  try {
    [sha, time] = git("log", "-1", "--format=%h %ct").trim().split(" ");
  } catch {
    return;
  }
  if (Date.now() / 1e3 - Number(time) > (input.duration_ms ?? 3e4) / 1e3 + 2) return;
  const files = git("show", "--name-only", "--format=", sha).split("\n").filter(Boolean);
  if (files.length < 2) return;
  const message = git("log", "-1", "--format=%B", sha).trim();
  const verdicts = await Promise.all(files.slice(0, MAX_FILES).map(async (file2) => {
    const diff = git("show", "--format=", sha, "--", file2).slice(0, MAX_DIFF);
    const loaded = await loadInput2({ text: `Commit message:
${message}

Change to ${file2}:
${diff}` });
    const out = await judge2(models, [{ type: "yes_no", question: "Is this file's change unrelated to what the commit message describes?" }], loaded, "commit");
    return { file: file2, ...out.results[0] };
  }));
  const flagged = verdicts.filter(sure);
  if (!flagged.length) return;
  const list = flagged.map((f) => `${f.file} (p=${f.mean_probability})`).join(", ");
  return {
    decision: "block",
    reason: `decision-models: in commit ${sha}, ${list} ${flagged.length === 1 ? "looks" : "look"} unrelated to its message "${message.split("\n")[0]}". Move whatever doesn't belong into its own commit; if it all belongs, carry on.`
  };
}
var MIN_LINES = 40;
var MAX_LINES = 320;
var PER_CALL = 32;
async function triageOutput(input, models) {
  const r = input.tool_response;
  const text = typeof r === "string" ? r : [r?.stdout, r?.stderr, r?.content, r?.filenames?.join("\n")].filter(Boolean).join("\n");
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < MIN_LINES) return;
  const task = lastPrompt(input.transcript_path);
  if (!task) return;
  const judged = lines.slice(0, MAX_LINES);
  const loaded = await loadInput2({ text: `The user's task:
${task}

Claude ran ${input.tool_name}: ${JSON.stringify(input.tool_input).slice(0, 500)}` });
  const chunks = Array.from({ length: Math.ceil(judged.length / PER_CALL) }, (_, i) => judged.slice(i * PER_CALL, (i + 1) * PER_CALL));
  const outs = await Promise.all(chunks.map((chunk) => judge2(models, chunk.map((line) => ({ type: "yes_no", question: `Is this output line relevant to the user's task? Line: ${line.slice(0, 300)}` })), loaded, "triage")));
  const results = outs.flatMap((o) => o.results);
  const relevant = judged.filter((_, i) => sure(results[i]));
  const count = lines.length > judged.length ? `the first ${judged.length} of ${lines.length}` : `${judged.length}`;
  const shown = relevant.slice(0, 20).map((l) => `  ${l.slice(0, 200)}`).join("\n") + (relevant.length > 20 ? `
  \u2026 ${relevant.length - 20} more` : "");
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `decision-models triaged ${count} output lines against the user's latest prompt: ${relevant.length} look relevant${relevant.length ? `:
${shown}` : "."}`
    }
  };
}
async function catchEarlyStop(input, models) {
  if (input.stop_hook_active || !input.last_assistant_message) return;
  const task = lastPrompt(input.transcript_path);
  const loaded = await loadInput2({ text: `User's request:
${task}

Assistant's final message:
${String(input.last_assistant_message).slice(-4e3)}` });
  const question = "Did the assistant stop partway through the task: it says or implies there are steps it will still do, yet ended its turn without doing them and without asking the user anything?";
  const r = (await judge2(models, [{ type: "yes_no", question }], loaded, "early-stop")).results[0];
  if (!sure(r)) return;
  return {
    decision: "block",
    reason: `decision-models: your last message reads as stopping partway through the task (p=${r.mean_probability}). If steps are left, continue with them now. If you're done or need the user, say so plainly.`
  };
}
function checkModels(key) {
  const v = option(key);
  if (!v || v === "off" || v === "false") return;
  return resolveModels2(v === "cheapest" || v === "true" ? cheapest2() : v).models;
}
async function run(input) {
  if (!routes2.size) return;
  const [check, key] = input.hook_event_name === "Stop" ? [catchEarlyStop, "catchEarlyStops"] : input.tool_name === "Bash" && /\bgit\b.*\bcommit\b/.test(input.tool_input?.command ?? "") ? [checkCommit, "checkCommits"] : [triageOutput, "triageOutput"];
  const models = checkModels(key);
  if (models) return check(input, models);
}
try {
  const out = await run(JSON.parse(readFileSync(0, "utf8")));
  if (out) process.stdout.write(JSON.stringify(out));
} catch (e) {
  process.stderr.write(`decision-models hook: ${e.message}
`);
  process.exit(1);
}
