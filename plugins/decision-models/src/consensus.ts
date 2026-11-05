import type { Agreement, Answer, ModelResult, Question } from "./providers.ts";

const verdict = (a: Answer) =>
  a.type === "yes_no" ? (a.probability >= 0.5 ? "yes" : "no")
  : a.type === "choice" ? (a.none_fit ? "none_fit" : a.choice)
  : a.label;

export const mean = (xs: number[]) => Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000;

// Agreement is judged over the models that answered; failed models are left out (and reported as partial).
// unanimous: every answer matches. majority: one verdict has more than half the answers.
export function combine(questions: Question[], results: ModelResult[], errors: Record<string, string>, rule: Agreement) {
  if (results.length === 0) throw new Error(`Every model failed: ${JSON.stringify(errors)}`);

  return {
    agreement_rule: rule,
    partial: Object.keys(errors).length > 0,
    errors,
    usage: results.map(({ model, provider, host, latency_ms, input_tokens }) => ({ model, provider, ...(host ? { host } : {}), latency_ms, input_tokens })),
    results: questions.map((q, i) => {
      const per = results.map((r) => ({ model: r.model, provider: r.provider, ...(r.host ? { host: r.host } : {}), verdict: verdict(r.answers[i]), ...r.answers[i] }));
      const votes: Record<string, number> = {};
      for (const p of per) votes[p.verdict] = (votes[p.verdict] ?? 0) + 1;
      const [top, count] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      const agreed = rule === "unanimous" ? count === per.length : count * 2 > per.length;
      return {
        ...(q.name ? { name: q.name } : {}),
        type: q.type,
        question: q.question,
        ...(q.options ? { options: q.options } : {}),
        ...(q.levels ? { levels: q.levels } : {}),
        agreed,
        answer: agreed ? top : null,
        votes,
        ...(q.type === "yes_no" ? { mean_probability: mean(per.map((p) => (p as { probability: number }).probability)) } : {}),
        ...(q.type === "score" ? { mean_score: mean(per.map((p) => (p as { score: number }).score)) } : {}),
        per_model: per,
      };
    }),
  };
}
