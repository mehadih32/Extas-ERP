/** What the app frame needs about the signed-in person (built in app/(app)/layout.tsx). */
export type ShellUser = {
  name: string;
  email: string;
  initials: string;
  /** Their role in the active company, e.g. "Accounts". */
  roleName: string;
};

export type ShellCompany = { id: string; name: string; roleName: string | null };
