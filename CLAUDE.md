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
6. Delivery: stacked part PRs, then ONE Release PR into `main`. Once every check is green, Claude merges it itself
   (the owner's decision, 2026-10-30); if GitHub refuses, say so plainly and the owner merges. Before merging, send
   screenshots, sample PDFs, a plain-English list of what is inside and the steps only the owner can do. The server
   installs each merge into `main` by itself once "Tests and build" passed on it (`deploy/self-update.sh`, every 5
   minutes); after the merge, check that the live site runs the new version and report in plain words.
7. Write to the owner in short, plain sentences. No code words, no ids. Lead with what the owner needs to do, if
   anything.
8. Every release ends with a readiness report in plain English: a table of every area (Orders and bookings,
   Costing, Accounts, Stock, Production and CM, Tech Pack, PDFs, Help Center, AI Center and Bug Guard, Bots,
   Backups and restore, Security, Screens) marked Ready / Ready with small known issues / Not ready with a
   one-line reason; every known open problem, none hidden, marked Urgent / Important / Can wait; what could not
   be tested and how the owner can test it; and one line "Ready for daily real use: Yes" or "No, because ...".
   Before it, fresh reviewers check the whole ERP (not only the diff) for Urgent and Important problems, round
   after round (at most 3), until a round finds none; each round's findings and fixes are reported.
9. Whenever the owner asks "is anything left?" (or the like), answer from a fresh check of the code and the live
   site, never from memory or old notes.

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

- **Profit:** no fixed %. The owner enters profit % per order (costing, quotation, PO or invoice). No default; at
  least 10%, no upper limit (a sheet holds up to 999.99%), checked by the server, not only the screen. A sheet saved
  under 10% before this rule keeps its figure and shows a note; any edit to it (its details or its styles) first
  raises it to at least 10%. Past profit % may be shown as a hint. The profit % comes off the selling price with the
  percent lines, so together they stay under 100% for a price to exist; the server refuses a save that leaves no
  price. Every profit % is shown with its markup on cost (15% of price = 17.65% on cost; 200% on cost is 66.67%).
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
  risk. After the tech pack is approved, any change to its trims, collar or cuff marks that part as needing
  approval again by someone who approves tech packs; until then that style's trims, collar and cuff bookings are
  blocked (the same owner override with a reason still works and is logged). Fabric bookings are not affected. The
  tech pack shows what changed (was and now), who changed it and when.
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
- **Names (settled v6.4.1).** Everything the owner, staff or a buyer sees says "Extas ERP" (or the company's own
  name). Every machine name says "extras": databases and their users (`extras_erp`, `extras_demo`,
  `extras_erp_test*`; `extras_app`, `extras_demo_app`), folders (`/opt/extras-erp`, `/srv/extras-erp`), Docker
  project, container, image and volume names, systemd units, cron files (`/etc/cron.d/extras-erp-*`), lock files, the
  `extras_session` cookie and the npm package names (`extras-erp`, `extras-erp-full-check`, `extras-erp-android`). A
  new machine name uses "extras" too. Nothing that already exists on a server, in a backup, in Google Drive, in
  GitHub settings, on a phone or in a browser is ever renamed, so these existing "extas" names stay exactly as they
  are: the `.extas-erp-data` marker in the data folder; the restore's `/var/log/extas-erp-restore.log`,
  `/var/lib/extas-erp-restore` and `/run/extas-erp-restore.lock`/`.pid`; the drill's `extas_restore_test_*`
  databases; the backup file markers `EXTASBK1`/`EXTASPK1` and the `extas-erp ...` key labels (older backups open
  only with them); the Drive label `extas` on backup files and folders; the Docker label `extas.caddy-build`; the
  browser keys `extas_sidebar`, `extas.hr.employees.layout`, `extas:install-dismissed` and `extas:duty-changed`; the
  restore settings `EXTAS_RESTORE`, `EXTAS_RAW_BASE`, `EXTAS_SEARCH_ROOTS`, `EXTAS_MIN_FREE_GB` and
  `EXTAS_SITE_BASE`; the GitHub variable `EXTAS_APP_URL`; the Android app (`com.extas.erp`, the `extas` key alias,
  `extas-erp.jks`, the `extas-erp-android-*` downloads and its `EXTAS_*` build settings); and the `extas-erp` Azure
  names in the restore guide.
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
- Pictures: one per guide, of the part of its page the steps are about (the guide's `shot.target`, else where
  the most steps' buttons are; never just the top of a long page), with a red numbered mark on what each step
  quotes: every picture has marks, and mark n is on a label step n quotes. A record's page uses `shot.route`
  ("/products/[styleId]"); a guide about something a computer cannot show on the demo data says why in
  `shot.none` and has no picture. Taken on the demo site's sample data (`npm run help:shots`, or the "Help
  pictures" workflow on GitHub). A changed screen brings its new picture in the same PR (the picture tests fail
  on a stale picture or one without marks). Only Claude Code fix branches (`claude/issue-*`) may keep old
  pictures, because Claude Code on GitHub cannot take them: Bug Guard lists them under Can wait. `main` is
  checked too: the "Help pictures" workflow runs on every PR into `main` (every Release PR) and every push to
  `main`, and takes the old pictures again as a download; the Deploy's own Checks let pictures wait, so an
  urgent fix is never kept off the live site. Before every Release PR every picture is taken again
  (`ALL=1 npm run help:shots` on a copy of the demo data, or the workflow with "all").
- Help words: every guide has tips and common mistakes; What is short points (one or two sentences each);
  "ফিল্টার" (never "ছাঁকনি") and one word for save, "সেভ" (never "সংরক্ষণ"). The tests check all of these.

## 6. Safety on the live site

- A deploy keeps the running version, takes a safety copy of the database first (no copy, no update), installs
  exactly the commit whose checks passed, and goes back to the old version and the safety copy by itself if
  anything fails. Never leave the live site down.
- Checks and crawls on the live site never change data. Anything that writes is tested on the demo site or a
  copy.
- Nothing is ever sent to a buyer or supplier, no money moves, no permission changes and nothing is merged or
  deployed without the owner. The one exception (the owner's decision, 2026-10-30): Claude merges its own PRs once
  every check is green, and the server then installs them by itself.

## 7. Bug Guard (v6.4)

Bug Guard audits the whole ERP (app, data and accounts, security, product, AI) on the owner's schedule (default
every 3 days at night) and reports in simple Bengali, grouped Urgent / Important / Can wait, in the ERP inbox
and on Telegram, with a weekly summary even when all is fine. It may: open fix PRs and prepare data corrections
(only if the owner turns that on; off by default), end a suspicious session that is not the owner's, and block
a login source after repeated failed logins, telling the owner at once. Applying a correction or merging always needs
the owner's PIN; a data correction runs after a backup, is logged and can be undone (in accounts, an adjusting entry). It
can NEVER delete data, change roles or permissions, merge or deploy, send anything to buyers or suppliers, move
money, or turn off backups or its own checks. Every check, finding, fix, approval and result is in its own log.
A data correction only adds a record (a stock movement, an adjusting entry, a payment allocation); it never
overwrites a stored total or figure.

## 8. Backups and restore (v6.4)

- Schedule set by the owner (every N hours, every N days, or chosen weekdays at chosen times); default twice a
  day. The newest 4 stay on the server (owner picks 3 to 7); each goes to the owner's Google Drive (scope
  `drive.file` only), which keeps the newest 3: a new one, once checked in Drive, replaces the oldest (2026-10-30).
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

