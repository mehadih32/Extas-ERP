import type { HelpSection } from "../types";

/** Accounts: money in hand, supplier payments, expenses and claims, the journal and reports. */
export const accountsHelp: HelpSection = {
  id: "accounts",
  title: "হিসাব (Accounts)",
  description:
    "ক্যাশ, ব্যাংক ও ওয়ালেটের টাকা, সরবরাহকারীকে পরিশোধ, খরচ ও খরচের দাবি, জার্নাল, হিসাবের তালিকা আর লাভ-ক্ষতি ও ব্যালান্স শিটের মতো রিপোর্ট।",
  href: "/accounts",
  articles: [
    {
      slug: "accounts-overview",
      title: "হিসাবের ড্যাশবোর্ড (Overview): পাঁচটি কার্ড পড়বেন যেভাবে",
      summary:
        "পাঁচটি কার্ডে ব্যবসার টাকার পুরো ছবি: হাতে ও ব্যাংকে কত টাকা, বাজারে কত পাওনা ও দেনা, মালে ও উৎপাদনে কত টাকা আটকে আছে, আর লাভ কত। প্রতিটি কার্ডে চাপ দিলে বিস্তারিত তালিকা খোলে, আর টাকার অঙ্ক চাইলে লুকিয়ে রাখা যায়।",
      keywords: [
        "accounts overview",
        "executive dashboard",
        "cash & bank",
        "market due",
        "market payable",
        "inventory & wip",
        "net profit",
        "gross profit",
        "show amounts",
        "hide amounts",
        "waiting for accounts",
        "হিসাব",
        "ড্যাশবোর্ড",
        "ক্যাশ",
        "ব্যাংক ব্যালান্স",
        "বাজারে পাওনা",
        "দেনা",
        "উৎপাদনে টাকা",
        "নিট লাভ",
        "মোট লাভ",
        "টাকা লুকানো",
      ],
      routes: ["/accounts"],
      who: "যাঁরা হিসাবের খাতা দেখতে পারেন: Accounts ও Super Admin।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "মেনু থেকে “Accounts” খুলুন। “Overview” ট্যাবের ওপরে পাঁচটি কার্ড। পাশে কেউ দাঁড়িয়ে থাকলেও যাতে না দেখে, তাই পাতা খুললে সব টাকার অঙ্ক *** দেখায়। সব দেখতে ওপরের “Show amounts” চাপুন, আবার লুকাতে “Hide amounts”। শুধু একটি কার্ডের অঙ্ক দেখতে সেই কার্ডের কোণের ছোট চোখের চিহ্নে চাপুন। পাতা আবার খুললে সব আবার লুকানো থাকে।",
          image: {
            id: "accounts-overview-1",
            caption: "“Overview”: পাঁচটি কার্ড, অঙ্ক লুকানো, ওপরে “Show amounts”",
          },
        },
        {
          text: "“Cash & bank”: এখনই ব্যবসা যত টাকা খরচ করতে পারে, তার মোট। নিচে আলাদা করে “Hand cash” (হাতে নগদ), “Bank” ও “Mobile banking” (bKash, Nagad, Rocket)। কেন দরকার: আজ কত টাকা দেওয়া যাবে তা বুঝতে। কার্ডে চাপলে প্রতিটি অ্যাকাউন্টের ব্যালান্স দেখাবে; কোনো অ্যাকাউন্টে চাপলে তার স্টেটমেন্ট খুলবে।",
        },
        {
          text: "“Market due”: সব ক্রেতা মিলে আমাদের কাছে কত টাকা বাকি রেখেছেন, তাঁদের দেওয়া অগ্রিম বাদ দিয়ে। কেন দরকার: বাজার থেকে কত টাকা তুলতে হবে তা জানতে। কার্ডে চাপলে প্রথমে ক্রেতাদের নাম ও প্রত্যেকের বাকি (বেশি থেকে কম); দ্বিতীয়বার কোনো নামে চাপলে সেই ক্রেতার প্রোফাইল ও লেজার খুলবে।",
          image: {
            id: "accounts-overview-2",
            caption: "“Market due” চাপার পর ক্রেতাদের বাকির তালিকা",
          },
        },
        {
          text: "“Market payable”: সরবরাহকারী, ফ্যাক্টরি ও CMT-কে আমাদের কত টাকা দিতে হবে, আমাদের দেওয়া অগ্রিম বাদ দিয়ে। কেন দরকার: কাকে কবে কত দিতে হবে তার পরিকল্পনা করতে। কার্ডে চাপলে তাঁদের তালিকা; নামে চাপলে প্রোফাইল ও লেজার।",
        },
        {
          text: "“Inventory & WIP”: তৈরি মাল (খরচের দামে), কাঁচামাল আর উৎপাদনে আটকে থাকা টাকা মিলিয়ে মোট। WIP মানে Work in Progress: যে প্রজেক্টে টাকা খরচ হয়েছে কিন্তু মাল এখনো স্টকে আসেনি। কেন দরকার: মালে কত টাকা আটকে আছে তা বুঝতে। কার্ডে চাপলে দুই ভাগে দেখাবে: “Ready stock by category” (ক্যাটাগরি অনুযায়ী তৈরি মাল) আর “Money in production (WIP)” (প্রজেক্ট অনুযায়ী)। ক্যাটাগরিতে চাপলে তার পণ্য, প্রজেক্টে চাপলে প্রজেক্টের পাতা খুলবে।",
          image: {
            id: "accounts-overview-3",
            caption: "“Inventory & WIP”: বাঁয়ে ক্যাটাগরি অনুযায়ী মাল, ডানে প্রজেক্টের টাকা",
          },
        },
        {
          text: "“Net profit”: ওপরের বোতাম থেকে সময় বেছে নিন: “Today”, “This month”, “This year” (জুলাই থেকে শুরু হওয়া অর্থবছর) বা “Lifetime” (শুরু থেকে)। বড় অঙ্কটি নিট লাভ, অর্থাৎ সব খরচের পরে যা থাকে। নিচে “Gross profit” (বিক্রি থেকে মালের খরচ বাদ দিয়ে) ও “Sales”। সবুজ ↑ তীর মানে আগের সমান দিনগুলোর চেয়ে লাভ বেশি, লাল ↓ মানে কম, সঙ্গে কত শতাংশ।",
          image: {
            id: "accounts-overview-4",
            caption: "“Net profit” কার্ড: সময় বাছাই, তীর ও “Gross profit”",
          },
        },
        {
          text: "“Net profit” কার্ডে চাপলে “Most profitable” খুলবে: “Top profitable category” (কোন ক্যাটাগরিতে সবচেয়ে বেশি লাভ) আর “Top profitable buyer” (কোন ক্রেতার কাছে বিক্রিতে সবচেয়ে বেশি লাভ), প্রতিটির বিক্রি ও লাভের হার সহ।",
        },
        {
          text: "কার্ডগুলোর ঠিক নিচে “Expense breakdown”: মাস বা বছর বেছে বেতন, অফিসের খরচ, সম্পদ কেনা আর কোন সরবরাহকারীকে কত টাকা দেওয়া হলো (আলাদা নির্দেশিকা দেখুন)। তার নিচে “Waiting for Accounts” (অনুমোদন বাকি খরচের দাবি, দেওয়া বাকি বেতন, ঋণের কিস্তি) আর “What else the business holds and owes” (স্থায়ী সম্পদ, কর্মীদের অগ্রিম, “Buyer advances”, ঋণ ও বিনিয়োগকারী)। “Fixed assets”-এ চাপলে স্থায়ী সম্পদের তালিকা খোলে। এগুলোর অঙ্কও একইভাবে লুকানো থাকে।",
        },
        {
          text: "এখান থেকেই “Move money” (এক অ্যাকাউন্ট থেকে অন্যটিতে টাকা) ও “Pay a supplier” করা যায়।",
        },
      ],
      tips: [
        "চোখের চিহ্ন শুধু পর্দায় অঙ্ক লুকায়; কোনো হিসাব বা অনুমতি বদলায় না।",
        "“Market due” ক্রেতার অগ্রিম বাদ দিয়ে হিসাব করে, তাই ব্যালান্স শিটের পাওনা (Receivable) থেকে একটু আলাদা হতে পারে: ব্যালান্স শিট পাওনা ও অগ্রিম আলাদা দেখায়।",
        "“Most profitable”-এর লাভ ইনভয়েস থেকে আসে (ছাড়ের পরে, ফেরতের আগে), তাই লাভ-ক্ষতির রিপোর্ট থেকে সামান্য আলাদা হতে পারে। ওয়াক-ইন বিক্রি শুধু ক্যাটাগরিতে গোনা হয়।",
        "ক্রেতা বা সরবরাহকারীর নাম, ক্যাটাগরি বা প্রজেক্টে চাপ দিয়ে খোলা যাবে কি না, তা আপনার ভূমিকার অনুমতির ওপর নির্ভর করে।",
      ],
    },
    {
      slug: "accounts-expense-breakdown",
      title: "খরচের ভাগ (Expense breakdown): বেতন, অফিস খরচ, সম্পদ কেনা ও সরবরাহকারী দেখবেন যেভাবে",
      summary:
        "কোনো মাস বা পুরো বছর বেছে দেখুন কোন কর্মীকে কত বেতন দেওয়া হলো, ভাড়া ও বিদ্যুতের মতো অফিসের খরচ কত, কী কী সম্পদ কেনা হলো আর কোন সরবরাহকারীকে সবচেয়ে বেশি টাকা দেওয়া হলো।",
      keywords: [
        "expense breakdown",
        "operating expenses",
        "salary & payroll",
        "employee pay",
        "bonus",
        "qc bill",
        "administrative costs",
        "office rent",
        "electricity",
        "asset purchases",
        "vendor summary",
        "top suppliers",
        "খরচের ভাগ",
        "বেতন",
        "কর্মীর বেতন",
        "বোনাস",
        "অফিস খরচ",
        "অফিস ভাড়া",
        "বিদ্যুৎ বিল",
        "সম্পদ কেনা",
        "সরবরাহকারীকে পরিশোধ",
      ],
      routes: ["/accounts", "/accounts/salaries"],
      who: "যাঁরা হিসাবের খাতা দেখতে পারেন: Accounts ও Super Admin।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "“Accounts” > “Overview” খুলুন। পাঁচটি কার্ডের নিচে “Expense breakdown”। ডানের দুটি তালিকা থেকে মাস (বা “Whole year”) আর বছর বেছে নিন; চারটি অংশই সেই সময়ের হিসাব দেখাবে। পাতা খুললে এই মাস দেখায়। অঙ্কগুলো কার্ডের মতোই লুকানো থাকে: ওপরের “Show amounts” বা প্রতিটি অংশের কোণের চোখের চিহ্নে চাপুন।",
          image: {
            id: "accounts-expense-breakdown-1",
            caption: "“Expense breakdown”: মাস ও বছর বাছাই আর চারটি অংশ",
          },
        },
        {
          text: "“Salary & payroll”: অনুমোদিত বেতনের হিসাব (Payroll) থেকে প্রতিটি কর্মীর নিট বেতন, সঙ্গে কর্মীর নামে লেখা “Salaries” ধরনের অন্য খরচ (যেমন QC বিল)। বেতনের মাস ধরে গোনা হয়, টাকা যেদিনই দেওয়া হোক। নামের নিচে “not paid yet” মানে বেতন অনুমোদিত কিন্তু এখনো দেওয়া হয়নি। কারো নামে নয় এমন খরচ “Not in anyone's name” সারিতে।",
        },
        {
          text: "কোনো কর্মীর নামে চাপলে তাঁর বছরের বেতনের পাতা খোলে: মাসে মাসে “Basic”, “Allowances”, “Overtime”, “Bonus”, “Deductions”, “Net pay”, নামে লেখা অন্য খরচের আলাদা কলাম, “Total” আর কবে দেওয়া হলো (“Paid”)। ওপরে “Total paid to them”, “Net pay” ও “Not paid yet”। ওপরের বছরে চাপলে অন্য বছর, “Payslip”-এ চাপলে সেই মাসের পে-স্লিপ, “HR profile”-এ চাপলে কর্মীর প্রোফাইল।",
          image: {
            id: "accounts-expense-breakdown-2",
            caption: "একজন কর্মীর বছরের বেতন: মাসে মাসে মূল বেতন, বোনাস ও QC বিল",
          },
        },
        {
          text: "“Administrative costs”: অফিস ভাড়া, বিদ্যুৎ, মার্কেটিং, অফিসের জিনিস ইত্যাদি চলতি খরচ, খাত (Expense head) অনুযায়ী, বড় থেকে ছোট। শুধু খাতায় তোলা (অনুমোদিত) খরচ গোনা হয়। উৎপাদন ও কাঁচামালের খাত আর বেতন এখানে নেই, তাই কোনো খরচ দুবার গোনা হয় না। কোনো খাতে চাপলে সেই সময়ের ওই খাতের খরচের তালিকা খোলে; “All expenses” সব খরচ দেখায়।",
        },
        {
          text: "“Asset purchases”: এই সময়ে কেনা ল্যাপটপ, এসি, মেশিনের মতো স্থায়ী সম্পদ, কেনার দামে। এগুলো চলতি খরচ নয়, তাই আলাদা। নামে চাপলে সম্পদের পাতা; “Record an asset purchase” দিয়ে নতুন কেনা লিখুন আর “Fixed asset register” দিয়ে সব সম্পদ দেখুন (স্থায়ী সম্পদের নির্দেশিকা দেখুন)।",
        },
        {
          text: "“Vendor summary”: এই সময়ে যে সরবরাহকারী, ফ্যাক্টরি বা CMT-কে সবচেয়ে বেশি টাকা দেওয়া হয়েছে, ১, ২, ৩ করে সাজানো, প্রতিটির মোট টাকা ও কতবার। বাতিল (Reverse) করা পরিশোধ গোনা হয় না। নামে চাপলে তাঁর প্রোফাইল ও লেজার; “Supplier payments” সব পরিশোধের তালিকা দেখায়।",
        },
        {
          text: "প্রতিটি অংশে প্রথম পাঁচটি সারি দেখায়। বাকিগুলো দেখতে “Show all” চাপুন, আবার ছোট করতে “Show fewer”।",
        },
      ],
      tips: [
        "বছর বাছলে পুরো ক্যালেন্ডার বছর (জানুয়ারি থেকে ডিসেম্বর) দেখায়, অর্থবছর নয়।",
        "বেতন অংশে টাকা দেওয়া হোক বা না হোক, অনুমোদিত সব বেতন গোনা হয়; খসড়া (Draft) বেতন গোনা হয় না।",
        "কর্মীর নামে QC বিলের মতো খরচ দেখাতে খরচের খাতটির ধরন “Salaries” রাখুন আর খরচ লেখার সময় কর্মী বেছে নিন।",
        "সরবরাহকারীর নামে চাপ দিয়ে খোলা যাবে কি না, তা আপনার ভূমিকার অনুমতির ওপর নির্ভর করে।",
      ],
    },
    {
      slug: "accounts-fixed-assets",
      title:
        "স্থায়ী সম্পদ (Fixed assets): ল্যাপটপ, এসি বা মেশিন কেনা লিখবেন ও অবচয় পোস্ট করবেন যেভাবে",
      summary:
        "বছরের পর বছর ব্যবহারের জিনিস (ল্যাপটপ, এসি, মেশিন, আসবাব) কেনার হিসাব রাখা, প্রতি মাসে তাদের দাম কমা (অবচয় বা Depreciation) খাতায় তোলা, আর বিক্রি বা বাতিল হলে তা লেখা।",
      keywords: [
        "fixed assets",
        "fixed asset register",
        "asset purchase",
        "capital expenditure",
        "laptop",
        "machine",
        "depreciation",
        "sell or scrap",
        "book value",
        "স্থায়ী সম্পদ",
        "সম্পদ কেনা",
        "ল্যাপটপ",
        "এসি",
        "মেশিন",
        "অবচয়",
        "দাম কমা",
        "সম্পদ বিক্রি",
      ],
      routes: ["/accounts/assets"],
      who: "দেখতে পারেন যাঁরা হিসাবের খাতা দেখেন। সম্পদ যোগ, বদল, বিক্রি, বাদ দেওয়া ও অবচয় পোস্ট শুধু Accounts ও Super Admin।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "“Accounts” > “Overview”-এ “Fixed assets”-এ চাপুন, অথবা “Expense breakdown”-এর “Fixed asset register” লিংকে। ওপরে “Assets owned” (কয়টি), “Cost” (কেনার দাম), “Depreciation so far” (এ পর্যন্ত কত দাম কমেছে) আর “Value now” (এখনকার দাম)। “All”, “In use”, “Under repair” বা “Sold or scrapped” দিয়ে তালিকা ছোট করুন।",
          image: {
            id: "accounts-fixed-assets-1",
            caption: "“Fixed asset register”: চারটি মোট অঙ্ক আর সম্পদের তালিকা",
          },
        },
        {
          text: "নতুন কিছু কেনা হলে “Record an asset purchase” চাপুন। “What it is” (যেমন অফিসের Dell ল্যাপটপ), “Category (optional)” (তালিকা থেকে বেছে নিন বা নিজে লিখুন), “Where it is (optional)”, “Bought on” আর “Cost” দিন।",
        },
        {
          text: "“How it was bought” বেছে নিন। “Paid now”: কোন ক্যাশ, ব্যাংক বা ওয়ালেট থেকে টাকা গেছে বেছে নিন, তার ব্যালান্স কমবে। “On credit from a supplier”: “Owed to”-তে সরবরাহকারী বেছে নিন, দরকার হলে “Their bill number (optional)”; তাঁর কাছে দেনা বাড়বে, পরে “Pay a supplier” দিয়ে শোধ করুন। “Owned before we started these books”: এই সফটওয়্যার শুরুর আগে থেকেই যা ছিল; “Depreciation taken so far” আর “Day the books started” দিন।",
          image: {
            id: "accounts-fixed-assets-2",
            caption: "“Record an asset purchase”: কীভাবে কেনা হলো আর অবচয়ের হার",
          },
        },
        {
          text: "অবচয়ের অংশে “Rate (% a year)” দিন (যেমন ল্যাপটপ ২০, এসি ১০; জমি বা যার দাম কমে না, তার জন্য খালি রাখুন)। “How it loses value”-এ “The same amount every year” (প্রতি বছর সমান) বা “A share of what is left each year” (বাকি দামের একটি ভাগ) বেছে নিন। চাইলে “Worth at the end” দিন: এর নিচে দাম নামবে না। শেষে “Record the purchase” চাপুন।",
        },
        {
          text: "মাস শেষ হলে তালিকার ওপরে লেখা আসে “Depreciation up to … is not in the books yet”। “Post depreciation” চাপুন, কোন সম্পদের কত দাম কমছে দেখে নিশ্চিত করুন। টাকাটা লাভ-ক্ষতির হিসাবে খরচ হিসেবে যায়। একই মাস দুবার পোস্ট হয় না।",
          image: {
            id: "accounts-fixed-assets-3",
            caption: "“Post depreciation”: কোন সম্পদের কত দাম কমবে তার তালিকা",
          },
        },
        {
          text: "কোনো সম্পদের নামে চাপলে তার পাতা: “Cost”, “Depreciation so far”, “Value now”, “Depreciation a month”, “Details”-এ কীভাবে কেনা হয়েছিল, আর “In the books”-এ তার সব জার্নাল এন্ট্রি। নাম, জায়গা, হার বা অবস্থা (যেমন “Under repair”) বদলাতে “Change details” চাপুন।",
        },
        {
          text: "বিক্রি বা নষ্ট হলে “Sell or scrap” চাপুন: তারিখ, বিক্রি হলে “Sold for” আর “Money received into” (কোন অ্যাকাউন্টে টাকা এলো), আর “What happened”-এ কারণ লিখুন। এখনকার দামের চেয়ে বেশিতে বিক্রি হলে লাভ, কমে হলে ক্ষতি নিজে থেকেই হিসাবে যায়।",
        },
        {
          text: "ভুল করে যোগ করা সম্পদ বাদ দিতে “Remove” চাপুন আর কারণ লিখুন। তার কেনা ও অবচয়ের এন্ট্রি উল্টে যায় (দুটোই খাতায় থাকে), আর যে অ্যাকাউন্ট থেকে টাকা গিয়েছিল সেখানে ফেরত আসে।",
        },
      ],
      tips: [
        "কেনার দাম বা তারিখ পরে বদলানো যায় না। ভুল হলে “Remove” করে আবার ঠিকভাবে লিখুন।",
        "অবচয় দিন ধরে হিসাব হয়: মাসের মাঝে কিনলে সেই মাসের যতদিন ব্যবহার হয়েছে ততটুকু।",
        "বিক্রির টাকা নিতে টাকা গ্রহণের অনুমতি লাগে; তা না থাকলে শুধু বাতিল (scrap) লেখা যায়।",
        "বিক্রি বা বাতিল হওয়া সম্পদ খাতায় থেকে যায়, তাই সেটি আর “Remove” করা যায় না।",
      ],
    },
    {
      slug: "accounts-move-money",
      title: "এক অ্যাকাউন্ট থেকে অন্য অ্যাকাউন্টে টাকা সরাবেন যেভাবে",
      summary:
        "ক্যাশ ব্যাংকে জমা, ব্যাংক থেকে টাকা তোলা বা bKash থেকে ক্যাশ আউট, যাতে দুই অ্যাকাউন্টের ব্যালান্স ঠিক থাকে।",
      keywords: [
        "move money",
        "transfer",
        "deposit",
        "withdrawal",
        "cash out",
        "bkash cash out",
        "টাকা সরানো",
        "ট্রান্সফার",
        "ব্যাংকে জমা",
        "টাকা তোলা",
        "ক্যাশ আউট",
      ],
      routes: ["/accounts", "/accounts/cash-bank"],
      who: "শুধু Accounts ও Super Admin (টাকা গ্রহণ ও পরিশোধ দুটো অনুমতিই লাগে)।",
      anyOf: ["accounts.payments.record"],
      steps: [
        {
          text: "“Accounts” > “Overview” বা “Cash & bank” ট্যাবে “Move money” চাপুন।",
        },
        {
          text: "“From”-এ কোন অ্যাকাউন্ট থেকে টাকা যাচ্ছে আর “Into”-তে কোথায় যাচ্ছে বেছে নিন (যেমন ক্যাশ থেকে ব্যাংকে)।",
          image: {
            id: "accounts-move-money-1",
            caption: "“Move money” জানালা: “From”, “Into”, পরিমাণ ও “Date”",
          },
        },
        {
          text: "পরিমাণ, “Date”, দরকার হলে “Reference (optional)” (জমার স্লিপ নম্বর) ও “Notes (optional)” দিন।",
        },
        {
          text: "“Move the money” চাপুন। দুই অ্যাকাউন্টের ব্যালান্স বদলাবে, লাভে কোনো প্রভাব পড়বে না।",
        },
      ],
      tips: ["ভুল ট্রান্সফার জার্নাল থেকে “Reverse” করা যায় (জার্নালের নির্দেশিকা দেখুন)।"],
    },
    {
      slug: "accounts-pay-supplier",
      title: "সরবরাহকারীকে টাকা পরিশোধ করবেন যেভাবে",
      summary:
        "ফ্যাক্টরি, মিল বা অন্য সরবরাহকারীর বকেয়া বিল দেখে টাকা দেওয়া। পুরোনো বিল আগে শোধ হয়, চাইলে একটি প্রজেক্টের বিল আগে; বাড়তি টাকা অগ্রিম থাকে।",
      keywords: [
        "pay a supplier",
        "supplier payment",
        "payable",
        "open bills",
        "void the payment",
        "সরবরাহকারীকে টাকা",
        "সাপ্লায়ার পেমেন্ট",
        "বিল পরিশোধ",
        "দেনা শোধ",
        "ফ্যাক্টরিকে টাকা",
        "pay for a project",
        "প্রজেক্টের টাকা",
      ],
      routes: ["/accounts/supplier-payments/new", "/accounts/supplier-payments"],
      who: "শুধু Accounts ও Super Admin।",
      anyOf: ["accounts.payments.record"],
      steps: [
        {
          text: "“Accounts” > “Supplier payments” ট্যাবে “Pay a supplier” চাপুন।",
          image: {
            id: "accounts-pay-supplier-1",
            caption: "“Supplier payments” ট্যাবে পেমেন্টের তালিকা ও “Pay a supplier” বোতাম",
          },
        },
        {
          text: "“Supplier” বেছে নিন। “You owe them”-এ মোট দেনা আর “Open bills”-এ শোধ বাকি বিলগুলো দেখাবে।",
          image: {
            id: "accounts-pay-supplier-2",
            caption: "সরবরাহকারী বাছার পর মোট দেনা ও খোলা বিলের তালিকা",
          },
        },
        {
          text: "একটি নির্দিষ্ট প্রজেক্টের জন্য দিলে “Apply to a project (optional)” থেকে প্রজেক্ট বেছে নিন; না বাছলে “Oldest bills first” থাকে। প্রজেক্ট বাছলে টাকা আগে সেই প্রজেক্টের বিল শোধ করে, পরিমাণের ঘরে সেই প্রজেক্টের বাকি নিজে থেকে বসে যায়; বাড়তি টাকা পুরোনো বিলে যায়।",
        },
        {
          text: "পরিমাণ লিখুন। “Paid from”-এ কোন ক্যাশ, ব্যাংক বা ওয়ালেট থেকে দিচ্ছেন, “How”-এ কীভাবে (যেমন চেক) এবং “Reference (optional)”-এ চেক বা লেনদেন নম্বর দিন।",
        },
        {
          text: "“Paid on” তারিখ ও দরকার হলে নোট দিয়ে “Record the payment” চাপুন।",
        },
        {
          text: "ভুল পেমেন্ট হলে পেমেন্টের পাতায় “Void the payment” চাপুন।",
        },
      ],
      tips: [
        "টাকা সবচেয়ে পুরোনো বিল থেকে শুরু করে শোধ হয়। দেনার চেয়ে বেশি দিলে বাড়তিটা সরবরাহকারীর কাছে অগ্রিম হিসেবে থাকে।",
        "শুধু যে প্রজেক্টে এই সরবরাহকারীর কিছু বাকি আছে, সেগুলোই তালিকায় আসে; শেষ হওয়া প্রজেক্টের পাশে “(completed)” লেখা থাকে। তালিকায় প্রজেক্টের পেমেন্টে “for …” লেখা থাকে।",
        "সরবরাহকারীর প্রোফাইলের “Pay supplier” বা প্রজেক্টের পাশের “Pay for …” থেকেও এই ফর্ম খোলা যায়।",
        "তালিকা একজন সরবরাহকারী দিয়ে ছাঁকা যায়। সব দেখতে “All suppliers” বেছে নিন।",
      ],
    },
    {
      slug: "accounts-bank-accounts",
      title: "ব্যাংক অ্যাকাউন্ট যোগ করবেন ও স্টেটমেন্ট দেখবেন যেভাবে",
      summary:
        "কোম্পানির ব্যাংক অ্যাকাউন্ট যোগ করা, যেকোনো দিনের স্টেটমেন্ট ও মাসিক গড় ব্যালান্স দেখা, তথ্য বদলানো ও বন্ধ করা।",
      keywords: [
        "bank account",
        "add a bank account",
        "bank statement",
        "cash & bank",
        "wallet",
        "close the account",
        "ব্যাংক অ্যাকাউন্ট",
        "ব্যাংক স্টেটমেন্ট",
        "ওয়ালেট",
        "ক্যাশ",
        "গড় ব্যালান্স",
      ],
      routes: ["/accounts/cash-bank", "/accounts/cash-bank/new"],
      who: "দেখতে পারেন Accounts ও Super Admin। ব্যাংক অ্যাকাউন্ট যোগ, বদল ও বন্ধ করতে হিসাব সামলানোর অনুমতি লাগে।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "“Accounts” > “Cash & bank” ট্যাব খুলুন। “Cash and wallets” ও “Bank accounts” অংশে প্রতিটির আজকের ব্যালান্স দেখবেন।",
        },
        {
          text: "নতুন অ্যাকাউন্ট যোগ করতে “Add a bank account” চাপুন। “Bank”, “Branch (optional)”, “Name on the account”, “Account number”, “Routing number (optional)” ও “SWIFT code (optional)” দিন।",
          image: {
            id: "accounts-bank-accounts-1",
            caption: "“Add a bank account” ফর্ম: ব্যাংকের তথ্য ও “Balance brought forward”",
          },
        },
        {
          text: "“Balance brought forward”-এ Extas ERP শুরুর দিনে অ্যাকাউন্টে কত টাকা ছিল (“Money in the account”) এবং কোন তারিখে (“On”) দিন। ওভারড্রাফট থাকলে “Overdrawn” বেছে নিন। “Add the bank account” চাপুন।",
        },
        {
          text: "স্টেটমেন্ট দেখতে অ্যাকাউন্টে চাপুন। “From” ও “To” তারিখ দিয়ে “Opening balance”, “Deposits”, “Withdrawals”, “Closing balance” ও প্রতিটি লেনদেন দেখবেন। “Month by month”-এ প্রতি মাসের গড় ব্যালান্স থাকে।",
          image: {
            id: "accounts-bank-accounts-2",
            caption: "ব্যাংক অ্যাকাউন্টের পাতা: স্টেটমেন্ট ও “Month by month”",
          },
        },
        {
          text: "তথ্য বদলাতে “Change details”। অ্যাকাউন্ট বন্ধ করতে আগে সব টাকা অন্য অ্যাকাউন্টে সরান, তারপর “Close the account” চাপুন। দরকারে “Reopen”।",
        },
      ],
      tips: [
        "গড় ব্যালান্স হলো প্রতিদিনের শেষের ব্যালান্সের গড়, যা ব্যাংক দেখে।",
        "ব্যাংক স্টেটমেন্ট PDF হিসেবে ছাপা পরের ধাপে আসবে।",
        "খোলা ব্যাংক অ্যাকাউন্টগুলো প্রোফর্মা ইনভয়েসের “Bank details”-এ বেছে নেওয়া যায়; অ্যাকাউন্টের নাম, নম্বর, শাখা, রাউটিং ও SWIFT প্রোফর্মায় ছাপা হয়। বন্ধ অ্যাকাউন্ট নতুন প্রোফর্মায় আর দেখায় না।",
      ],
    },
    {
      slug: "accounts-expense-claim",
      title: "নিজের খরচের দাবি (Expense claim) পাঠাবেন যেভাবে",
      summary:
        "কোম্পানির কাজে নিজের পকেট থেকে খরচ করলে (যেমন যাতায়াত, খাবার) রসিদের ছবিসহ দাবি পাঠানো, যাতে Accounts টাকা ফেরত দেন।",
      keywords: [
        "expense claim",
        "claim",
        "new claim",
        "my expenses",
        "conveyance",
        "reimbursement",
        "receipt",
        "খরচের দাবি",
        "যাতায়াত খরচ",
        "কনভেয়েন্স",
        "টাকা ফেরত",
        "রসিদ",
        "বিল জমা",
      ],
      routes: ["/accounts/expenses/new", "/accounts/expenses"],
      who: "যাঁদের খরচ রেকর্ডের অনুমতি আছে: Sales Executive, Production Manager, Employee ও অন্যরা। তাঁরা শুধু নিজের দাবি দেখেন।",
      anyOf: ["expenses.create"],
      steps: [
        {
          text: "মেনু থেকে “Expenses” খুলুন (Accounts ও Super Admin-এর জন্য এটি Accounts-এর একটি ট্যাব)। “My expenses” পাতায় “New claim” চাপুন।",
          image: {
            id: "accounts-expense-claim-1",
            caption: "“My expenses” পাতায় নিজের দাবির তালিকা ও “New claim” বোতাম",
          },
        },
        {
          text: "“What for”-এ খরচের খাত বেছে নিন (যেমন Conveyance), পরিমাণ লিখুন এবং “Spent on”-এ খরচের তারিখ দিন।",
        },
        {
          text: "“How it was paid”-এ নিজের টাকায় দিলে “I paid it” বেছে নিন। দোকান বা সরবরাহকারী পরে বিল নেবে হলে “Owed to a supplier”।",
        },
        {
          text: "যাতায়াত বা খাবারের মতো খাতে “Employee”, “Purpose”, আর যাতায়াতে “From (optional)” ও “To (optional)” (কোথা থেকে কোথায়) দিন।",
          image: {
            id: "accounts-expense-claim-2",
            caption: "দাবির ফর্ম: খাত, পরিমাণ, “I paid it”, যাত্রাপথ ও রসিদের ছবি",
          },
        },
        {
          text: "“Details (optional)” লিখুন এবং “Receipt or memo photo (optional)”-এ রসিদ বা মেমোর ছবি তুলে দিন।",
        },
        {
          text: "“Send the claim” চাপুন। Accounts অনুমোদন করলে টাকা পাবেন। অপেক্ষার সময় দাবি বদলানো যায়, বা “Withdraw the claim” দিয়ে ফিরিয়ে নেওয়া যায়।",
        },
      ],
      tips: [
        "আপনার কাছে কোম্পানির দেওয়া অগ্রিম থাকলে Accounts সাধারণত আগে সেখান থেকে কেটে নেন।",
        "অনুমোদিত দাবি আর বদলানো যায় না।",
      ],
    },
    {
      slug: "accounts-record-expense",
      title: "অফিসের খরচ (ভাড়া, বিদ্যুৎ…) রেকর্ড করবেন যেভাবে",
      summary:
        "ভাড়া, বিদ্যুৎ, ইন্টারনেট, যাতায়াতের মতো চলমান খরচ সঙ্গে সঙ্গে পরিশোধ বা সরবরাহকারীর কাছে বকেয়া হিসেবে লেখা।",
      keywords: [
        "record an expense",
        "expense",
        "rent",
        "utilities",
        "bill",
        "petty cash",
        "খরচ",
        "অফিস খরচ",
        "ভাড়া",
        "বিদ্যুৎ বিল",
        "খরচ লেখা",
      ],
      routes: ["/accounts/expenses/new", "/accounts/expenses"],
      who: "Accounts ও Super Admin। যাঁদের সঙ্গে সঙ্গে পরিশোধের অনুমতি নেই, তাঁদের খরচ দাবি হিসেবে অপেক্ষায় থাকে।",
      anyOf: ["accounts.payments.record", "expenses.manage"],
      steps: [
        {
          text: "“Accounts” > “Expenses” ট্যাবে “Record an expense” চাপুন।",
          image: {
            id: "accounts-record-expense-1",
            caption: "“Expenses” ট্যাবে তালিকা, ছাঁকনি ও “Record an expense” বোতাম",
          },
        },
        {
          text: "“What for”-এ খাত, পরিমাণ ও “Spent on” তারিখ দিন।",
        },
        {
          text: "“How it was paid”-এ “Paid now” বেছে নিলে কোন ক্যাশ, ব্যাংক বা ওয়ালেট থেকে দেওয়া হলো বেছে নিন। পরে দেওয়া হবে হলে “Owed to a supplier” বেছে “Owed to” ও “Their bill number (optional)” দিন।",
        },
        {
          text: "দরকার হলে বিবরণ ও রসিদের ছবি দিয়ে “Record the expense” চাপুন।",
        },
        {
          text: "তালিকায় খোঁজা যায় এবং “Status”, “Head” ও “Only the ones I recorded” দিয়ে ছাঁকা যায়। ভুল খরচ খরচের পাতা থেকে “Void” করুন।",
        },
      ],
    },
    {
      slug: "accounts-approve-claims",
      title: "কর্মীদের খরচের দাবি অনুমোদন বা বাতিল করবেন যেভাবে",
      summary:
        "অপেক্ষায় থাকা দাবি দেখে টাকা ফেরত দিয়ে অনুমোদন করা (আগে কর্মীর অগ্রিম থেকে), অথবা ফিরিয়ে দেওয়া।",
      keywords: [
        "approve",
        "approve and pay back",
        "turn it down",
        "claims",
        "pending claims",
        "দাবি অনুমোদন",
        "অনুমোদন",
        "বাতিল",
        "টাকা ফেরত দেওয়া",
      ],
      routes: ["/accounts/expenses"],
      who: "শুধু Accounts ও Super Admin।",
      anyOf: ["accounts.payments.record", "expenses.manage"],
      steps: [
        {
          text: "“Accounts” > “Expenses” ট্যাবে “Status” থেকে “Waiting for Accounts” বেছে নিন। Overview-এর “Expense claims”-এ চাপলেও এখানে আসবেন।",
        },
        {
          text: "দাবিতে চাপুন। খাত, কর্মী, উদ্দেশ্য, যাত্রাপথ ও রসিদ (“Receipt”) মিলিয়ে দেখুন।",
        },
        {
          text: "ঠিক থাকলে “Approve and pay back” চাপুন। কোন অ্যাকাউন্ট থেকে দেবেন ও “Paid on” তারিখ দিন। কর্মীর অগ্রিম থাকলে “Take it from … advance first” টিক রাখুন। “Approve and pay” চাপুন।",
          image: {
            id: "accounts-approve-claims-1",
            caption: "“Approve and pay back” জানালা: অ্যাকাউন্ট, তারিখ ও অগ্রিম থেকে কাটার টিক",
          },
        },
        {
          text: "ঠিক না থাকলে “Turn it down” চাপুন, “Reason”-এ কারণ লিখে আবার “Turn it down” চাপুন। যিনি দাবি পাঠিয়েছেন তিনি কারণটি দেখতে পাবেন।",
        },
      ],
      tips: ["অনুমোদিত খরচ হিসাবের খাতায় যায়। ভুল হলে “Void” করতে হয়, মোছা যায় না।"],
    },
    {
      slug: "accounts-expense-heads",
      title: "খরচের খাত (Expense heads) সাজাবেন যেভাবে",
      summary: "খরচ কোন খাতে যাবে (যেমন জেনারেটরের তেল), সেই খাত যোগ, বদল, আর্কাইভ ও ফিরিয়ে আনা।",
      keywords: [
        "expense heads",
        "expense head",
        "add an expense head",
        "category",
        "খরচের খাত",
        "খাত",
        "হেড",
      ],
      routes: ["/accounts/expenses/heads"],
      who: "Accounts ও Super Admin।",
      anyOf: ["accounts.manage", "expenses.manage"],
      steps: [
        {
          text: "“Accounts” > “Expenses” ট্যাবে “Expense heads” চাপুন।",
        },
        {
          text: "“Add an expense head” চাপুন। “Name” (যেমন Generator fuel), “Kind” ও “Posts to” (হিসাবের কোন খাতে যাবে) দিয়ে “Add it” চাপুন।",
          image: {
            id: "accounts-expense-heads-1",
            caption: "“Add an expense head” জানালা: “Name”, “Kind”, “Posts to”",
          },
        },
        {
          text: "যাতায়াত ও খাবারের মতো খাতে প্রতিটি খরচে কর্মী ও উদ্দেশ্য লিখতে হয়, আর কর্মীর অগ্রিম থেকে আগে কাটা হয়।",
        },
        { text: "বদলাতে “Change”, আর না লাগলে “Archive”, আবার লাগলে “Restore”।" },
      ],
    },
    {
      slug: "accounts-journal",
      title: "জার্নাল দেখবেন ও ভুল এন্ট্রি উল্টাবেন (Reverse) যেভাবে",
      summary:
        "বিক্রি, পেমেন্ট, বিল ও খরচ থেকে তৈরি প্রতিটি হিসাব-এন্ট্রি খোঁজা, তার লাইন দেখা আর ভাউচার বা ট্রান্সফার উল্টানো।",
      keywords: [
        "journal",
        "journal entry",
        "voucher",
        "reverse",
        "debit",
        "credit",
        "জার্নাল",
        "এন্ট্রি",
        "ভাউচার",
        "ডেবিট",
        "ক্রেডিট",
        "রিভার্স",
      ],
      routes: ["/accounts/journal"],
      who: "দেখতে পারেন Accounts ও Super Admin। উল্টাতে হিসাব সামলানোর অনুমতি লাগে।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "“Accounts” > “Journal” ট্যাব খুলুন। ভাউচার নম্বর বা বিবরণ দিয়ে খুঁজুন, “Made by” দিয়ে বেছে নিন কী থেকে তৈরি (বিক্রি, পেমেন্ট, বিল, খরচ, ভাউচার…)।",
          image: {
            id: "accounts-journal-1",
            caption: "“Journal” ট্যাবে খোঁজার ঘর, “Made by” বাছাই ও এন্ট্রির তালিকা",
          },
        },
        {
          text: "এন্ট্রিতে চাপলে তার লাইনগুলো দেখবেন: “Account”, “Buyer, supplier or note”, “Debit” ও “Credit”। “About this entry”-তে কোন রেকর্ড থেকে তৈরি তা খোলা যায়।",
        },
        {
          text: "হাতে লেখা ভাউচার বা টাকা সরানোর এন্ট্রি ভুল হলে “Reverse” চাপুন, “Date of the reversal” দিয়ে “Reverse it” চাপুন। একটি উল্টো এন্ট্রি তৈরি হবে, দুটোই খাতায় থাকবে।",
        },
      ],
      tips: [
        "বিক্রি, বিল বা পেমেন্ট থেকে তৈরি এন্ট্রি এখানে উল্টানো যায় না। সেগুলো নিজ নিজ পাতায় বাতিল (Void) করুন, যেমন বিল বাতিল করুন।",
      ],
    },
    {
      slug: "accounts-voucher",
      title: "জার্নাল ভাউচার হাতে লিখবেন যেভাবে",
      summary:
        "অন্য কোনো পাতায় পড়ে না এমন লেনদেন (যেমন বাড়িওয়ালার ফেরত দেওয়া জামানত) ডেবিট ও ক্রেডিট লাইন দিয়ে লেখা।",
      keywords: [
        "journal voucher",
        "new journal voucher",
        "manual entry",
        "jv",
        "adjustment",
        "জার্নাল ভাউচার",
        "ভাউচার",
        "সমন্বয়",
        "হাতে এন্ট্রি",
      ],
      routes: ["/accounts/journal/new"],
      who: "শুধু Accounts ও Super Admin (হিসাব সামলানোর অনুমতি)।",
      anyOf: ["accounts.manage"],
      steps: [
        { text: "“Accounts” > “Journal” ট্যাবে “New journal voucher” চাপুন।" },
        {
          text: "“What it is for”-এ ভাউচারের কারণ এবং “Date” দিন।",
        },
        {
          text: "“Lines”-এ প্রতিটি লাইনে “Account” বেছে ডেবিট অথবা ক্রেডিটে পরিমাণ লিখুন, দুটোতে নয়। পাওনা বা দেনার অ্যাকাউন্ট হলে ক্রেতা বা সরবরাহকারীর নামও দিন। আরও লাইন যোগ করতে “Add a line”।",
          image: {
            id: "accounts-voucher-1",
            caption: "ভাউচারের লাইন এবং নিচে “Debits”, “Credits” ও “Difference”",
          },
        },
        {
          text: "নিচে “Debits” ও “Credits” সমান হলে “Difference” শূন্য হবে। তখন “Post the voucher” চাপুন।",
        },
      ],
      tips: ["অন্তত দুটি লাইন লাগে এবং মোট ডেবিট ও মোট ক্রেডিট সমান হতে হবে।"],
    },
    {
      slug: "accounts-chart",
      title: "হিসাবের তালিকা (Chart of accounts) ও লেজার দেখবেন যেভাবে",
      summary:
        "প্রতিটি হিসাব-খাতের আজকের ব্যালান্স ও লেজার দেখা, নতুন খাত যোগ, নাম বদল, আর্কাইভ আর শুরুর ব্যালান্স দেওয়া।",
      keywords: [
        "chart of accounts",
        "ledger",
        "add an account",
        "balance brought forward",
        "opening balance",
        "archive",
        "হিসাবের তালিকা",
        "লেজার",
        "খতিয়ান",
        "শুরুর ব্যালান্স",
      ],
      routes: ["/accounts/chart"],
      who: "দেখতে পারেন Accounts ও Super Admin। যোগ ও বদল করতে হিসাব সামলানোর অনুমতি লাগে।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "“Accounts” > “Chart of accounts” ট্যাবে সব হিসাব-খাত ধরন অনুযায়ী আজকের ব্যালান্সসহ দেখবেন। আর্কাইভ করা খাত দেখতে “Show archived accounts”।",
        },
        {
          text: "কোনো খাতে চাপলে তার “Ledger” খুলবে: যেকোনো দিনের “Opening balance”, “Debits”, “Credits”, “Closing balance” আর প্রতিটি লেনদেন।",
          image: {
            id: "accounts-chart-1",
            caption: "একটি হিসাব-খাতের লেজার: সারাংশ ও লেনদেনের তালিকা",
          },
        },
        {
          text: "নতুন খাত যোগ করতে “Add an account” চাপুন, “Name”, “Kind” ও দরকার হলে “Code (optional)” দিয়ে “Add it” চাপুন।",
        },
        {
          text: "খাতের পাতায় “Rename” দিয়ে নাম বদলান, খালি খাত “Archive” করুন, আর “Balance brought forward” দিয়ে Extas ERP শুরুর আগের ব্যালান্স ও “As of” তারিখ দিন।",
        },
      ],
      tips: ["ব্যাংক অ্যাকাউন্ট, ঋণ ও স্থায়ী সম্পদ রেকর্ড করলে তাদের খাত নিজে থেকে তৈরি হয়।"],
    },
    {
      slug: "accounts-profit-and-loss",
      title: "লাভ-ক্ষতির হিসাব (Profit and loss) দেখবেন যেভাবে",
      summary:
        "যেকোনো সময়ের বিক্রি, বিক্রিত মালের খরচ, অন্যান্য খরচ আর নিট লাভ, চাইলে মাস অনুযায়ী।",
      keywords: [
        "profit and loss",
        "p&l",
        "income statement",
        "net profit",
        "gross profit",
        "cost of sales",
        "লাভ ক্ষতি",
        "লাভ-ক্ষতি",
        "নিট লাভ",
        "মোট লাভ",
        "আয় ব্যয়",
        "inventory loss",
        "স্টকের ক্ষতি",
      ],
      routes: ["/accounts/reports/profit-and-loss", "/accounts/reports"],
      who: "Accounts ও Super Admin।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "“Accounts” > “Reports” ট্যাবে “Profit and loss” চাপুন।",
          image: {
            id: "accounts-profit-and-loss-1",
            caption: "“Financial reports” পাতায় চারটি রিপোর্টের কার্ড",
          },
        },
        {
          text: "উপরে সময় বেছে নিন: এ মাস, গত মাস, এই বা গত অর্থবছর, গত ১২ মাস, অথবা “From” ও “To” দিয়ে “Show these days”। মাস অনুযায়ী দেখতে “Show month by month” চাপুন।",
        },
        {
          text: "রিপোর্টে “Sales”, “Cost of sales”, “Gross profit”, “Other income”, “Expenses” ও “Net profit” দেখবেন। যেকোনো খাতে চাপলে তার লেজার খুলবে।",
          image: {
            id: "accounts-profit-and-loss-2",
            caption: "লাভ-ক্ষতির রিপোর্ট ও মাসভিত্তিক টেবিল",
          },
        },
      ],
      tips: [
        "রিপোর্ট সরাসরি হিসাবের খাতা থেকে তৈরি হয়, তাই সবসময় হালনাগাদ থাকে।",
        "রিপোর্ট PDF বা Excel হিসেবে রাখতে Reports & documents-এর Report Builder ব্যবহার করুন।",
        "স্টক গণনায় কম পাওয়া পিস আর নষ্ট ও QC-তে বাতিল মালের দাম নিজে থেকেই “Inventory Loss” (5150) খাতে যায়, “Expenses”-এর ক্ষতির অংশে আলাদা লাইনে দেখায়। অক্টোবর ২০২৬-এর আগের এমন ক্ষতি আগের মতো “Production & Inventory Losses” (5100) খাতে থাকে।",
      ],
    },
    {
      slug: "accounts-balance-sheet",
      title: "ব্যালান্স শিট ও ট্রায়াল ব্যালান্স দেখবেন যেভাবে",
      summary:
        "যেকোনো দিনের শেষে ব্যবসার সম্পদ, দেনা ও মালিকের অংশ, আর প্রতিটি খাতের ডেবিট-ক্রেডিট ব্যালান্স।",
      keywords: [
        "balance sheet",
        "trial balance",
        "assets",
        "liabilities",
        "equity",
        "ব্যালান্স শিট",
        "ট্রায়াল ব্যালান্স",
        "সম্পদ",
        "দায়",
        "মালিকানা",
      ],
      routes: ["/accounts/reports/balance-sheet", "/accounts/reports/trial-balance"],
      who: "Accounts ও Super Admin।",
      anyOf: ["accounts.view"],
      steps: [
        {
          text: "“Accounts” > “Reports” ট্যাবে “Balance sheet” চাপুন। “At the end of”-এ দিন বেছে নিন (আজকের জন্য “Today”)।",
        },
        {
          text: "“What the business owns”-এ সম্পদ, আর “What it owes, and the owners' share”-এ দেনা ও মালিকের অংশ। নিচে “Total assets” ও “Liabilities and equity” সমান থাকে।",
          image: {
            id: "accounts-balance-sheet-1",
            caption: "ব্যালান্স শিট: সম্পদ এবং দেনা ও মালিকের অংশ",
          },
        },
        {
          text: "হিসাবরক্ষকের জন্য “Trial balance” খুলুন। প্রতিটি খাতের “Debit” বা “Credit” ব্যালান্স এবং নিচে “Total debits” ও “Total credits” দেখাবে।",
        },
      ],
    },
    {
      slug: "accounts-books-check",
      title: "হিসাব ঠিক আছে কি না যাচাই (Books check) করবেন যেভাবে",
      summary:
        "জার্নাল মিলছে কি না, আর স্টক, কাঁচামাল, সম্পদ, ঋণ ও বেতনের হিসাব খাতার সঙ্গে মিলছে কি না তা পরীক্ষা।",
      keywords: [
        "books check",
        "reconcile",
        "check",
        "difference",
        "mismatch",
        "হিসাব যাচাই",
        "মেলানো",
        "গরমিল",
        "পার্থক্য",
      ],
      routes: ["/accounts/reports/books-check"],
      who: "Accounts ও Super Admin।",
      anyOf: ["accounts.view"],
      steps: [
        { text: "“Accounts” > “Reports” ট্যাবে “Books check” চাপুন।" },
        {
          text: "প্রতিটি পরীক্ষায় “In the books” (খাতায়), “In the register” (স্টক, সম্পদ বা বেতনের তালিকায়) ও “Difference” দেখবেন।",
          image: {
            id: "accounts-books-check-1",
            caption: "“Books check” পাতা: প্রতিটি পরীক্ষা ও “Difference”",
          },
        },
        {
          text: "“Difference” শূন্য না হলে কোথাও গরমিল আছে। যে খাতে পার্থক্য, তার লেজার খুলে খুঁজে দেখুন, বা অ্যাডমিনকে জানান।",
        },
      ],
    },
  ],
};
