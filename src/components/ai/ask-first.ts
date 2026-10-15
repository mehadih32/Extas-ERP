import type { ActionError } from "@/lib/result";

/*
 * An AI task the owner wants to be asked about first (above "Ask before a
 * task above", or big work with no monthly budget) comes back as an error
 * carrying aiAskFirst; the screen shows the estimate and sends the task again
 * with costOk once the person says go on.
 */

export function askFirstOf(error: ActionError | undefined): string | null {
  return error?.fieldErrors?.aiAskFirst?.[0] ? error.message : null;
}

/** The ask-first error as a note under the form, with how to go on. */
export function askFirstProblem(error: ActionError, again: string): ActionError {
  return { code: "CONFLICT", message: `${error.message} Press "${again}" again to go on.` };
}
