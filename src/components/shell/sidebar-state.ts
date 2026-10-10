/*
 * The modern look's side menu remembers, per device, whether the person
 * narrowed it to icons or widened it. Until they choose, it is narrow on
 * tablets and wide on computers ("auto").
 */

export const SIDEBAR_COOKIE = "extas_sidebar";

export type SidebarMode = "auto" | "collapsed" | "expanded";

/** The saved choice from the cookie's value; anything else is "auto". */
export function sidebarModeFrom(value: string | undefined): SidebarMode {
  return value === "collapsed" || value === "expanded" ? value : "auto";
}
