import type { Metadata } from "next";

import { privacyContact } from "@/modules/companies/privacy";

export const metadata: Metadata = { title: "Privacy Policy" };
export const dynamic = "force-dynamic";

const UPDATED = "24 October 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="font-serif text-xl leading-snug text-primary">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed break-words">{children}</div>
    </section>
  );
}

/**
 * The privacy policy, open to anyone without signing in (proxy.ts lets /privacy
 * through): Google shows its link on the Google Drive sign-in screen. It says what
 * the ERP keeps and what it does with Google user data, as the code does it: Drive
 * backups use only the drive.file permission, are locked before upload and go only
 * to the company's own Drive (modules/backups). The company named is the server's
 * own, from its Company record.
 */
export default async function PrivacyPage() {
  const contact = await privacyContact();
  return (
    <article>
      <p className="eyebrow">{contact.name}</p>
      <h1 className="mt-3 font-serif text-[2rem] leading-tight text-primary sm:text-[2.5rem]">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Extas ERP, run by {contact.name}. Last updated {UPDATED}.
      </p>

      <Section title="Who we are">
        <p>
          Extas ERP is the business system {contact.name} uses for its orders, stock, production,
          accounts and staff. Only people the company adds to its team can sign in.
        </p>
      </Section>

      <Section title="What the ERP keeps">
        <p>
          The business records the company and its staff enter: buyers, suppliers, orders, costings,
          stock, production, accounts, payroll and staff records, and the files they upload. For
          each person who signs in it keeps their name, email, role and a record of what they did,
          so that every change can be traced.
        </p>
        <p>
          It never sells this information and never uses it for advertising. It is kept on the
          company&apos;s own server and in the company&apos;s own backups.
        </p>
      </Section>

      <Section title="Google Drive backups">
        <p>
          The company owner can connect a Google account so the ERP copies its backups to that
          account&apos;s Google Drive. The ERP asks Google only for the permission to see and manage
          the files it creates itself (drive.file). It cannot see, open or change any other file in
          the Drive.
        </p>
        <p>From Google, the ERP uses only:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>the Google account&apos;s email, to show which account the backups go to;</li>
          <li>the Drive&apos;s free space, to show how much room is left;</li>
          <li>the backup files and folders it made, to store, list, check and restore backups.</li>
        </ul>
        <p>
          Each backup is locked (encrypted) on the server before it is uploaded, so Google cannot
          read it. The Google sign-in is kept locked on the company&apos;s server. If the owner
          turns on the late-backup alert, the same sign-in is also kept, locked, as a secret in the
          company&apos;s own GitHub repository, only to check that the newest backup reached Drive.
        </p>
        <p>
          The use of information received from Google APIs follows the Google API Services User Data
          Policy, including the Limited Use requirements. Google user data is used only to store and
          restore the company&apos;s own backups. It is not sold, not used for advertising, not used
          to train AI models, not read by people (unless the owner asks for help with a problem, or
          the law requires it), and not passed to anyone else.
        </p>
      </Section>

      <Section title="Other services">
        <p>
          Some parts of the ERP use other services only when the company turns them on: an AI
          provider for the AI assistant, a Telegram bot, email for alerts, and online shops linked
          to the ERP. They receive only what that part needs. Google Drive data is never sent to
          them.
        </p>
      </Section>

      <Section title="Removing access and deleting data">
        <p>
          The owner can stop the Google Drive backups at any time: Settings, then Backups, then
          Disconnect. Access can also be removed from the Google account itself: Google Account,
          then Security, then Third-party apps and services, then Extas ERP. Backups already in the
          Drive stay there until the owner deletes them in Google Drive.
        </p>
        <p>
          To ask what the ERP keeps about you, or to have it corrected or deleted, contact the
          company below. Money and stock records the law requires the company to keep are corrected,
          not deleted.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          {contact.name}
          {contact.email ? (
            <>
              {", "}
              <a className="text-primary underline" href={`mailto:${contact.email}`}>
                {contact.email}
              </a>
            </>
          ) : null}
          {contact.website ? `, ${contact.website}` : null}.
        </p>
      </Section>
    </article>
  );
}
