import type { HelpSection } from "../types";

/** Buyers & suppliers: their profiles, grades, statements, opening balances and dues. */
export const partiesHelp: HelpSection = {
  id: "parties",
  title: "ক্রেতা ও সরবরাহকারী (Buyers & suppliers)",
  description:
    "প্রতিটি ক্রেতা ও সরবরাহকারীর প্রোফাইল, যোগাযোগ, গ্রেড, Blue Verified চিহ্ন, পাওনা-দেনা, হিসাবের স্টেটমেন্ট আর কে কত বকেয়া (Dues)।",
  href: "/parties",
  articles: [
    {
      slug: "parties-find",
      title: "ক্রেতা বা সরবরাহকারী খুঁজবেন ও প্রোফাইল দেখবেন যেভাবে",
      summary:
        "নাম, কোড, ফোন বা ইমেইল দিয়ে খোঁজা, গ্রেড ও অবস্থা দিয়ে ছাঁকা, আর প্রোফাইলে ব্যালান্স, ক্রেডিট ও ব্যবসার হিসাব দেখা।",
      keywords: [
        "buyers",
        "suppliers",
        "parties",
        "customer",
        "profile",
        "balance",
        "owes you",
        "you owe",
        "ক্রেতা",
        "সরবরাহকারী",
        "কাস্টমার",
        "সাপ্লায়ার",
        "পার্টি",
        "প্রোফাইল",
      ],
      routes: ["/parties/buyers", "/parties/suppliers", "/parties"],
      who: "যাঁরা ক্রেতা ও সরবরাহকারী দেখতে পারেন: Super Admin, Sales Executive, Accounts ও Production Manager।",
      anyOf: ["parties.view"],
      steps: [
        {
          text: "মেনু থেকে “Buyers & suppliers” খুলুন (ফোনে “Parties”)। “Buyers” বা “Suppliers” ট্যাব বেছে নিন।",
          image: {
            id: "parties-find-1",
            caption: "“Buyers” ট্যাবের তালিকা: নাম, ধরন, যোগাযোগ, শহর, গ্রেড ও ব্যালান্স",
          },
        },
        {
          text: "খোঁজার ঘরে নাম, কোড, যোগাযোগের মানুষ, ফোন বা ইমেইল লিখুন। “Status”, “Grade”, “Buyer type” ও “Blue Verified only” দিয়ে ছাঁকুন। “Clear filters” দিয়ে আবার সব দেখুন।",
        },
        {
          text: "তালিকার “Balance”-এ “Owes you” মানে তাঁর কাছে আপনার পাওনা, “You owe” মানে আপনার দেনা, “Settled” মানে কিছু বাকি নেই।",
        },
        {
          text: "নামে চাপলে প্রোফাইল খুলবে: “Balance”, “Credit limit”, “Credit left”, “Payment terms”, “Last payment”, “Last business” ও “Opening balance”।",
          image: {
            id: "parties-find-2",
            caption: "প্রোফাইল পাতা: ব্যালান্স, ক্রেডিট, যোগাযোগ ও “Business so far”",
          },
        },
        {
          text: "“Contact”-এ ফোন, WhatsApp ও ইমেইলে চাপলে ফোনের নিজের অ্যাপ খুলবে। “Business so far”-এ কয়টি কোটেশন, অর্ডার, ইনভয়েস, বিল ও প্রোডাকশন প্রজেক্ট আছে দেখাবে।",
        },
      ],
      tips: [
        "যিনি ক্রেতা ও সরবরাহকারী দুটোই, তিনি দুই তালিকাতেই দেখাবেন।",
        "অন্য কোনো অ্যাকাউন্টে একই ফোন বা ইমেইল থাকলে প্রোফাইলে সতর্কবার্তা আসে, যাতে একই মানুষকে দুবার যোগ না করেন।",
      ],
    },
    {
      slug: "parties-new",
      title: "নতুন ক্রেতা বা সরবরাহকারী যোগ করবেন যেভাবে",
      summary:
        "নাম, ধরন, যোগাযোগ, ক্রেডিট সীমা ও পরিশোধের মেয়াদ দিয়ে নতুন ক্রেতা, সরবরাহকারী বা ফ্যাক্টরির অ্যাকাউন্ট খোলা।",
      keywords: [
        "new buyer",
        "new supplier",
        "add buyer",
        "add supplier",
        "factory",
        "credit limit",
        "payment terms",
        "নতুন ক্রেতা",
        "নতুন সরবরাহকারী",
        "কাস্টমার যোগ",
        "ফ্যাক্টরি যোগ",
        "ক্রেডিট লিমিট",
      ],
      routes: ["/parties/buyers/new", "/parties/suppliers/new"],
      who: "যাঁদের অ্যাকাউন্ট বদলানোর অনুমতি আছে: Super Admin ও Sales Executive।",
      anyOf: ["parties.manage"],
      steps: [
        {
          text: "“Buyers” ট্যাবে “New buyer” অথবা “Suppliers” ট্যাবে “New supplier” চাপুন।",
        },
        {
          text: "“Who they are” অংশে “Account type” বেছে নিন: “Buyer”, “Supplier” বা দুটোই হলে “Buyer and supplier”। ক্রেতা হলে “Buyer type” (“Retail”, “Wholesale”, “Corporate (B2B)”) দিন।",
          image: {
            id: "parties-new-1",
            caption: "নতুন ক্রেতার ফর্ম: “Account type”, “Buyer type”, নাম ও গ্রেড",
          },
        },
        {
          text: "“Name”, দরকার হলে “Code (optional)” ও “Grade (optional)” দিন।",
        },
        {
          text: "“Contact” অংশে “Contact person (optional)”, “Email (optional)”, “Phone (optional)”, “WhatsApp (optional)”, “Address (optional)”, “City (optional)” ও “Country” দিন।",
        },
        {
          text: "“Terms” অংশে ক্রেতা সর্বোচ্চ কত বাকি রাখতে পারবেন (“Credit limit”, ফাঁকা মানে সীমা নেই), কত দিনে টাকা দেবেন (“Payment terms (days)”) ও “Tax ID (optional)” দিন।",
        },
        { text: "নোট লিখে “Add the buyer” (বা “Add the supplier”) চাপুন। নতুন প্রোফাইল খুলবে।" },
      ],
    },
    {
      slug: "parties-edit-status",
      title: "প্রোফাইল বদলাবেন, গ্রেড বা Blue Verified দেবেন যেভাবে",
      summary:
        "তথ্য বদলানো, A+ থেকে C গ্রেড দেওয়া, বিশ্বস্তদের Blue Verified চিহ্ন দেওয়া, আর অ্যাকাউন্ট নিষ্ক্রিয়, বন্ধ বা আবার চালু করা।",
      keywords: [
        "edit details",
        "grade",
        "blue verified",
        "dormant",
        "close the account",
        "reopen",
        "settling",
        "গ্রেড",
        "ব্লু ভেরিফায়েড",
        "যাচাইকৃত",
        "অ্যাকাউন্ট বন্ধ",
        "নিষ্ক্রিয়",
      ],
      routes: ["/parties/buyers", "/parties/suppliers"],
      who: "যাঁদের অ্যাকাউন্ট বদলানোর অনুমতি আছে: Super Admin ও Sales Executive।",
      anyOf: ["parties.manage"],
      steps: [
        {
          text: "প্রোফাইল খুলুন। তথ্য বদলাতে “Edit details” চাপুন, বদলে “Save changes” চাপুন।",
        },
        {
          text: "গ্রেড দিতে “Give a grade” (বা “Change the grade”) চাপুন, “A+”, “A”, “B”, “C” বা “No grade” বেছে “Save the grade” চাপুন।",
          image: {
            id: "parties-edit-status-1",
            caption: "প্রোফাইলের কাজের মেনু: গ্রেড, Blue Verified, অবস্থা ও স্টেটমেন্ট",
          },
        },
        {
          text: "বিশ্বস্ত অ্যাকাউন্টে নীল টিক দিতে “Give the Blue Verified badge”, সরাতে “Remove the Blue Verified badge” চাপুন।",
        },
        {
          text: "কিছু দিন অর্ডার না দেওয়া ক্রেতাকে “Mark as dormant” করুন, পরের অর্ডারে নিজে থেকেই সক্রিয় হবে। ব্যবসা বন্ধ করতে “Close the account”, চাইলে “Reason (optional)” লিখে নিশ্চিত করুন। আবার চালু করতে “Reopen”।",
        },
      ],
      tips: [
        "পাওনা বা দেনা বাকি থাকা অবস্থায় বন্ধ করলে অ্যাকাউন্ট “Settling” হয়; ব্যালান্স শূন্য হলে বন্ধ হয়ে যায়।",
        "টাকা বাকি থাকলে ক্রেতাকে সরবরাহকারী (বা উল্টোটা) বানানো যায় না, তবে “Buyer and supplier” করা সবসময় যায়।",
        "“Walk-in customers” অ্যাকাউন্টটি সিস্টেমের, এর শুধু নাম ও নোট বদলানো যায়।",
      ],
    },
    {
      slug: "parties-statement",
      title: "ক্রেতা বা সরবরাহকারীর হিসাবের স্টেটমেন্ট দেখবেন ও ছাপবেন যেভাবে",
      summary:
        "যেকোনো সময়ের শুরুর ব্যালান্স, প্রতিটি লেনদেন, চলমান ব্যালান্স ও শেষ ব্যালান্স দেখা আর লেটারহেডে PDF ছাপা।",
      keywords: [
        "statement",
        "statement of account",
        "ledger",
        "running balance",
        "debit",
        "credit",
        "pdf",
        "স্টেটমেন্ট",
        "হিসাব বিবরণী",
        "লেজার",
        "খতিয়ান",
        "বকেয়ার হিসাব",
      ],
      routes: ["/parties/buyers", "/parties/suppliers"],
      who: "যাঁরা স্টেটমেন্ট দেখতে পারেন: Super Admin, Sales Executive ও Accounts।",
      anyOf: ["parties.ledger.view"],
      steps: [
        { text: "প্রোফাইলে “Statement” চাপুন।" },
        {
          text: "সময় বেছে নিন: “Whole account”, “This month”, “Last 90 days”, “This year”, অথবা “From” ও “To” দিয়ে “Show these days”।",
          image: {
            id: "parties-statement-1",
            caption: "স্টেটমেন্ট পাতা: সময় বাছাই, সারাংশ ও লেনদেনের তালিকা",
          },
        },
        {
          text: "“Summary”-তে “Opening balance”, “Total debit”, “Total credit” ও “Closing balance”। নিচে প্রতিটি লেনদেন চলমান “Balance”-সহ। “Dr” মানে তাঁর কাছে কোম্পানির পাওনা, “Cr” মানে কোম্পানির কাছে তাঁর পাওনা।",
        },
        {
          text: "ছাপতে বা পাঠাতে “Statement (PDF)” চাপুন। কোম্পানির লেটারহেডে সারাংশ ও সব লেনদেন আসবে।",
        },
      ],
    },
    {
      slug: "parties-opening-balance",
      title: "শুরুর পাওনা-দেনা (Opening balance) দেবেন যেভাবে",
      summary:
        "Extas ERP শুরুর আগে কোনো ক্রেতা বা সরবরাহকারীর সঙ্গে যে পাওনা বা দেনা ছিল, তা একবার লিখে দেওয়া।",
      keywords: [
        "opening balance",
        "previous due",
        "old balance",
        "brought forward",
        "শুরুর ব্যালান্স",
        "আগের বকেয়া",
        "পুরোনো পাওনা",
        "পুরোনো দেনা",
      ],
      routes: ["/parties/buyers", "/parties/suppliers"],
      who: "শুধু Accounts ও Super Admin (হিসাবের খাতায় যায়)।",
      anyOf: ["accounts.manage"],
      steps: [
        { text: "ক্রেতা বা সরবরাহকারীর প্রোফাইল খুলে “Set the opening balance” চাপুন।" },
        {
          text: "দিক বেছে নিন: “… owed you” (তিনি আপনার কাছে ঋণী ছিলেন) অথবা “You owed …” (আপনি তাঁর কাছে ঋণী ছিলেন, যেমন বাকি বিল বা তাঁর দেওয়া অগ্রিম)।",
          image: {
            id: "parties-opening-balance-1",
            caption: "“Opening balance” জানালা: দুই দিকের বাছাই, পরিমাণ ও “As of”",
          },
        },
        {
          text: "পরিমাণ ও “As of” (কোন তারিখের হিসাব) দিয়ে “Save the opening balance” চাপুন।",
        },
      ],
    },
    {
      slug: "parties-dues",
      title: "কে কত বকেয়া (Dues) দেখবেন যেভাবে",
      summary: "আজ পর্যন্ত ক্রেতাদের কাছে মোট পাওনা আর সরবরাহকারীদের মোট দেনা, বড় অঙ্ক আগে।",
      keywords: [
        "dues",
        "receivable",
        "payable",
        "owed to you",
        "you owe",
        "outstanding",
        "বকেয়া",
        "পাওনা",
        "দেনা",
        "বাকি",
        "আদায়যোগ্য",
      ],
      routes: ["/parties/dues"],
      who: "যাঁরা স্টেটমেন্ট দেখতে পারেন: Super Admin, Sales Executive ও Accounts।",
      anyOf: ["parties.ledger.view"],
      steps: [
        {
          text: "“Buyers & suppliers” > “Dues” ট্যাব খুলুন।",
          image: {
            id: "parties-dues-1",
            caption: "“Dues” ট্যাব: “Owed to you” ও “You owe” তালিকা",
          },
        },
        {
          text: "“Owed to you”-এ ক্রেতারা কে কত দেবেন, “You owe”-এ আপনি কোন সরবরাহকারীকে কত দেবেন, বড় অঙ্ক আগে।",
        },
        {
          text: "যেকোনো সারির “Statement”-এ চাপলে তাঁর পুরো হিসাব খুলবে।",
        },
      ],
    },
  ],
};
