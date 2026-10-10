import type { HelpSection } from "../types";

/** Compliance: the company's licences and registrations, their scans, renewals and reminders. */
export const complianceHelp: HelpSection = {
  id: "compliance",
  title: "লাইসেন্স ও নিবন্ধন (Compliance)",
  description:
    "ট্রেড লাইসেন্স, VAT/BIN, TIN, IRC/ERC, BGMEA/BKMEA, ফায়ার ও পরিবেশ লাইসেন্স: কোনটি চালু, কোনটি নবায়ন করতে হবে, স্ক্যান কপি আর সময়মতো রিমাইন্ডার।",
  href: "/compliance",
  articles: [
    {
      slug: "compliance-overview",
      title: "কোন লাইসেন্স চালু বা নবায়ন বাকি দেখবেন যেভাবে",
      summary:
        "কয়টি লাইসেন্স চালু, শিগগির নবায়ন করতে হবে বা মেয়াদ শেষ, আর কোন জরুরি নিবন্ধন এখনো ফাইলে নেই তা দেখা।",
      keywords: [
        "compliance",
        "licence",
        "license",
        "trade licence",
        "bin",
        "tin",
        "expired",
        "renew soon",
        "লাইসেন্স",
        "ট্রেড লাইসেন্স",
        "নবায়ন",
        "মেয়াদ শেষ",
        "নিবন্ধন",
      ],
      routes: ["/compliance"],
      who: "যাঁরা লাইসেন্স দেখতে পারেন: Super Admin ও Accounts।",
      steps: [
        {
          text: "মেনু থেকে “Compliance” খুলুন। উপরে “In force”, “Renew soon”, “Expired” ও “No expiry”-এর সংখ্যা।",
          image: {
            id: "compliance-overview-1",
            caption: "“Compliance” পাতা: উপরের সংখ্যা, “Needs renewing” ও “Not on file”",
          },
        },
        {
          text: "“Needs renewing”-এ যেগুলোর মেয়াদ শেষ হচ্ছে বা হয়ে গেছে। “Not on file”-এ ট্রেড লাইসেন্স, BIN বা TIN-এর মধ্যে যেটি এখনো যোগ করা হয়নি।",
        },
        {
          text: "“Numbers on documents”-এ যে নম্বরগুলো ইনভয়েস ও অন্যান্য কাগজে ছাপা হয় (যেমন BIN) দেখাবে।",
        },
        {
          text: "তালিকা “Which records” (“In force”, “Renew soon”, “Expired”, “With renewed and archived”) ও “Kind” দিয়ে ছাঁকুন, নাম বা নম্বর দিয়ে খুঁজুন।",
        },
      ],
    },
    {
      slug: "compliance-add",
      title: "নতুন লাইসেন্স বা নিবন্ধন যোগ করবেন যেভাবে",
      summary:
        "লাইসেন্সের ধরন, নম্বর, ইস্যুকারী, তারিখ, কত দিন আগে মনে করানো হবে আর সনদের স্ক্যান কপি যোগ করা।",
      keywords: [
        "add a licence",
        "registration",
        "certificate",
        "scan",
        "expiry",
        "irc",
        "erc",
        "bgmea",
        "fire licence",
        "লাইসেন্স যোগ",
        "সনদ",
        "স্ক্যান কপি",
        "মেয়াদ",
      ],
      routes: ["/compliance"],
      who: "যাঁদের লাইসেন্স বদলানোর অনুমতি আছে: Super Admin।",
      anyOf: ["compliance.manage"],
      steps: [
        {
          text: "“Compliance” পাতায় “Add a licence” চাপুন।",
        },
        {
          text: "“What it is”-এ ধরন বেছে নিন (ট্রেড লাইসেন্স, VAT/BIN, TIN, IRC, ERC, BGMEA/BKMEA, ফায়ার, পরিবেশ বা অন্য)। দরকার হলে “Name (optional)” দিন।",
          image: {
            id: "compliance-add-1",
            caption: "“Add a licence or registration” ফর্ম: ধরন, নম্বর, ইস্যুকারী ও তারিখ",
          },
        },
        {
          text: "“Number (optional)”, “Issued by (optional)” (যেমন Dhaka North City Corporation), “Issued on (optional)” ও “Expires on” দিন।",
        },
        {
          text: "“Start reminding (days before expiry)”-এ মেয়াদ শেষের কত দিন আগে থেকে মনে করানো হবে দিন। “Add” চাপুন।",
        },
        {
          text: "রেকর্ডের পাতায় “Add a scan” চাপুন এবং সনদের ছবি বা PDF দিন। পরে “Open the scan” বা “Download” দিয়ে দেখা যায়।",
          image: {
            id: "compliance-add-2",
            caption: "রেকর্ডের পাতায় “Scan” অংশ ও “Add a scan” বোতাম",
          },
        },
      ],
    },
    {
      slug: "compliance-renew",
      title: "লাইসেন্স নবায়ন বা সংশোধন করবেন যেভাবে",
      summary:
        "নবায়নের পর নতুন মেয়াদ দেওয়া (আগের মেয়াদ ইতিহাস হিসেবে থাকে), ভুল ঠিক করা, আর্কাইভ, ফিরিয়ে আনা বা মোছা।",
      keywords: [
        "renew",
        "renewal",
        "correct",
        "archive",
        "restore",
        "new expiry date",
        "নবায়ন",
        "রিনিউ",
        "নতুন মেয়াদ",
        "সংশোধন",
        "আর্কাইভ",
      ],
      routes: ["/compliance"],
      who: "যাঁদের লাইসেন্স বদলানোর অনুমতি আছে: Super Admin।",
      anyOf: ["compliance.manage"],
      steps: [
        {
          text: "লাইসেন্সের পাতা খুলে “Renew” চাপুন।",
          image: {
            id: "compliance-renew-1",
            caption: "“Renew” জানালা: নবায়নের দিন, নতুন মেয়াদ ও নম্বর",
          },
        },
        {
          text: "“Renewed on”, “New expiry date” ও দরকার হলে নতুন “Number” ও “Issued by” দিয়ে “Save the renewal” চাপুন। আগের মেয়াদ “Earlier terms”-এ থাকবে এবং তার রিমাইন্ডার বন্ধ হবে।",
        },
        { text: "নতুন রেকর্ডে নতুন সনদের স্ক্যান যোগ করুন।" },
        {
          text: "ভুল তথ্য ঠিক করতে “Correct”। আর লাগবে না এমন রেকর্ড “Archive” করুন (রিমাইন্ডার বন্ধ হয়), আবার লাগলে “Restore”। ভুল করে যোগ করা রেকর্ড “Delete”।",
        },
      ],
      tips: [
        "মেয়াদ কাছে এলে অ্যাপ নিজে থেকে রিমাইন্ডার পাঠায়। WhatsApp ও ইমেইলে পাঠানো পরে আসবে।",
      ],
    },
  ],
};
