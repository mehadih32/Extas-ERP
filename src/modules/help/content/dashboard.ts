import type { HelpSection } from "../types";

/** The dashboard: the key figures and the Insights (top sellers and stock alerts). */
export const dashboardHelp: HelpSection = {
  id: "dashboard",
  title: "ড্যাশবোর্ড (Dashboard)",
  description:
    "সাইন ইন করলেই প্রথমে যে পাতা খোলে: ব্যবসার মূল হিসাব, কোন পণ্য বেশি বিক্রি হচ্ছে আর কোন স্টক আটকে আছে বা ফুরিয়ে আসছে।",
  href: "/",
  articles: [
    {
      slug: "dashboard-key-figures",
      title: "মূল হিসাবগুলো (Key figures) পড়বেন যেভাবে",
      summary:
        "স্টকের মূল্য, স্থায়ী সম্পদ, দেনা, আজকের বিক্রি ও এ মাসের নিট লাভের কার্ডগুলো বোঝা।",
      keywords: [
        "dashboard",
        "key figures",
        "stock value",
        "fixed assets",
        "liabilities",
        "today's sales",
        "net profit",
        "ড্যাশবোর্ড",
        "আজকের বিক্রি",
        "লাভ",
        "নিট লাভ",
        "স্টকের মূল্য",
        "দেনা",
      ],
      routes: ["/"],
      who: "যাঁরা আর্থিক হিসাব দেখতে পারেন, যেমন Super Admin ও Accounts। অন্যদের পর্দায় এই কার্ডগুলো আসে না।",
      anyOf: ["dashboard.financials", "accounts.view"],
      steps: [
        {
          text: "মেনুর “Dashboard”-এ চাপুন, অথবা উপরের “Extas ERP” লেখায় চাপুন। “Key figures” অংশে পাঁচটি কার্ড দেখবেন।",
          image: {
            id: "dashboard-key-figures-1",
            caption: "ড্যাশবোর্ডের “Key figures” অংশে পাঁচটি কার্ড",
          },
        },
        {
          text: "“Total active stock value”: বিক্রির জন্য তৈরি মালের মূল্য, গড় খরচে। নিচে A grade ও B grade-এর পিস ও মূল্য, কাঁচামাল (“Raw materials”), চলমান উৎপাদন (“Work in progress”) এবং সব মিলিয়ে “All stock held”।",
        },
        {
          text: "“Fixed assets”: মেশিন, আসবাব ইত্যাদির কেনা দাম থেকে অবচয় বাদে মূল্য। “Liabilities (loans / investors)”: ঋণদাতা ও বিনিয়োগকারীদের পাওনা।",
        },
        {
          text: "“Today's sales”: আজকের বিক্রি, ইনভয়েস ও পিসের সংখ্যা, আর গতকালের সঙ্গে তুলনা। “Net profit (this month)”: এ মাসের নিট লাভ, সঙ্গে গত মাস ও এই অর্থবছরের হিসাব।",
        },
        {
          text: "কোনো কার্ড পাশে কেউ দেখে ফেলুক না চাইলে কার্ডের চোখের আইকনে চাপুন (“Hide figure”)। সব কার্ড একসঙ্গে লুকাতে “Hide all figures” চাপুন। আবার দেখাতে “Show figure” বা “Show all figures”।",
          image: {
            id: "dashboard-key-figures-2",
            caption: "কার্ডের কোণে চোখের আইকন ও “Hide all figures” বোতাম",
          },
        },
      ],
      tips: [
        "লুকানো কার্ড শুধু আপনার পর্দায় লুকায়, অন্য কারও পর্দায় নয়, আর আপনার সব ফোন ও কম্পিউটারে মনে থাকে।",
        "সংখ্যাগুলো হিসাবের খাতা (Accounts) থেকে আসে। কোনো সংখ্যা অদ্ভুত লাগলে Accounts-এর “Reports” ট্যাবে “Books check” দেখুন।",
      ],
    },
    {
      slug: "dashboard-top-sellers",
      title: "কোন পণ্য বেশি বিক্রি হচ্ছে (Top sellers) দেখবেন যেভাবে",
      summary:
        "যেকোনো সময়ের জন্য সবচেয়ে বেশি বিক্রি হওয়া SKU বা স্টাইল, পিস বা বিক্রির টাকায় সাজিয়ে দেখা।",
      keywords: [
        "top sellers",
        "best selling",
        "insights",
        "sku",
        "style",
        "by pieces",
        "by sales value",
        "বেশি বিক্রি",
        "সেরা বিক্রি",
        "জনপ্রিয় পণ্য",
        "টপ সেলার",
      ],
      routes: ["/"],
      who: "যাঁরা ড্যাশবোর্ড বা স্টক দেখতে পারেন (Super Admin, Accounts, Sales Executive, Warehouse Team, Production Manager)। বিক্রির টাকা ও মার্জিন শুধু যাঁদের সেই অনুমতি আছে তাঁরা দেখেন।",
      anyOf: ["dashboard.view", "inventory.view"],
      steps: [
        {
          text: "ড্যাশবোর্ডের নিচে “Insights” অংশে “Top sellers” ট্যাব খুলুন।",
          image: {
            id: "dashboard-top-sellers-1",
            caption: "“Insights” অংশের “Top sellers” ট্যাব ও উপরের বাছাইগুলো",
          },
        },
        {
          text: "“Period” থেকে সময় বেছে নিন: “Today”, “Past 7 days”, “This month”, “Last month”, “This financial year” ইত্যাদি।",
        },
        {
          text: "“Show”-এ “By SKU” (প্রতিটি রং ও সাইজ আলাদা) অথবা “By style” (পুরো স্টাইল একসঙ্গে) বেছে নিন।",
        },
        {
          text: "“Rank by”-এ “By pieces” (কত পিস বিক্রি) অথবা “By sales value” (কত টাকার বিক্রি) বেছে নিন।",
        },
        {
          text: "তালিকায় দেখবেন “Pieces”, “Share”, আর অনুমতি থাকলে “Net sales”, “Avg price” ও “Margin”, সঙ্গে “In stock” কত আছে।",
        },
      ],
      tips: [
        "বাছাইগুলো পাতার ঠিকানায় থাকে, তাই লিংক কাউকে পাঠালে তিনিও একই তালিকা দেখবেন।",
        "“No sales in this period” এলে আরও লম্বা সময় বেছে নিন।",
      ],
    },
    {
      slug: "dashboard-stock-alerts",
      title: "স্টকের সতর্কতা (বেশি, অচল, ধীর ও কম স্টক) দেখবেন যেভাবে",
      summary:
        "কোন SKU-র স্টক সবচেয়ে বেশি, কোনটি একদম বিক্রি হচ্ছে না বা ধীরে বিক্রি হচ্ছে, আর কোনটি ফুরিয়ে আসছে তা দেখা।",
      keywords: [
        "highest stock",
        "dead stock",
        "slow stock",
        "low stock",
        "dead & slow",
        "stock alert",
        "days of cover",
        "অচল স্টক",
        "ধীর বিক্রি",
        "কম স্টক",
        "স্টক ফুরিয়ে",
        "বেশি স্টক",
      ],
      routes: ["/"],
      who: "যাঁরা ড্যাশবোর্ড বা স্টক দেখতে পারেন।",
      anyOf: ["dashboard.view", "inventory.view"],
      steps: [
        {
          text: "“Insights” অংশে “Highest stock” ট্যাবে দেখবেন কোন SKU সবচেয়ে বেশি পিস ধরে রেখেছে: “Available”, “A grade”, “B grade” ও “Reserved”।",
        },
        {
          text: "“Dead & slow” ট্যাবে “Dead stock” মানে যে মাল অনেক দিন আগে স্টকে এসেছে কিন্তু তারপর একটিও বিক্রি হয়নি। “Slow stock” মানে এখনকার বিক্রির গতিতে যে মাল শেষ হতে অনেক দিন লাগবে।",
          image: {
            id: "dashboard-stock-alerts-1",
            caption: "“Dead & slow” ট্যাব: “Dead stock” ও “Slow stock” সারাংশ এবং তালিকা",
          },
        },
        {
          text: "তালিকায় “Days of cover” বলে এখনকার গতিতে স্টক কত দিন চলবে, আর “Last sold” বলে শেষ কবে বিক্রি হয়েছে।",
        },
        {
          text: "“Low stock” ট্যাবে সেই SKU-গুলো দেখবেন যেগুলোর স্টক কোম্পানির ঠিক করা সীমার নিচে নেমেছে, স্টক শেষ হওয়াগুলোসহ। এগুলো আবার তৈরি বা কেনার কথা ভাবুন।",
          image: {
            id: "dashboard-stock-alerts-2",
            caption: "“Low stock” ট্যাবে সীমার নিচে নামা SKU-র তালিকা",
          },
        },
      ],
      tips: [
        "কম স্টকের সীমা Settings-এর “Company” ট্যাবে “Low stock alert at” ঘরে ঠিক করা হয়।",
        "“Everything is moving” বা “Nothing is running low” এলে বুঝবেন এখন কোনো সতর্কতা নেই।",
      ],
    },
    {
      slug: "dashboard-empty",
      title: "ড্যাশবোর্ড ফাঁকা দেখালে কী বুঝবেন",
      summary: "“Nothing to show here yet” লেখা কেন আসে এবং কী করবেন।",
      keywords: [
        "nothing to show",
        "empty dashboard",
        "no figures",
        "access",
        "ফাঁকা",
        "কিছু দেখাচ্ছে না",
        "অনুমতি",
      ],
      routes: ["/"],
      who: "যাঁদের ভূমিকায় ড্যাশবোর্ডের হিসাব নেই, যেমন Employee।",
      steps: [
        {
          text: "ড্যাশবোর্ডে “Nothing to show here yet” লেখা থাকলে বুঝবেন আপনার ভূমিকায় ড্যাশবোর্ডের হিসাব দেখার অনুমতি নেই। এটা কোনো সমস্যা নয়।",
        },
        {
          text: "আপনার কাজের অংশগুলো মেনুতে পাবেন, যেমন “My HR”, “Planner” বা “Expenses”।",
        },
        { text: "হিসাব দেখা দরকার হলে অ্যাডমিনকে আপনার ভূমিকায় অনুমতি দিতে বলুন।" },
      ],
    },
  ],
};