- 2026-10-31 (where loans show): Home's money card is "Loans & capital owed" (with the next installment and a link
  to the page), Home's Action Zone has a "Loan installments" card (late or due within 7 days; owner and Accounts),
  and Business > Overview has a "Left after installments" card. The nightly clock tells everyone who records
  payments (inbox and Telegram) when an installment or a fixed cost could not be recorded by itself, and once, 7 days
  before, when a person's term ends. Interest or profit paid before the ERP is shown on the lender's profile only,
  never posted.
- 2026-10-31 (loans, capital and fixed costs): a new "Loans & capital" tab in Accounts. Every bank, NGO or person
  who lends money has a profile with every loan or term, running, renewed or closed; closed ones stay for good and
  nothing is deleted (corrections by reversal). A bank or NGO loan is repaid by a fixed monthly installment; its
  interest is what is paid beyond the loan, split evenly over the installments (the rate is only a note). A person's
  money runs in terms (profit every few months, as money or %), ended with "Pay profit & renew", "Pay profit &
  return money" or "Return part". Each loan chooses "Keep it in my capital for ever": yes, the money working in the
  business never drops for it and its principal repayments show below Net profit ("Loan installments paid", then
  "Left after installments"); no, what is repaid comes off it. Interest and a person's profit are always a cost
  before Net profit. The capital figure shows the owner's capital, loans kept in capital (with a small "Still owed
  to the bank" line) and other loans owed. Installments can pay by themselves on their due day and monthly fixed
  costs (rent, internet) are recorded by themselves on their day: both set up with the PIN, by Accounts or Super
  Admin, run by the nightly clock in that person's name with their permissions checked each time (lost permission
  switches it off, logged). Fixed costs are office costs, never order costing; a changed amount counts from the next
  month. The CEO's salary is an HR employee with the post "Owner / CEO", paid through payroll, never also as a fixed
  cost. Loans running before the ERP are entered with "Taken before the ERP" at what is owed today (no money moves).
