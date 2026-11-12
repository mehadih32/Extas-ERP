import type Anthropic from "@anthropic-ai/sdk";

import { AppError } from "@/lib/errors";

import { askClaude, textOf } from "./claude";
import { providerOf } from "./providers";
import { aiSettingsOf, keyFor, modelForWork } from "./settings.service";

/*
 * A voice note as text (Release 5), for the bot: the words then go on
 * exactly like typed words. It goes through the one door to the AI
 * (askClaude), so the switch, the pause, the budget and the cost line ("Voice
 * notes to text", from the bot) all apply. Hearing sound needs a model that
 * takes audio: a Gemini model picked for "Voice notes to text" on AI Center >
 * Models (the ERP's own Claude models read words, photos and PDFs, not sound).
 * Until one is picked, nothing is called and the bot says what to do.
 */

/** Voice notes longer than this are not sent to the AI (Telegram's are a few hundred KB a minute). */
export const MAX_VOICE_BYTES = 8 * 1024 * 1024;

export const VOICE_NEEDS_MODEL =
  "Voice notes need a model that can hear sound. In AI Center > Models, pick a Gemini model for “Voice notes to text” (and add the Gemini key in AI Center > Settings). Until then, type what you need.";

const SYSTEM =
  "You write down exactly what a voice note says, in the language it is spoken in (Bengali in Bengali script, English in English). Write only the words, with no notes of your own. Write numbers in Western digits. If nothing can be heard, write nothing.";

export async function transcribeVoice(
  companyId: string,
  userId: string,
  audio: { bytes: Buffer; mime: string },
): Promise<string> {
  if (audio.bytes.length > MAX_VOICE_BYTES) {
    throw new AppError(
      "VALIDATION",
      "That voice note is too long. Send a shorter one (a minute or two).",
    );
  }
  const settings = await aiSettingsOf(companyId);
  const model = modelForWork(settings, "voice.text");
  if (providerOf(model) !== "google" || !keyFor(settings, "google")) {
    throw new AppError("UNAVAILABLE", VOICE_NEEDS_MODEL);
  }
  const { message } = await askClaude(companyId, {
    task: "voice.text",
    why: "A voice note on the bot",
    userId,
    screen: "bot",
    maxTokens: 2000,
    timeoutMs: 60_000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: audio.mime,
              data: audio.bytes.toString("base64"),
            },
          } as unknown as Anthropic.DocumentBlockParam,
          { type: "text", text: "Write down what this voice note says." },
        ],
      },
    ],
  });
  return textOf(message).trim();
}
