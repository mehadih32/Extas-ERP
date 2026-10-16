import { AI_MODELS, modelInfo } from "./models";

/*
 * The AI providers the ERP can use (v6.3): Claude (Anthropic), OpenAI and
 * Gemini (Google). A model is named by one string everywhere (a task's or an
 * agent's model, a cost line, a price, a test): the ERP's own Claude models
 * by their id ("claude-sonnet-5-5"), any other model as "provider:id"
 * ("openai:gpt-5", "google:gemini-2.5-pro", "anthropic:claude-…"). Plain data
 * and functions, used by the screens too.
 */

export const PROVIDERS = [
  {
    id: "anthropic",
    label: "Claude",
    company: "Anthropic",
    keyStarts: "sk-ant-",
    keyPage: "console.anthropic.com > API Keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    company: "OpenAI",
    keyStarts: "sk-",
    keyPage: "platform.openai.com > API keys",
  },
  {
    id: "google",
    label: "Gemini",
    company: "Google",
    keyStarts: "AIza",
    keyPage: "aistudio.google.com > Get API key",
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id) as unknown as readonly [
  ProviderId,
  ...ProviderId[],
];

export const isProvider = (value: string): value is ProviderId =>
  (PROVIDER_IDS as readonly string[]).includes(value);

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;

export type ModelRef = { provider: ProviderId; id: string };

/** A model id as providers write them: letters, digits and . _ - / : @ only. */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._\-/:@]{0,119}$/;

/** "openai:gpt-5" → { openai, gpt-5 }; a bare "claude-…" is Claude's; null when it is not a model name. */
export function parseModel(ref: string): ModelRef | null {
  const at = ref.indexOf(":");
  if (at > 0) {
    const provider = ref.slice(0, at);
    const id = ref.slice(at + 1);
    if (!isProvider(provider) || !MODEL_ID.test(id)) return null;
    return { provider, id };
  }
  return ref.startsWith("claude-") && MODEL_ID.test(ref)
    ? { provider: "anthropic", id: ref }
    : null;
}

/** The one name of a model: the ERP's own Claude models bare, the rest with their provider. */
export function modelRef(provider: ProviderId, id: string): string {
  if (provider === "anthropic" && id.startsWith("claude-")) return id;
  return `${provider}:${id}`;
}

/** The provider of a model name (Claude for anything unknown, as before v6.3). */
export const providerOf = (ref: string): ProviderId => parseModel(ref)?.provider ?? "anthropic";

/** One of the ERP's own Claude models, tested with the ERP's work: no test before Do. */
export const isBuiltIn = (ref: string) => modelInfo(ref) !== null;

export const BUILT_IN_MODELS: readonly string[] = AI_MODELS.map((m) => m.id);

export type ReadModel = { id: string; label: string };

/** What the screens call a model: "Sonnet 5.5", "gpt-5 (OpenAI)", "Gemini 2.5 Pro (Gemini)". */
export function modelLabel(ref: string, known?: ReadonlyArray<ReadModel>): string {
  const own = modelInfo(ref);
  if (own) return own.label;
  const parsed = parseModel(ref);
  if (!parsed) return ref;
  const read = known?.find((m) => m.id === parsed.id)?.label;
  const name = read && read !== parsed.id ? read : parsed.id;
  return `${name} (${providerInfo(parsed.provider).label})`;
}