- 2026-10-30 (Drive keeps 3): Google Drive keeps the newest 3 checked backups (and the newest 3 update safety
  copies); each new backup, once Google's copy is checked, replaces the oldest, so a backup in Drive is never
  removed before a newer one is safe there. The "Keep in Google Drive for (days)" setting is gone (its column
  stays, unused). "Back up now" finishes and reaches Drive whatever the page does: the backup clock never sends a
  backup again while the run that made it is still sending it.
- 2026-10-30 (no PuTTY, updates by themselves): the owner no longer uses PuTTY or Azure's Run command, not even
  after a restore on a new server, a new IP or a new web address. Claude merges its own PRs once every check is
  green (this replaces "only the owner merges" below; the rulesets stay as they are). The server pulls each merge
  into `main` itself (`deploy/self-update.sh`, cron `/etc/cron.d/extras-erp-self-update`, read-only from the public
  repository, only a commit whose "Tests and build" passed; never on a drill, standby or unfinished restore;
  `AUTO_UPDATE=off` in `deploy/.env` stops it); the Deploy workflow signs in over SSH only when the GitHub variable
  `DEPLOY_OVER_SSH` is `true`. The restore command in the guide PDF (download and Drive copy) carries the Google
  client and, when kept in Drive, the recovery key, so nothing is typed (it stays out of the shell history); it
  shows the server against the minimum (2 CPUs, 8 GB memory, Azure B2ms) and goes on by itself, goes on from the
  step that stopped when pasted again, and takes `--domain` for a new web address. The build fits 8 GB (no type
  check in the image build, a 4 GB heap, swap up to 16 GB with memory); CI still type-checks. The owner approved
  these changes to the restore files.
- 2026-10-30 (retail leftovers): the website never sent real orders to the live ERP through the old link, so the
  switch-over steps (moving old website orders, `GET /cost-of-goods`) are not built. B-grade order lines for the shops
  come in a separate release with full checks of wholesale sales, because they change how every sale takes stock and
  cost; until then a B-grade line answers 422.
- 2026-10-30 (retail loss rule): every piece a shop takes from the ERP is the shop's to pay, whatever happens to it
  (lost, the courier never hands it back, stolen, taken by staff). Only a piece that comes back and is approved in the
  ERP's check comes off. So a refused exchange parcel's new piece not back by the exchange deadline is billed in full
  the night after, and credited if it comes back later and is approved.
- 2026-10-29 (copy codes for sold copies): a sold copy of the ERP gets the Extas Google client only through a
  one-time copy code the owner makes on the Extas ERP's Backups screen ("Copies of this ERP", with the PIN; only
  where the client was set on screen, never one that came from another ERP). A code works once and for 30 days;
  only its hash is stored. The copy enters it once ("Use a copy code", with the PIN) and keeps the client sealed;
  it checks in daily, and Block (PIN) stops the code and, at the copy's next check-in, removes the client and its
  Drive sign-in (no data or backup is deleted; local backups go on). Without a code nobody gets the client.
