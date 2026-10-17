import { AppError } from "@/lib/errors";
import type { RequestMeta } from "@/lib/request-meta";
import type { BotOut, ButtonPress } from "@/modules/ai/bot/render";
import type { PinProof } from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";

import { guardUrl, renderCorrection } from "./bot-texts";
import {
  applyCorrection,
  cancelCorrection,
  fixFinding,
  ignoreFinding,
  SNOOZE_DAYS,
  snoozeFinding,
  undoCorrection,
} from "./fixes.service";
import { startBugGuard } from "./runner";
import { assertPlatform } from "./settings.service";

/*
 * Bug Guard's buttons on the bot (Fix, Ignore, Remind me later, Run now, and
 * Apply, Cancel or Undo on a correction), and "bug guard" typed to it. The bot
 * has asked for the PIN already where it is needed (incoming.ts pinNeeded);
 * each step is the same as on the screen, in the owner's name.
 */

type GuardPress = Extract<ButtonPress, { kind: "guard" | "guard-run" | "guard-correction" }>;

const words = (text: string): BotOut => ({ text, buttons: [] });

export async function guardPress(
  ctx: CompanyContext,
  press: GuardPress,
  meta: RequestMeta,
  pin: PinProof,
  appUrl: string,
): Promise<BotOut> {
  try {
    assertPlatform(ctx);
    switch (press.kind) {
      case "guard-run":
        await startBugGuard(ctx.company.id, "TELEGRAM", ctx.user.id);
        return words("Bug Guard চেক শুরু করেছে। শেষ হলে রিপোর্ট এখানেই আসবে।");
      case "guard":
        switch (press.choice) {
          case "ignore":
            await ignoreFinding(ctx, press.findingId, meta);
            return words("Ignore করা হলো: এটা আর জানানো হবে না, যদি না আরও খারাপ হয়।");
          case "later":
            await snoozeFinding(ctx, press.findingId, meta);
            return words(`${SNOOZE_DAYS} দিন পর আবার মনে করিয়ে দেব, যদি তখনও থাকে।`);
          case "fix": {
            const done = await fixFinding(ctx, press.findingId, {}, meta, pin);
            switch (done.kind) {
              case "CODE":
                return words(
                  `Claude Code-কে পাঠানো হলো (issue #${done.issueNumber})। সে টেস্টসহ একটা Pull Request বানাবে; তৈরি হলে জানাব, তখন “AI Center > Full check” এ PIN দিয়ে merge করবেন। তারপর Bug Guard আবার দেখবে।`,
                );
              case "DATA":
                return renderCorrection(
                  {
                    id: done.correctionId,
                    summary: done.summary,
                    status: "PREPARED",
                    title: "ঠিক করার প্রস্তাব",
                  },
                  appUrl,
                );
              case "SECURITY":
                return words(`করা হয়েছে: ${done.done}`);
              case "MANUAL":
                return words(
                  `এটা আপনাকেই করতে হবে:\n${done.steps}${done.href ? `\n${done.href.startsWith("http") ? done.href : `${appUrl}${done.href}`}` : ""}`,
                );
            }
          }
        }
        break;
      case "guard-correction":
        switch (press.choice) {
          case "apply":
            await applyCorrection(ctx, press.correctionId, {}, meta, pin);
            return words(
              "আগে একটা পুরো ব্যাকআপ হচ্ছে; শেষ হলেই সংশোধনটা হবে এবং আপনাকে জানাব (Undo বোতামসহ)। ব্যাকআপ না হলে কিছুই বদলাবে না।",
            );
          case "cancel":
            await cancelCorrection(ctx, press.correctionId, meta);
            return words("বাতিল করা হলো: কিছুই বদলায়নি।");
          case "undo":
            await undoCorrection(ctx, press.correctionId, {}, meta, pin);
            return words("Undo করা হলো: আগের অবস্থা ফিরে এসেছে।");
        }
    }
    return words(guardUrl(appUrl));
  } catch (error) {
    if (error instanceof AppError) return words(`হয়নি: ${error.message}`);
    throw error;
  }
}
