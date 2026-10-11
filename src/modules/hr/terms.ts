/*
 * The terms of employment as plain data: a title, an optional opening note and
 * sections of text, each section's paragraphs split by a blank line. HR edits
 * them as a draft and publishes numbered versions (terms.service.ts); a
 * published version's text never changes, and its fingerprint (SHA-256,
 * termsTextHash) is printed on every signed copy. No server-only code here: the
 * screens use it too.
 */

export type TermsSection = { title: string; body: string };

export type TermsText = {
  title: string;
  intro: string | null;
  sections: TermsSection[];
};

export const TERMS_LIMITS = {
  title: 160,
  intro: 3000,
  sectionTitle: 160,
  sectionBody: 8000,
  sections: 20,
} as const;

/**
 * A starter text in Bengali and English for HR to change before publishing:
 * confidentiality, zero tolerance for theft, deductions from salary and leaving
 * the company. It should be checked by a lawyer before staff sign it.
 */
export const STARTER_TERMS: TermsText = {
  title: "চাকরির শর্তাবলি (Terms of employment)",
  intro: [
    "এই শর্তগুলো কোম্পানির সব কর্মীর জন্য। অ্যাপ ব্যবহার শুরু করার আগে মন দিয়ে পড়ুন। কিছু বুঝতে না পারলে সই করার আগে এইচআরকে জিজ্ঞেস করুন।",
    "These terms apply to every employee of the company. Read them carefully before you start using the app. If anything is unclear, ask HR before you sign.",
  ].join("\n\n"),
  sections: [
    {
      title: "১. গোপনীয়তা (Confidentiality)",
      body: [
        "কাজের সূত্রে কোম্পানির যে তথ্য আপনি জানবেন, তা গোপন রাখবেন: ক্রেতা ও সরবরাহকারীর তালিকা, দাম, ডিজাইন, প্যাটার্ন, হিসাব, কর্মীদের তথ্য এবং অ্যাপের ভেতরের সব তথ্য। কোম্পানির লিখিত অনুমতি ছাড়া এসব কাউকে জানাবেন না, কপি করবেন না, ছবি তুলে বাইরে নেবেন না এবং নিজের কাজে ব্যবহার করবেন না। চাকরি ছাড়ার পরও এই দায়িত্ব থাকবে। আপনার অ্যাপের পাসওয়ার্ড কাউকে দেবেন না।",
        "Keep everything you learn at work confidential: buyer and supplier lists, prices, designs, patterns, accounts, staff details and everything in the app. Do not share it, copy it, photograph it or use it for yourself without the company's written permission. This duty continues after you leave. Never share your app password.",
      ].join("\n\n"),
    },
    {
      title: "২. চুরি ও অসততায় শূন্য সহনশীলতা (Zero tolerance for theft)",
      body: [
        "কোম্পানির টাকা, কাপড়, কাঁচামাল, তৈরি পণ্য, যন্ত্রপাতি বা অন্য কোনো জিনিস অনুমতি ছাড়া নেওয়া, সরানো বা নিজের কাজে ব্যবহার করা চুরি। ভুয়া বিল, বাড়িয়ে দেখানো খরচ এবং মিথ্যা হাজিরাও একই রকম অসততা। প্রমাণ পাওয়া গেলে আইন অনুযায়ী সঙ্গে সঙ্গে চাকরি শেষ করা হতে পারে, ক্ষতির টাকা আদায় করা হবে এবং প্রয়োজনে আইনগত ব্যবস্থা নেওয়া হবে।",
        "Taking, moving or using company money, fabric, materials, finished goods, tools or anything else without permission is theft. Fake bills, inflated claims and false attendance are the same dishonesty. Where it is proven, employment may end at once as the law allows, the loss will be recovered, and legal action may follow.",
      ].join("\n\n"),
    },
    {
      title: "৩. বেতন থেকে কর্তন (Deductions from salary)",
      body: [
        "নিয়ম অনুযায়ী বেতন থেকে যা আপনাআপনি কাটা হবে: বিনা বেতনের ছুটি ও অনুপস্থিতির দিন, নেওয়া অগ্রিমের কিস্তি, প্রযোজ্য কর, এবং তদন্তের পর আপনার দায়ে হারানো বা নষ্ট হওয়া কোম্পানির জিনিসের নির্ধারিত ক্ষতি। প্রতিটি কর্তন আপনার পে-স্লিপে আলাদা করে দেখানো থাকবে।",
        "These are taken from your salary by the rules: unpaid leave and absent days, instalments of advances you took, applicable tax, and, after an inquiry, the agreed cost of company property lost or damaged through your fault. Every deduction is shown on your payslip.",
      ].join("\n\n"),
    },
    {
      title: "৪. চাকরি ছাড়ার নিয়ম (Leaving the company)",
      body: [
        "চাকরি ছাড়তে চাইলে আইন ও নিয়োগপত্র অনুযায়ী লিখিত নোটিশ দেবেন। শেষ কর্মদিবসের আগে কোম্পানির সব জিনিস ফেরত দেবেন: আইডি কার্ড, মোবাইল, যন্ত্রপাতি, কাগজপত্র, চাবি ও নমুনা। সব জিনিস ফেরত ও হিসাব মেলানোর পর পাওনা টাকা দেওয়া হবে এবং অভিজ্ঞতা ও ছাড়পত্র দেওয়া হবে।",
        "To resign, give written notice as the law and your appointment letter require. Before your last day, return all company property: ID card, phone, tools, papers, keys and samples. Your final dues are paid, and your experience and clearance certificate is issued, once everything is returned and the accounts are settled.",
      ].join("\n\n"),
    },
  ],
};

/** The paragraphs of a section's text (split by blank lines). */
export function paragraphsOf(text: string | null | undefined): string[] {
  return (text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

/** The text as stored and shown: sections as { title, body } with tidy whitespace. */
export function tidyTerms(text: TermsText): TermsText {
  const intro = paragraphsOf(text.intro).join("\n\n");
  return {
    title: text.title.trim(),
    intro: intro || null,
    sections: text.sections.map((s) => ({
      title: s.title.trim(),
      body: paragraphsOf(s.body).join("\n\n"),
    })),
  };
}

/** Reads stored sections (JSON) back, leaving out anything that is not a section. */
export function sectionsOf(value: unknown): TermsSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((s) =>
    s && typeof s === "object" && typeof s.title === "string" && typeof s.body === "string"
      ? [{ title: s.title, body: s.body }]
      : [],
  );
}

/** Statuses of staff who still work here, and so agree to the terms. */
export const TERMS_STAFF_STATUSES = ["ACTIVE", "ON_LEAVE"] as const;

/**
 * Whether someone must agree before working in the app: the company has terms
 * everyone must have agreed to since `requiredSince`, and they last agreed
 * before that (or never).
 */
export function termsDue(requiredSince: Date | null, agreedAt: Date | null): boolean {
  if (!requiredSince) return false;
  return !agreedAt || agreedAt.getTime() < requiredSince.getTime();
}

/** "01711-•••000": enough of a number to recognise it, not to use it. */
export function maskedPhone(local: string): string {
  return `${local.slice(0, 5)}-•••${local.slice(-3)}`;
}

/** The words for how someone agreed. */
export const SIGN_METHOD_LABELS = {
  SIGNATURE: "Signed by hand",
  SMS_CODE: "Code sent by SMS",
} as const;
