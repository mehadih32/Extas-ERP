/*
 * The stock history's page size, shared by the style page (a Server Component,
 * which loads the first page) and the history list (a Client Component, which
 * loads the rest). It lives outside stock-history.tsx because a Server Component
 * only gets the components of a "use client" file, not its other exports.
 */

/** Movements shown at first and per "Show older movements". */
export const HISTORY_PAGE_SIZE = 20;
