import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

export type QuestionType = "yes_no" | "choice" | "score";

export interface Question {
  name?: string;
  type: QuestionType;
  question: string;
  options?: string[];
  levels?: string[];
}

export interface Input {
  text?: string;
  files?: string[];
  images?: string[];
}

export type Answer =
  | { type: "yes_no"; probability: number }
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
      fit_probability: number;
      none_fit: boolean;
    }
  | { type: "score"; score: number; level: number; label: string; confidence: number };

export interface ModelResult {
  model: string;
  provider: string;
  latency_ms: number;
  input_tokens?: number;
  // Reported by gateways that return them (OpenRouter: the actual charge and the host that served it).
  cost_usd?: number;
  host?: string;
  answers: Answer[];
}

type Format = "systemone" | "cloudflare" | "openai";

interface Route {
  provider: string;
  format: Format;
  url: (upstream: string) => string;
  key: string;
  upstream: string;
  // Cloudflare's universal /ai/run wraps the vendor's own body as { model, input: {...} }.
  envelope?: boolean;
}

const env = (...names: string[]) => names.map((n) => process.env[n]?.trim()).find(Boolean);

// DM_* variables are filled from the plugin options by .mcp.json; the rest are the vendors' own env vars.
const sourceOf = (names: string[]) => {
  const name = names.find((n) => process.env[n]?.trim());
  return !name ? undefined : name.startsWith("DM_") ? "plugin option" : `env ${name}`;
};

export interface ProviderStatus { provider: string; models: string[]; configured: boolean; key_source?: string; needs?: string; gateway?: string; account?: string }

// Routing Workers AI through an AI Gateway is just this header on the same endpoint and token.
const cloudflareGateway = env("DM_CLOUDFLARE_GATEWAY_ID");
// OpenRouter picks among several hosts per model; "default" leaves the account's own routing alone.
const openrouterSort = env("DM_OPENROUTER_SORT");
export const providerStatus: ProviderStatus[] = [];

