/*
 * Buttons, tabs and menu items whose words the Help reader
 * (scripts/help/screens.ts) cannot follow to the text in the code, each with
 * the reason it cannot, reviewed by hand (v6.4 L6). The key is the file and the
 * code that shows the words. tests/unit/help-guides.test.ts fails for a new one
 * that is not here, and for one here that is gone or now read, so this list
 * only ever holds buttons someone has looked at.
 */
export const UNREAD_LABELS: Readonly<Record<string, string>> = {
  "src/app/(app)/ai/control/page.tsx: <ControlPanel control={result.data}>":
    "The preset buttons and the cells of the tree come from the server (PRESETS and the Control tree in src/modules/ai/control.service.ts). The AI Control guide names each preset and explains the cells.",
  "src/app/(app)/ai/health/page.tsx: <HealthScreen health={result.data}>":
    "The safe-fix buttons are saved with each health check run on the server. The Server Health guide names every safe fix under “Safe fixes”.",
  "src/app/(app)/products/setup/page.tsx: <SetupScreen setup={result.data}>":
    "Each category and brand row is a button showing its own name (the company's data); pressing it renames it. The Setup guide explains renaming.",
  "src/app/(app)/reports/templates/[templateId]/page.tsx: <TagPlacement template={t}>":
    "The placed tags are the ones found in the uploaded template file (data), one button each. The template guide explains placing tags.",
  "src/app/(app)/sales/orders/[orderId]/edit/page.tsx: <OrderForm form={result.data}>":
    "The quick buttons beside “Magic Ratio” show the names of the size-ratio presets saved in the product setup (data). The order guide explains Magic Ratio.",
  "src/app/(app)/sales/orders/new/page.tsx: <OrderForm form={result.data}>":
    "The quick buttons beside “Magic Ratio” show the names of the size-ratio presets saved in the product setup (data). The order guide explains Magic Ratio.",
  "src/components/sales/order-style-card.tsx: <ColorName name={row.color.name} hexCode={row.color.hexCode} />":
    "The colour chips show the colours of the style (data); pressing one shows or hides that colour's row.",
  "src/components/sales/pickers.tsx: {renderOption(option)}":
    "A picker lists records (buyers, styles, products) that each screen draws through renderOption; the words are the records' own names.",
  "src/components/shell/bottom-nav.tsx: <UserMenu sections={more}>":
    "On a phone the More menu lists the menu sections that do not fit the bottom bar (the NAV_ITEMS labels, worked out by phoneTabs). Each section has its own help section.",
};
