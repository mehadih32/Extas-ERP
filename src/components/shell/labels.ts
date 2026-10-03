/** "Mehadi Hasan" → "MH"; a one-word name gives its first letter. */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0];
  const last = words.length > 1 ? words.at(-1)?.[0] : undefined;
  return (first ? `${first}${last ?? ""}` : (email[0] ?? "?")).toUpperCase();
}

/** The person's role in the active company, as the screens show it. */
export function roleLabel(role: { name: string } | null, isPlatformOwner: boolean): string {
  return role?.name ?? (isPlatformOwner ? "Platform owner" : "Member");
}
