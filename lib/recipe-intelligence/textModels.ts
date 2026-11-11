// Client-safe model registry. Standard, direct Responses API prices per million
// tokens, verified against each model's official page on 2026-11-10.
export const WRITING_MODELS = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", input: .75, cachedInput: .075, output: 4.5, longContextThreshold: null },
  { id: "gpt-5.5", label: "GPT-5.5", input: 5, cachedInput: .5, output: 30, longContextThreshold: 272000 },
] as const;
export type WritingModel = typeof WRITING_MODELS[number]["id"];
export function writingModelProfile(model: string) {
  return WRITING_MODELS.find(profile => profile.id === model);
}
