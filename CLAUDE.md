# Extas ERP: rules for every session

Read this file before you change anything. It holds the owner's standing rules and decisions, so that every
Claude Code session and the Claude GitHub Action (`.github/workflows/claude.yml`) work the same way. When the
owner makes a new decision, add it here (section 9) in the same PR.

The owner is Mehadi Hasan (GitHub `mehadih32`). The owner is not technical and reads plain English and Bengali,
never code. The ERP runs at https://erp.extasbd.com (live) and https://demo.extasbd.com (demo, practice data). The
design source is the owner's blueprint doc (Claude Doc "টেক প্যাক মডিউল আর AI Center", tab "ডেভেলপ হ্যান্ডঅফ"). When two
places disagree, the newer instruction wins.

## 1. How to work

1. Read the owner's request, this file and the blueprint sections it names before you start.
2. For every change, write the tests for the owner's rules first. After coding, review your own diff line by line
   against the request and this file, and fix whatever is off.
3. Before asking the owner to merge: full tests, typecheck, lint, format check, build, Bug Guard and the layout
   checks on a copy of the demo data. Then a fresh reviewer (an agent or session that did not write the code)
   checks the whole diff against the request and this file; fix everything it finds and list it in the notes.
4. Never call something done that is not tested. Say plainly what could not be tested.
5. Ask the owner only when something is unsafe, would delete or overwrite data, would change live money or stock
   figures, or clashes with the blueprint in a way the owner would notice. Otherwise pick the safe default, say which,
   and keep going.
6. Delivery: stacked part PRs, then ONE Release PR into `main` that the owner merges once. Before asking to merge,
   send screenshots, sample PDFs, a plain-English list of what is inside and the steps only the owner can do. Merging
   to `main` deploys automatically (`.github/workflows/deploy.yml`); after the merge, check the Deploy run and
   report in plain words.
7. Write to the owner in short, plain sentences. No code words, no ids. Lead with what the owner needs to do, if
   anything.

## 2. Rules that hold everywhere (blueprint section 3)

- **Every store, SaaS later.** Every new table has `companyId` and goes through the tenant guard
  (`src/lib/tenant-db.ts`: `TENANT_MODELS`, `withCompany`, `assertSameCompany`). Nothing is built only for EXTAS.
  Company name, logo, colours, address and contact on every PDF come from the Company record.
- **Additive migrations only.** A migration never deletes data, drops or renames a column or table, or changes a
  type. A new required column has a default. Never run `prisma migrate reset` on any shared database.
- **The ERP reverses, it never deletes history.** Money, stock and posted documents are corrected by reversing or
  adjusting entries, never by editing or deleting posted rows.
- **AI never deletes data.** A delete becomes a Deletion request the owner approves; it then runs once, in the
  owner's name, through the normal checks. The lock is in the AI tool layer.
- **AI never changes permissions or roles**, its own or anyone else's.
- **AI has its own service account** (`ai-<companyId>@ai.invalid`); every AI action and AI-made record is saved
  under it and marked "AI" in the audit log. That address can never join a team or be signed up for.
- **Anything that reaches a buyer is always Ask**: replies, follow-ups, reminders, claims, quotations, invoices.
  The AI drafts and reminds; it sends only on the owner's explicit command. Supplier and factory messages start
  at Ask. These Control cells never move to Do by themselves.