- 2026-10-24 (Business, Retail and POS plan v6, approved, NOT built yet; start only when the owner says so): the
  plan is now `docs/business-overview/plan-v6.md`, the website's part `site-changes-v6.md` and the owner's
  answers `owner-notes-v6.md`; v6 replaces v5 where they differ. The ERP is a separate supplier to each shop: the
  shop sees only its own buying price, never the ERP's cost or other prices. A shop is billed when the parcel
  goes to the courier, at the price fixed when the order came. A shop goes on hold when it owes money and 30 days
  pass after its last payment (any payment restarts the count); exchanges still go through during a hold.
  Returns are checked within 5 days (reminders on days 5, 7 and 10). An exchange sends the new piece unbilled and,
  when the old piece is approved, charges only the price difference; a late, missing or declined old piece bills
  the new piece in full, and a piece from a refused exchange parcel that comes back damaged or missing is the
  shop's loss. On the switch day, unpaid customer money on old website orders moves to the shop's account as
  booked (past profit unchanged), and old pieces returned later are credited at the booked price.
- 2026-10-24 (Business, Retail and POS plan v5, approved, NOT built yet; start only when the owner says so):
  the full plan is `docs/business-overview/plan-v5.md` (Bengali) and the website's part is
  `docs/business-overview/site-changes-v5.md`. Each retail shop is a special wholesale buyer in the buyer list
  ("Extas Retail" first, Buyer 360 like any buyer) and buys at a shop price; the existing Dashboard stays
  untouched and a new "Business" menu holds Overview, Retail (E-commerce and POS tabs), Returns and Retail stores.
  Returns change money only when the owner checks a piece in the ERP: approved A-grade pieces come off the
  shop's account at the price it paid; declined pieces (B or C grade, damaged, missing, wrong) stay on the
  shop's account as its loss. Courier return lists and consignment IDs are recorded; unclear partial deliveries
  go on Hold for the owner to tick. Unchecked returned pieces may go only to shops, never to wholesale.
- 2026-10-24 (Drive backup plan v5): the one-command restore system is frozen (bootstrap.sh,
  restore-tool.py, restore.sh, restore-request.sh, setup-server.sh, the restore guide and the restore
  drill); the backup side adapts to it, never the reverse, and a change any of them seems to need
  waits for the owner. Google Drive backups use one Extas Google client of the type "TVs and
  Limited Input devices" (the client the restore guide prints and the restore signs in with), put
  on each server by an Extas maintainer with `deploy/set-google-client.sh`; no Web client, redirect
  or relay. Owners never open Google Cloud; their own client stays possible, with the PIN. One
  dedicated Google account per ERP server, said on the Backups screen (no check across servers).
  A new Google sign-in while Drive is connected (Reconnect, another account) needs the PIN,
  checked on the server for every request path (`drive-connect.ts`); the first Connect needs
  none. Real disaster recovery counts as working only after the real Google test on a clean
  Ubuntu 24.04 VPS, with evidence.
- 2026-10-23 (CN-005, e-commerce API): online shops call `/api/v1/ecommerce` with their own key (stored only as a
  hash, shown once; making or changing a key, switching a shop back on, adding a shop with a webhook address or
  changing it, or letting more addresses call (a new address on the IP allow-list, or emptying it) needs the PIN;
  only a Super Admin can give the right to connect online shops). Each shop acts through its own locked account
  `shop-<id>@shop.invalid`, which can never sign in or join a team. That account may record money received for its
  own website orders and take back checked returns: the one exception to the money rule in section 2, because the
  contract asks for it; the API never refunds money (Accounts does that in the ERP). The shop's prices are taken as
  sent. Website returns are credited to the Walk-in customer and set against that order's invoice (money that
  arrives after the return is still taken in full and moves the rest of the credit to "Left to pay back"); checked
  pieces go back as GOOD (stock), B_GRADE (B-grade stock) or DAMAGED. An order that came back undelivered owes
  nothing and takes no money anywhere in the ERP. Stock and product webhooks to the shop are on by default (switch:
  `ECOMMERCE_WEBHOOKS`).