// Direct providers come before gateways so a model reachable both ways uses its own vendor.
function allRoutes(): Map<string, Route[]> {
  const routes = new Map<string, Route[]>();
  const add = (provider: string, format: Format, url: Route["url"], keyVars: string[], models: Record<string, string>, needs = keyVars.slice(1).join(" or "), envelope = false) => {
    const key = env(...keyVars);
    const status = providerStatus.find((s) => s.provider === provider)
      ?? (providerStatus.push({ provider, models: [], configured: !!key }), providerStatus.at(-1)!);
    status.models.push(...Object.keys(models));
    if (!key) return void (status.needs = needs);
    status.key_source = sourceOf(keyVars);
    for (const [model, upstream] of Object.entries(models)) {
      routes.set(model, [...(routes.get(model) ?? []), { provider, format, url, key, upstream, envelope }]);
    }
  };

  add("typesafe", "systemone", () => "https://api.typesafe.ai/v1/systemone",
    ["DM_TYPESAFE_API_KEY", "TYPESAFE_API_KEY"], { jev: "jev-latest" });

  const account = env("DM_CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID");
  const cloudflareKey = account ? ["DM_CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_AUTH_TOKEN"] : [];
  const cloudflareNeeds = "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN";
  add("cloudflare", "cloudflare",
    (m) => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/cloudflare/${m}`,
    cloudflareKey, { clef: "clef", "clef-flash": "clef-flash" }, cloudflareNeeds);
  const cloudflareStatus = providerStatus.find((s) => s.provider === "cloudflare")!;
  if (account) cloudflareStatus.account = `…${account.slice(-4)}`;
  if (cloudflareGateway) cloudflareStatus.gateway = cloudflareGateway;

  add("openai", "openai", () => "https://api.openai.com/v1/decisions",
    ["DM_OPENAI_API_KEY", "OPENAI_API_KEY"], { "gpt-6-luna": "gpt-6-luna" });

  // OpenRouter's Decisions API takes the System One request shape for every decision model it hosts.
  add("openrouter", "systemone", () => "https://openrouter.ai/api/alpha/decisions",
    ["DM_OPENROUTER_API_KEY", "OPENROUTER_API_KEY"], {
      jev: "~typesafe/jev-latest",
      clef: "cloudflare/clef",
      "clef-flash": "cloudflare/clef-flash",
      "gpt-6-luna": "openai/gpt-6-luna-decisions",
    });

  const vercel = ["DM_VERCEL_API_KEY", "AI_GATEWAY_API_KEY"];
  add("vercel", "systemone", () => "https://ai-gateway.vercel.sh/typesafe/v1/systemone", vercel, { jev: "typesafe-ai/jev" });
  add("vercel", "openai", () => "https://ai-gateway.vercel.sh/v1/decisions", vercel, { "gpt-6-luna": "openai/gpt-6-luna-decisions" });

  // Third-party models on Cloudflare: same token, billed from Unified billing credits.
  // typesafe/jev is pinned to 1.13 there and there's no latest alias, so name the newest release.
  const universal = () => `https://api.cloudflare.com/client/v4/accounts/${account}/ai/run`;
  add("cloudflare", "systemone", universal, cloudflareKey, { jev: "typesafe/jev-1.14.0" }, cloudflareNeeds, true);
  add("cloudflare", "openai", universal, cloudflareKey, { "gpt-6-luna": "openai/decisions" }, cloudflareNeeds, true);

  // OpenCode Zen has only Jev 1.13 (no latest alias), text only; last of the gateways since it's the oldest Jev.
  add("opencode", "systemone", () => "https://opencode.ai/zen/v1/systemone",
    ["DM_OPENCODE_API_KEY", "OPENCODE_API_KEY"], { jev: "jev-1.13" });

  const customUrl = env("DM_CUSTOM_URL");
  if (customUrl) {
    const format: Format = env("DM_CUSTOM_FORMAT") === "openai" ? "openai" : "systemone";
    const models = Object.fromEntries(
      (env("DM_CUSTOM_MODELS") ?? "").split(",").map((pair) => pair.split("=").map((s) => s.trim()))
        .filter(([name, upstream]) => name && upstream),
    );
    add("custom", format, () => customUrl, ["DM_CUSTOM_API_KEY"], models, "the customApiKey option");
  }

  // A model pinned to a provider only ever goes there: a missing key is an error, never a silent detour elsewhere.
  for (const [model, variable] of Object.entries(USE_OPTION)) {
    const pinned = env(variable);
    if (!pinned || NOT_PINNED.includes(pinned)) continue;
    const list = routes.get(model)?.filter((r) => r.provider === pinned) ?? [];
    if (list.length) {
      routes.set(model, list);
      continue;
    }
    routes.delete(model);
    const configured = providerStatus.find((s) => s.provider === pinned)?.configured;
    misrouted[model] = `${model} is set to go through ${pinned} ("Use ${USE_TITLE[model]}" option), which ${configured ? "doesn't serve it" : "has no key set"}.`;
  }
  return routes;
}

// "Use <model>" is auto, off, or a provider to pin the model to. off only leaves it out of "ask all"
// (consensus, /opinion-all, cheapest); naming it explicitly still works, routed as auto.
// true/false are what 0.1.0's checkboxes saved. Custom-gateway model names have no option.
const USE_OPTION: Record<string, string> = { jev: "DM_USE_JEV", clef: "DM_USE_CLEF", "clef-flash": "DM_USE_CLEF_FLASH", "gpt-6-luna": "DM_USE_GPT_6_LUNA" };
const USE_TITLE: Record<string, string> = { jev: "Jev", clef: "Clef", "clef-flash": "Clef-flash", "gpt-6-luna": "GPT-6 Luna" };
const OFF = ["off", "false", "0"];
const NOT_PINNED = ["auto", "true", "1", ...OFF];
export const misrouted: Record<string, string> = {};
export const routes = allRoutes();
export const enabled = [...routes.keys()].filter((m) => !OFF.includes(process.env[USE_OPTION[m]]?.trim() ?? ""));

// Cheapest first, by input price at the time of writing.
const CHEAPEST = ["jev", "clef-flash", "gpt-6-luna", "clef"];

export type Agreement = "unanimous" | "majority";

// "off" only decides which models a default call asks; any multi-model call still needs an agreement rule.
export const consensus = env("DM_CONSENSUS") ?? "off";
export const agreement: Agreement = consensus === "majority" ? "majority" : "unanimous";

export function defaultModels(): { models: string[]; note?: string } {
  if (consensus !== "off") return { models: enabled };
  const configured = env("DM_DEFAULT_MODEL");
  if (configured && configured !== "cheapest") return { models: [configured] };
  const fallback = CHEAPEST.find((m) => enabled.includes(m)) ?? enabled[0];
  if (!fallback) return { models: [] };
  return { models: [fallback], note: `Default model is "cheapest": using ${fallback}.` };
}

const splitModels = (spec: string) => spec.split(",").map((s) => s.trim()).filter(Boolean);

export function resolveModels(spec?: string): { models: string[]; note?: string } {
  const resolved: { models: string[]; note?: string } = !spec ? defaultModels() : spec.trim() === "all" ? { models: enabled } : { models: splitModels(spec) };
  if (resolved.models.length === 0) {
    throw new Error(routes.size ? "Every configured model is switched off in the plugin options (Use <model>)." : "No decision model is configured. Set an API key in the plugin options.");
  }
  const unknown = resolved.models.filter((m) => !routes.has(m));
  if (unknown.length) {
    const reasons = unknown.map((m) => misrouted[m]).filter(Boolean).join(" ");
    throw new Error(`Not configured: ${unknown.join(", ")}. ${reasons ? reasons + " " : ""}Available: ${[...routes.keys()].join(", ") || "none"}.`);
  }
  // Asking all (or a consensus) would otherwise drop a misrouted model without a word.
  const skipped = spec?.trim() === "all" || (!spec && consensus !== "off") ? Object.values(misrouted) : [];
  if (skipped.length) resolved.note = [resolved.note, `Skipped: ${skipped.join(" ")}`].filter(Boolean).join(" ");
  return resolved;
}

interface Image { mime: string; base64: string }
interface Loaded { text?: string; files: Record<string, string>; images: Image[] }

export const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export async function loadInput(input: Input): Promise<Loaded> {
  const files: Record<string, string> = {};
  for (const path of input.files ?? []) files[path] = await readFile(resolve(path), "utf8");
  const images: Image[] = [];
  for (const path of input.images ?? []) {
    const mime = MIME[extname(path).toLowerCase()];
    if (!mime) throw new Error(`Unsupported image type: ${path} (use png, jpg or webp).`);
    images.push({ mime, base64: (await readFile(resolve(path))).toString("base64") });
  }
  if (!input.text && !input.files?.length && !images.length) throw new Error("Give text, files or images to ask about.");
  return { text: input.text, files, images };
}

const parseOption = (option: string) => {
  const i = option.indexOf(":");
  return i === -1 ? { name: option.trim() } : { name: option.slice(0, i).trim(), description: option.slice(i + 1).trim() };
};

const fitsQuestion = (q: Question) =>
  `Does the content fit any of these options: ${q.options!.join("; ")}? (Question: ${q.question})`;

// Both guards against forced picks: an explicit "other" to absorb probability, plus the companion
// fits question (which must not list "other", or it would always answer yes).
const OTHER = "other";
const choiceOptions = (q: Question) => {
  const options = q.options!.map(parseOption);
  return options.some((o) => o.name === OTHER) ? options : [...options, { name: OTHER, description: "None of the other options fits." }];
};

function stateOf(loaded: Loaded, extra: Record<string, unknown> = {}) {
  if (!Object.keys(loaded.files).length && !Object.keys(extra).length) return loaded.text ?? "See the attached images.";
  return { ...(loaded.text ? { text: loaded.text } : {}), ...(Object.keys(loaded.files).length ? { files: loaded.files } : {}), ...extra };
}

// A choice always picks an option even when none fits, so every choice gets a companion
// yes/no "does anything fit?" question (TypeSafe's recommended guard against false positives).
function systemOneBody(route: Route, questions: Question[], loaded: Loaded) {
  const qs: Record<string, unknown> = {};
  questions.forEach((q, i) => {
    if (q.type === "yes_no") qs[`q${i}`] = { type: "noul", instructions: q.question };
    if (q.type === "score") qs[`q${i}`] = { type: "score", instructions: q.question, criteria: q.levels };
    if (q.type === "choice") {
      qs[`q${i}`] = {
        type: "choice",
        instructions: q.question,
        criteria: Object.fromEntries(choiceOptions(q).map((o) => [o.name, o.description ?? null])),
      };
      qs[`q${i}_fits`] = { type: "noul", instructions: fitsQuestion(q) };
    }
  });

  const body: Record<string, unknown> = { model: route.upstream, questions: qs };
  const headers: Record<string, string> = {};
  if (route.format === "cloudflare") {
    body.state = stateOf(loaded);
    if (loaded.images.length) body.images = loaded.images.map((img) => `data:${img.mime};base64,${img.base64}`);
  } else if (loaded.images.length) {
    const assets: Record<string, unknown> = {};
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

function openAiBody(route: Route, questions: Question[], loaded: Loaded) {
  const qs: unknown[] = [];
  questions.forEach((q, i) => {
    if (q.type === "yes_no") qs.push({ type: "predicate", name: `q${i}`, instructions: q.question });
    if (q.type === "score") qs.push({ type: "score", name: `q${i}`, instructions: q.question, levels: q.levels!.map((label) => ({ label })) });
    if (q.type === "choice") {
      qs.push({ type: "choice", name: `q${i}`, instructions: q.question, choices: choiceOptions(q).map((o) => ({ value: o.name, ...(o.description ? { description: o.description } : {}) })) });
      qs.push({ type: "predicate", name: `q${i}_fits`, instructions: fitsQuestion(q) });
    }
  });
  const state = stateOf(loaded);
  const content: unknown[] = [typeof state === "string" ? { type: "input_text", text: state } : { type: "input_json", data: state }];
  for (const img of loaded.images) content.push({ type: "input_image", image_url: `data:${img.mime};base64,${img.base64}` });
  return { body: { model: route.upstream, input: [{ role: "user", content }], questions: qs }, headers: {} as Record<string, string> };
}

type Raw = Record<string, any>;

function parseAnswers(format: Format, json: Raw, questions: Question[]): Answer[] {
  const byId: Record<string, Raw> = {};
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
      const probabilities: Record<string, number> = Array.isArray(a.probabilities)
        ? Object.fromEntries(a.probabilities.map((p: Raw) => [p.value, p.probability]))
        : a.probabilities;
      const fits = byId[`q${i}_fits`];
      const fit_probability = fits?.noul ?? fits?.probability ?? 1;
      return { type: "choice", choice: a.choice, confidence: a.confidence, probabilities, fit_probability, none_fit: fit_probability < 0.5 || a.choice === OTHER };
    }
    const level = Math.min(q.levels!.length - 1, Math.max(0, Math.round(a.score)));
    return { type: "score", score: a.score, level, label: q.levels![level], confidence: a.confidence };
  });
}