- **AI is off on the live site until the owner turns it on.** AI off or paused means no AI calls, no drafts and
  no bot pushes from the AI (system alarms such as a failed backup or Bug Guard's urgent items still go out).
- **Money:** only the Accounts role and Super Admin record money received or paid
  (`accounts.receipts.record`, `accounts.payments.record`), checked in the route AND the service. The one
  exception: a petty cash holder records costs from their own box without approval.
- **PIN:** money and price actions, deletion approvals, merges, restores and data corrections need the owner's
  web PIN (`requirePin` in `src/modules/ai/settings.service.ts`). A PIN is never stored or logged in plain text,
  only its hash.
- **Language:** menus, buttons and printed documents in simple English; the Help Center and user manual in
  Bengali (চলিত ভাষা, Western digits); the AI answers in the language the owner writes in.

## 3. Business rules (blueprint section 4, v6.2)

- **Profit:** no fixed %. The owner enters profit % per order (costing, quotation, PO or invoice). No default, no
  floor. Past profit % may be shown as a hint.
- **Office overhead:** not part of costing.
- **CM:** a fixed price per style per order agreed with the factory (per piece or per dozen). No SMV or
  per-minute maths. Use the CM contract data.
- **Fabric price:** the supplier's quoted price per kg (per yard for woven), never built up from yarn.
- **Payment terms:** TT, direct bank transfer or LC, set per buyer, changeable per order, no default.
- **Order check card** instead of a go/no-go score: five checks (price vs cost, time to ship, factory capacity,
  buyer's payment history, risks), each green/yellow/red with a one-line reason. The owner decides.
- **Buyer replies and follow-ups:** the AI never replies to buyers by itself; it alerts the owner with a draft and
  reminds the owner on the dates the owner sets. Claim rate is a report figure only.
- **Bookings:** Draft → owner approval; after approval, any change to the in-house date, delivery place, payment
  terms, T&C, items or batch makes a new revision (R1, R2…) that needs approval again. Fabric first is per order;
  collar, cuff and trims wait for the full tech pack approval, unless the owner (or a permission the owner gives)
  overrides with a reason, which is logged. A fabric change after booking marks the booking red with the kg at
  risk.
- **Production:** a production project's default target date is 45 days. Embroidery/print spoilage is charged to
  that house, never the factory. Reject tolerance per batch (default 2%). The CM settlement auto-posts its
  deductions to the factory's Supplier Due.
- **Booking PDF:** A4, Landscape or Portrait chosen at download (remember the last choice, start Landscape), a
  blank 15 mm binding strip at the top, navy #1F4E79 headers, the owner's header/footer. Never cut a number or the
  page number: shrink to a minimum, then split or wrap.

## 4. Engineering conventions

- Tenant-locked client is `ctx.db` (`src/modules/auth/context.ts`). Routes use `apiRoute` (`src/lib/api.ts`),
  server actions `runAction` (`src/lib/result.ts`).
- Money and stock writes run in `runTransaction` (`src/lib/transaction.ts`); money posts through
  `src/modules/accounts/journal.service.ts`. Lock order: supplier account → purchase order → bill → return →
  materials → journal (`lockSupplierAccount` first for anything touching a supplier's bills).
- Sales without a buyer name the walk-in party on AR and Customer Advance lines (`ledgerPartyId`).
- A new permission key goes in `permissions.ts` AND in `ACCESS_TREE`
  (`src/components/settings/roles/access-tree.ts`); splitting a key needs a migration that grants the new keys to
  everyone who held the old one. Re-run the seed after adding keys.
- Secrets never go in the repo, in logs, in command lines or shell history, or in a GitHub issue. `deploy/.env` is
  never committed.
- Infrastructure names stay "extras" (`extras_erp*` databases, `/opt/extras-erp`, `/srv/extras-erp`, the
  `extras_session` cookie, the npm package name); everything the owner sees says "Extas ERP".
- Third-party integrations (couriers, website sync, WhatsApp sending, marketing sync) come last, behind settings
  that can be filled in later.
- Tests: `TEST_DATABASE_URL=postgresql://…/extras_erp_test npx vitest run`. Without `TEST_DATABASE_URL` the
  integration files are skipped silently, so check the count. Run `npm run typecheck`, `npm run lint`,
  `npm run format:check` and `npm run build` before any push.
- Every screen must work at phone (390 px), tablet (768 px), laptop (1366 px) and large desktop (1920 px) widths:
  no cut text, no overflow, every menu item reachable, Bengali renders. The layout checks enforce it.

## 5. Help Center (CRITICAL RULE, forever)

- Every feature added, changed or removed updates the Bengali Help Center (`src/modules/help/content/*.ts`) in
  the same PR. A changed screen updates its guide and its pictures in the same PR. What the tests check: every
  button, tab, option and field name a screen shows is explained in the `fields` list ("প্রতিটা বোতাম আর ঘরের
  মানে") of a guide that covers that screen (a quote in the steps does not count), and every label a guide
  quotes is in the app's code. They cannot tell whether a guide still says what the screen does: the author and
  the reviewer check that.
- Each screen's guide has What, Why (with real buying-house examples) and How (step by step, tips, common
  mistakes, what happens next), covering every section, tab, button and option on it.
- Guides quote the app's English labels exactly, in “curly quotes”; the test checks each quoted label exists in
  `src/`. Example text that is not a label is never in curly quotes.
- Every page has a guide route, every menu item a help section, every section an icon. Picture ids are
  `<slug>-<n>`, unique, with Bengali captions. Pictures are taken automatically from demo data.
- New Bengali text uses Western digits (0-9).
- Pictures: one per guide, of its own page, with a red numbered mark on what each step is about, taken on the
  demo site's sample data (`npm run help:shots`, or the "Help pictures" workflow on GitHub). A changed screen
  brings its new picture in the same PR (the picture test fails on a stale one). Only Claude Code fix branches
  (`claude/issue-*`) and `main` may keep old pictures, because Claude Code on GitHub cannot take them: Bug Guard
  lists them under Can wait. Before every Release PR every picture is taken again (`ALL=1 npm run help:shots` on
  a copy of the demo data, or the workflow with "all").

## 6. Safety on the live site

- A deploy keeps the running version, takes a safety copy of the database first (no copy, no update), installs
  exactly the commit whose checks passed, and goes back to the old version and the safety copy by itself if
  anything fails. Never leave the live site down.
- Checks and crawls on the live site never change data. Anything that writes is tested on the demo site or a
  copy.
- Nothing is ever sent to a buyer or supplier, no money moves, no permission changes and nothing is merged or
  deployed without the owner.

## 7. Bug Guard (v6.4)

Bug Guard audits the whole ERP (app, data and accounts, security, product, AI) on the owner's schedule (default
every 3 days at night) and reports in simple Bengali, grouped Urgent / Important / Can wait, in the ERP inbox
and on Telegram, with a weekly summary even when all is fine. It may: open fix PRs and prepare data corrections
(only if the owner turns that on; off by default), end a suspicious session that is not the owner's, and block
a login source after repeated failed logins, telling the owner at once. Applying a correction or merging always needs
the owner's PIN; a data correction runs after a backup, is logged and can be undone (in accounts, an adjusting entry). It
can NEVER delete data, change roles or permissions, merge or deploy, send anything to buyers or suppliers, move
money, or turn off backups or its own checks. Every check, finding, fix, approval and result is in its own log.

## 8. Backups and restore (v6.4)

- Schedule set by the owner (every N hours, every N days, or chosen weekdays at chosen times); default twice a
  day. The newest 4 stay on the server (owner picks 3 to 7); all go to the owner's Google Drive (scope `drive.file`
  only) for as long as the owner sets.
- Every backup is complete: database, every uploaded and generated file, the settings (`.env` and every secret),
  and the code at that version (git bundle), with a manifest of every table's row count and every file's
  checksum. A restore needs nothing else: no old server and no GitHub login.
- Locking is public-key: the server keeps only the public key; the private key is locked with the owner's own
  recovery key, which the owner sets (any word or pattern; never generated) and can change with the PIN. If the
  owner keeps
  the "keep my recovery key in Drive" option on, the restore guide in the owner's Drive backup folder
  holds it.
- The restore guide PDF (Bengali, with an English copy) takes a beginner from a new Azure VM and PuTTY to a
  working ERP with one pasted command. It lives in the Drive backup folder and inside every backup, and is rebuilt
  monthly and whenever the guide changes. A monthly drill restores the newest backup into a temporary database
  (never live or demo) and reports on Telegram.

## 9. Decisions log (newest first)

- 2026-10-17 (v6.4 review): Help pictures may be out of date only on Claude Code fix branches (`claude/issue-*`)
  and on `main`; Bug Guard lists those guides and every release retakes all pictures. A screen's word counts as
  explained only in a guide's `fields` list.
- 2026-10-16 (v6.4): CLAUDE.md holds every standing rule. Fix PRs count as "Fix ready" only when Claude's GitHub
  App made them for that exact issue, from a branch in this repo, into `main`. GitHub issues never carry screen
  text or business data. The Claude Action may not push to `main` or run git write commands. Full check sessions
  are read-only on the server side, use dedicated check accounts and run only from `main`. A model with no price is
  blocked until it has one (never counted as cost 0). Collar/cuff/trims override before tech pack approval: the
  owner or a permission the owner gives, not any approver. AI proposals and drafts are saved under the AI account.
  Deletion approval claims the request first so it runs once. Tech Pack is its own menu item. AI Center pages are
  grouped so every page name shows at every width. Model prices for Claude, OpenAI and Gemini are pre-filled from
  each provider's price page with source and date, and editable.
- 2026-10-16 (v6.3): backups encrypted to Google Drive; Claude, OpenAI and Gemini keys; any model per task after it
  passes the task's test; AI costs by purpose, place, agent, model and provider; Agents and Skills pages; Full
  check and Fix with Claude Code. (Generated recovery keys and "local copy deleted after upload" were replaced by
  the v6.4 rules in section 8.)
- 2026-10-14 (v6.2): booking book PDF format; Bookings approval and revisions; AI Center, Mehedi 2.0, Telegram bot
  (WhatsApp later as a second plug), order automation, Server Health. Fabric first per order.
- 2026-10-14: access is a nested tree with tri-state checkboxes; bookings have their own permission keys.
- 2026-10-13: a separate demo site (demo.extasbd.com) instead of run/wipe links on the live site; the ERP never
  deletes posted work to "undo" a batch.
- 2026-10-11: petty cash holders record costs from their box without approval.
- 2026-10-10: the Help Center rule in section 5.
- 2026-10-09: the app is "Extas ERP"; infrastructure names stay "extras".
- 2026-10-02: strict money permissions (section 2); production projects default to a 45-day target; third-party
  integrations come last.