- 2026-10-18 (v6.4.2): the CM settlement charges only the CM work: faults on material the factory supplied or on
  material bills are left out (and shown, with why), CM paid counts only payments not used on material bills,
  excess rejects need a price per reject before saving, and while a settlement stands its cutting reports,
  mending returns and the style's CM cannot change ("Undo the CM settlement first"). After the v6.4.2 deploy Bug
  Guard listed, read-only, old settlements the new rules would change; the owner decides on each.
- 2026-10-18 (v6.4.2): profit % per order is at least 10% with no upper limit and still no default; a sheet saved
  under 10% keeps its figure, shows a note and reaches 10% when it is next edited (section 3).
- 2026-10-18 (v6.4.2): a change to trims, collar or cuff after the tech pack is approved needs that part approved
  again by someone who approves tech packs; trims, collar and cuff bookings for that style wait for it, fabric
  bookings do not (section 3).
- 2026-10-18 (v6.4.2, merging by Claude changed on 2026-10-30, see above): only the owner merges into `main`. Two rulesets on `main`, both active: "Protect main"
  with an empty Bypass list (pull request, the "Tests and build" check, no force pushes, no deletion) and
  "Restrict updates" in a ruleset of its own whose Bypass list holds only Repository admin (the owner). The ERP's
  Merge (the owner's token, with the PIN) and the owner on GitHub can merge; Claude Code's GitHub App and every
  other token cannot. Test the connection checks exactly this, and Claude Code stays off until both are right.
- 2026-10-18 (v6.4.2): the bot never checks a 4-8 digit number it did not ask for: every one is hidden the same
  way. Wrong PINs the bot asked for alarm the owner from the 5th in a day; after 20, PIN actions on the bot stop
  until the owner unlocks them in the ERP with the PIN. The restore command keeps nothing opened on a VM (cleaned
  at every start and at boot; only a still-locked download stays), runs its own version's restore steps, puts an
  ERP in use back on its own code when a restore over it fails, and the guide never says to type the address at
  the overwrite question.
- 2026-10-18 (v6.4.1): every release ends with the readiness report (section 1, item 8) after up to 3 rounds
  of fresh whole-ERP reviews; "is anything left?" is answered from a fresh check of the code and the live site.
  After each deploy Bug Guard checks the live ERP once, read-only (no AI unless the owner turned it on), into the
  ERP inbox and Telegram. A late-backup alert runs on GitHub, outside the server. A restored ERP that waits on
  standby says so at the end and on every page, and keeps its backups and alarms running.
- 2026-10-18 (v6.4.1): Help pictures show the part of the page each guide's steps are about and every picture
  has numbered marks. The picture tests run on `main` too; the "Help pictures" workflow runs on every PR into
  `main` and every push to `main`; only the Deploy's own Checks let pictures wait. Every guide has tips and
  common mistakes; What is short points; "ফিল্টার" not "ছাঁকনি"; "সেভ" is the one word for save.
- 2026-10-18 (v6.4.1): names settled (section 4): machine names say "extras", what people see says "Extas ERP",
  and nothing that already exists is renamed, so the listed "extas" names stay as they are.
- 2026-10-18 (v6.4.1): a Bug Guard correction only adds a record (a stock movement or an adjusting entry) and
  never overwrites a stored figure; a stale stored total is a manual finding. Wrong passwords never lock an
  account: only that address waits; the owner can unlock by an emailed link or the Telegram bot with the PIN.
  Claude Code (Fix with Claude Code, Fix all, Ask) stays off until `main` is locked by a ruleset with no bypass.
  Cloudflare's address list updates itself daily and a Cloudflare address is never blocked as one visitor. A
  restore drill copy (`restore.sh --drill`) runs in test mode: no emails, bot messages, Drive backups, GitHub
  writes or clocks.
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