// Gateways that bill per request report the charge: OpenRouter as usage.cost (number),
// Vercel as provider_metadata.gateway.cost (string). Direct vendors and Cloudflare report tokens only.
const actualCost = (json: Raw) => {
  const cost = json.usage?.cost ?? json.provider_metadata?.gateway?.cost;
  return cost !== undefined && !Number.isNaN(Number(cost)) ? { cost_usd: Number(cost) } : {};
};
const servingHost = (json: Raw) => {
  const host = typeof json.provider === "string" ? json.provider : json.provider_metadata?.gateway?.routing?.finalProvider;
  return host ? { host } : {};
};

export async function ask(model: string, questions: Question[], loaded: Loaded): Promise<ModelResult> {
  const route = routes.get(model)![0];
  if (route.provider === "opencode" && loaded.images.length) {
    throw new Error("OpenCode Zen's Jev takes text only. Set Use Jev to typesafe, openrouter or another provider to send images.");
  }
  const { body, headers } = route.format === "openai" ? openAiBody(route, questions, loaded) : systemOneBody(route, questions, loaded);
  if (route.provider === "cloudflare" && cloudflareGateway) headers["cf-aig-gateway-id"] = cloudflareGateway;
  if (route.provider === "openrouter" && (openrouterSort === "latency" || openrouterSort === "price")) {
    (body as Record<string, unknown>).provider = { sort: openrouterSort };
  }
  const started = performance.now();
  const res = await fetch(route.url(route.upstream), {
    method: "POST",
    headers: { authorization: `Bearer ${route.key}`, "content-type": "application/json", ...headers },
    body: JSON.stringify(route.envelope ? { model: route.upstream, input: { ...body, model: undefined } } : body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route.provider} HTTP ${res.status}: ${text.slice(0, 500)}`);
  let json: Raw = JSON.parse(text);
  // Cloudflare's REST API wraps the model output in { success, result, errors }.
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
    answers: parseAnswers(route.format, json, questions),
  };
}
