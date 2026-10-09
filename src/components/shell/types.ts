/** What the app frame needs about the signed-in person (built in app/(app)/layout.tsx). */
export type ShellUser = {
  name: string;
  email: string;
  initials: string;
  /** Their role in the active company, e.g. "Accounts". */
  roleName: string;
  /** Their own HR records ("My HR") go in the account menu: they hold portal.self, and HR & payroll takes the menu's place. */
  myHr: boolean;
};

export type ShellCompany = { id: string; name: string; roleName: string | null };
