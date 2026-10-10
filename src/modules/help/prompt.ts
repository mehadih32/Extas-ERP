/*
 * When the Help Center finds no guide for what someone searched, the feature is
 * probably not in the app yet. The page says so in Bengali and offers this
 * prompt, in English, for the admin to give to Claude to build it.
 */

export const PROMPT_HEADING = "Admin: Copy this prompt to Claude to build this feature.";

/** The search as typed, tidied for quoting: one line, at most 200 characters. */
export function quotedSearch(query: string): string {
  const line = query.replace(/\s+/g, " ").trim();
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

export function missingFeaturePrompt({
  query,
  roleName,
  companyName,
  day,
}: {
  query: string;
  /** The searcher's role, e.g. "Sales Executive". */
  roleName: string;
  companyName: string;
  /** The day of the search, "2026-10-10". */
  day: string;
}): string {
  const wanted = quotedSearch(query);
  return [
    PROMPT_HEADING,
    "",
    `Please add this feature to Extas ERP: "${wanted}".`,
    "",
    `Why: on ${day} someone in the ${roleName} role at ${companyName} searched the in-app Help Center for "${wanted}" and found no guide, so the feature seems to be missing.`,
    "",
    "What to do:",
    "1. First check whether Extas ERP already has this under another name. If it does, add or improve its Bengali Help Center guide so people can find it, and stop there.",
    "2. If it doesn't, tell me how you would build it and ask me anything unclear before starting. Build it as its own pull request.",
    "3. Do not break, overwrite or corrupt any existing data, relationships or features. Keep database changes additive, and keep role permissions (RBAC) strict on the server and in the screens.",
    "4. Make it work on phones (bottom tab bar) and computers, in both the Legacy and the Modern look.",
    "5. Update the Bengali Help Center guides (src/modules/help/content) for the new feature in the same pull request.",
  ].join("\n");
}
