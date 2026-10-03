/** The screens' addresses, shared by the server and the browser. */
export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  changePassword: "/change-password",
  selectCompany: "/select-company",
} as const;

/** Screens a person is never sent back to after signing in (they would loop). */
const NOT_A_DESTINATION = new Set<string>([ROUTES.signIn, ROUTES.selectCompany]);

/**
 * Where to go after signing in: only a path inside this app ("/sales?tab=open"),
 * never another site, so a crafted link cannot bounce people elsewhere.
 * Returns null when the value is missing or not safe.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  // One leading slash, no "//host" or "/\host" tricks, no control characters.
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if ([...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return null;
  let url: URL;
  try {
    url = new URL(value, "http://extras.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://extras.invalid" || NOT_A_DESTINATION.has(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The sign-in screen, bringing the person back to `next` afterwards when that is
 * a page worth returning to (not the dashboard, which is where sign-in goes anyway).
 */
export function signInPath(next?: string | null): string {
  const back = safeNextPath(next);
  return back && back !== ROUTES.home
    ? `${ROUTES.signIn}?next=${encodeURIComponent(back)}`
    : ROUTES.signIn;
}

/**
 * Request header the proxy fills with the page that was asked for ("/sales?tab=open"),
 * so a screen that finds the session gone can send the person to sign in and back.
 */
export const REQUESTED_PATH_HEADER = "x-extras-path";
