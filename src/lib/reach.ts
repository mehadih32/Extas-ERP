import type { ActionError } from "@/lib/result";

/*
 * A Server Action called from the browser throws when the request never gets an
 * answer: the phone lost its connection, or the request was stopped on the way
 * (the Full check stops every write on the live site). Inside a transition that
 * throw takes the whole screen down ("This screen could not open"), so anything
 * that asks the server on its own, a search box or a list that loads as the
 * screen opens, asks through these and shows a calm line instead.
 */

export const NOT_REACHED = "The ERP did not answer. Check the connection and try again.";

/** True for Next.js' own redirects and "not found", which must go on. */
function controlFlow(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

/** What a request that got no answer comes back as. */
export type NotReached = { ok: false; error: ActionError };

/** Calls a Server Action; a request that got no answer comes back as a failed result. */
export async function reach<R>(call: () => Promise<R>): Promise<R | NotReached> {
  try {
    return await call();
  } catch (error) {
    if (controlFlow(error)) throw error;
    return { ok: false, error: { code: "INTERNAL", message: NOT_REACHED } };
  }
}

/** The same for a search that answers with its matches or a message. */
export async function reachSearch<T>(call: () => Promise<T[] | string>): Promise<T[] | string> {
  try {
    return await call();
  } catch (error) {
    if (controlFlow(error)) throw error;
    return NOT_REACHED;
  }
}
