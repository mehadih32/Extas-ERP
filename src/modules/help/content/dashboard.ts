import type { HelpSection } from "../types";

/**
 * The dashboard (the Home screen): the top bar (pending tasks, the period, the
 * eye and the (+) quick actions), the monthly sales target, The Pulse, the key
 * figures and the Insights (top sellers and stock alerts).
 */
export const dashboardHelp: HelpSection = {
  id: "dashboard",
  title: "ড্যাশবোর্ড (Dashboard)",
  description:
    "সাইন ইন করলেই প্রথমে যে পাতা খোলে: আজকের বাকি কাজ, দ্রুত কাজের (+) বোতাম, মাসের বিক্রির লক্ষ্য, বিক্রি-আদায়-ডেলিভারি-উৎপাদনের গতি, ব্যবসার মূল হিসাব, কোন পণ্য বেশি বিক্রি হচ্ছে আর কোন স্টক আটকে আছে বা ফুরিয়ে আসছে।",
  href: "/",
  articles: [
    {
      slug: "dashboard-home-top-bar",
      title: "হোম স্ক্রিনের উপরের অংশ: আজকের কাজ, সময় বাছাই, চোখ ও (+) বোতাম",
      summary:
        "আজ কয়টি কাজ বাকি দেখা, “Today”, “This week” ও “This month”-এর হিসাব বাছাই, টাকার অঙ্ক দেখানো বা লুকানো, আর (+) বোতাম থেকে দ্রুত নতুন অর্ডার, পেমেন্ট, কোটেশন, খরচ বা খালি প্যাড তৈরি।",
      keywords: [
        "home",
        "top bar",
        "pending tasks",
        "quick actions",
        "new order",
        "receive payment",
        "new expense",
        "letterhead",
        "blank pad",
        "show amounts",
        "this week",
        "হোম",
        "আজকের কাজ",
        "বাকি কাজ",
        "দ্রুত কাজ",
        "প্লাস বোতাম",
        "খালি প্যাড",
        "টাকা লুকানো",
      ],
      routes: ["/"],
      who: "সবাই। (+) বোতামের তালিকায় শুধু সেই কাজগুলো আসে যা আপনার ভূমিকায় করা যায়। “Receive payment” শুধু Accounts ও Super Admin দেখেন।",
      steps: [
        {
          text: "হোম স্ক্রিনে শুভেচ্ছার নিচে লেখা থাকে আজ আপনার কয়টি কাজ বাকি: আজকের ও আগের দিনের শেষ না হওয়া কাজ আর রিমাইন্ডার, Planner-এর তালিকা থেকে। সংখ্যাটিতে চাপলে Planner খোলে। কিছু বাকি না থাকলে লেখা থাকে “Nothing is pending for today.”",
        },
        {
          text: "শুভেচ্ছার নিচের বারটি স্ক্রিন নিচে নামালেও উপরে আটকে থাকে। বাঁ দিকে সময় বাছাই: “Today”, “This week” (শনিবার থেকে আজ পর্যন্ত) ও “This month”। বাছাই বদলালে “The Pulse”-এর হিসাব সঙ্গে সঙ্গে বদলে যায়।",
          image: {
            id: "dashboard-home-top-bar-1",
            caption: "উপরে আটকে থাকা বার: সময় বাছাই, “Show amounts” ও (+) বোতাম",
          },
        },
        {
          text: "হোম স্ক্রিন খুললে সব টাকার অঙ্ক *** দেখায়, যাতে পাশের কেউ দেখে না ফেলে। বারের “Show amounts” চাপলে সব অঙ্ক দেখা যায়, “Hide amounts” চাপলে আবার লুকায়। শুধু একটি কার্ডের অঙ্ক দেখতে সেই কার্ডের কোণের চোখের আইকনে চাপুন।",
        },
        {
          text: "ডান দিকের (+) বোতামে চাপুন (বড় পর্দায় লেখা থাকে “New”)। তালিকা থেকে বেছে নিন: “New order”, “Receive payment”, “Quick quotation”, “New expense” বা “Blank letterhead pad”। যেটি বাছবেন তার ফর্ম খুলবে।",
          image: {
            id: "dashboard-home-top-bar-2",
            caption:
              "(+) বোতামের তালিকা: “New order”, “Receive payment”, “Quick quotation”, “New expense”, “Blank letterhead pad”",
          },
        },
        {
          text: "“Receive payment” চাপলে “Payments” পাতায় “Receive a payment” ফর্মটি সরাসরি খোলে। “Blank letterhead pad” চাপলে কোম্পানির খালি প্যাড PDF হিসেবে তৈরি হয়; তারপর “Open the PDF” বা “Download” চাপুন।",
        },
      ],
      tips: [
        "পাতা আবার খুললে অঙ্কগুলো আবার লুকানো থাকে; কিছুই মনে রাখা হয় না।",
        "সময় বাছাই পাতার ঠিকানায় থাকে, তাই লিংক কাউকে পাঠালে তিনিও একই সময়ের হিসাব দেখবেন।",
        "(+) তালিকায় কোনো কাজ না পেলে বুঝবেন আপনার ভূমিকায় তার অনুমতি নেই; দরকার হলে অ্যাডমিনকে বলুন।",
      ],
    },
    {
      slug: "dashboard-sales-target",
      title: "মাসের বিক্রির লক্ষ্য (Monthly sales target) ঠিক করবেন ও দেখবেন যেভাবে",
      summary:
        "মাসে কত টাকার বিক্রি করতে চান তা ঠিক করা, আর হোম স্ক্রিনের দাগে দেখা কত ভাগ হলো, গতি ঠিক আছে কি না ও রোজ কত বিক্রি দরকার।",
      keywords: [
        "sales target",
        "monthly target",
        "target",
        "achieved",
        "on pace",
        "behind pace",
        "target reached",
        "set target",
        "বিক্রির লক্ষ্য",
        "লক্ষ্য",
        "মাসের টার্গেট",
        "টার্গেট",
      ],
      routes: ["/"],
      who: "লক্ষ্য দেখেন যাঁরা বিক্রির টাকা দেখতে পারেন (Super Admin, Accounts ও Sales Executive)। লক্ষ্য ঠিক করেন বা বদলান শুধু Super Admin, বা যে ভূমিকায় কোম্পানির সেটিংস বদলানোর অনুমতি আছে।",
      anyOf: ["sales.view", "dashboard.financials", "accounts.view"],
      steps: [
        {
          text: "হোম স্ক্রিনে উপরের বারের নিচে “Monthly sales target” কার্ড দেখবেন। প্রথমবার “Set target” চাপুন।",
          image: {
            id: "dashboard-sales-target-1",
            caption: "“Monthly sales target” কার্ড ও “Set target” বোতাম",
          },
        },
        {
          text: "“Month” ঘরে মাস বেছে নিন (এই মাস বা সামনের কোনো মাস), “Target” ঘরে টাকার অঙ্ক লিখুন, তারপর “Save the target” চাপুন।",
        },
        {
          text: "বড় সংখ্যাটি বলে লক্ষ্যের কত ভাগ বিক্রি হয়েছে (যেমন 75% “achieved”)। দাগটি সেই অনুযায়ী ভরে ওঠে। দাগের ওপর ছোট খাড়া রেখাটি দেখায়, মাস জুড়ে সমান গতিতে বিক্রি হলে আজ পর্যন্ত কোথায় থাকার কথা।",
          image: {
            id: "dashboard-sales-target-2",
            caption: "ভরে ওঠা দাগ, শতাংশ আর “On pace” বা “Behind pace” লেখা",
          },
        },
        {
          text: "পাশে লেখা থাকে “On pace” (গতি ঠিক আছে), “Behind pace” (পিছিয়ে আছেন) বা “Target reached” (লক্ষ্য পূরণ)। নিচে থাকে মাসের বিক্রি, লক্ষ্য, কত দিন বাকি, আর লক্ষ্যে পৌঁছাতে বাকি দিনগুলোতে রোজ কত বিক্রি দরকার।",
        },
        {
          text: "একবার ঠিক করা লক্ষ্য পরের মাসগুলোতেও চলে, যতক্ষণ না বদলান; তখন কার্ডে লেখা থাকে “Carried over from …”। বদলাতে “Change target” চাপুন।",
        },
      ],
      tips: [
        "বিক্রি গোনা হয় ছাড়ের পরের পণ্যের দামে, ভ্যাট ও ডেলিভারি চার্জ ছাড়া; বাতিল (void) ইনভয়েস গোনা হয় না। “Key figures”-এর “Today's sales”-ও এভাবেই গোনা।",
        "টাকার অঙ্ক শুরুতে *** থাকে; উপরের “Show amounts” বা কার্ডের চোখে চাপলে দেখা যায়। শতাংশ সবসময় দেখা যায়।",
        "পেরিয়ে যাওয়া মাসের লক্ষ্য আর বদলানো যায় না, যাতে পুরনো হিসাব ঠিক থাকে।",
      ],
    },
    {
      slug: "dashboard-pulse",
      title: "দ্য পালস (The Pulse): বিক্রি, আদায়, ডেলিভারি ও উৎপাদনের গতি দেখবেন যেভাবে",
      summary:
        "আজ, এই সপ্তাহ বা এই মাসে কত বিক্রি ও আদায় হলো, কয়টি অর্ডার পাঠানো বাকি আর কয়টি প্রজেক্ট চলছে, এক নজরে দেখা।",
      keywords: [
        "pulse",
        "sales & collection",
        "collection",
        "deliveries",
        "active projects",
        "production",
        "waiting to go out",
        "পালস",
        "আদায়",
        "কালেকশন",
        "ডেলিভারি",
        "চলমান প্রজেক্ট",
      ],
      routes: ["/"],
      who: "“Sales & collection” দেখেন যাঁরা বিক্রির টাকা দেখতে পারেন, “Deliveries” দেখেন যাঁরা Sales দেখতে পারেন, আর “Production” দেখেন যাঁরা Production দেখতে পারেন ও মালিক।",
      anyOf: ["sales.view", "production.view", "dashboard.financials", "accounts.view"],
      steps: [
        {
          text: "উপরের বারে সময় বেছে নিন: “Today”, “This week” বা “This month”। “The Pulse” অংশের পাশে সেই সময়ের তারিখ লেখা থাকে।",
          image: {
            id: "dashboard-pulse-1",
            caption:
              "“The Pulse”-এর তিনটি কার্ড: “Sales & collection”, “Deliveries” ও “Production”",
          },
        },
        {
          text: "“Sales & collection”: এই সময়ে কত টাকার বিক্রি হলো (ইনভয়েস ও পিসের সংখ্যাসহ) আর বায়ারদের কাছ থেকে কত টাকা আদায় হলো। নগদে টাকা ফেরত দেওয়া হলে তা বাদ দিয়ে আদায় দেখায়। অঙ্ক দেখতে কার্ডের চোখে চাপুন।",
        },
        {
          text: "“Deliveries”: কয়টি অর্ডারের মাল এখনো পাঠানো বাকি (“Orders waiting to go out”), আর এই সময়ে কয়টি ডেলিভারি চালান গেছে ও কত পিস। শিপমেন্টের দিন পেরিয়ে যাওয়া অর্ডার থাকলে লাল লেখায় দেখায়।",
        },
        {
          text: "“Production”: এখন চলমান প্রজেক্ট (“Active projects”), এই সময়ে শেষ হওয়া প্রজেক্ট, আর পরিকল্পিত ও থেমে থাকা প্রজেক্টের সংখ্যা। দেরি হওয়া প্রজেক্ট থাকলে লাল লেখায় চাপলে সেগুলোর তালিকা খোলে।",
          image: {
            id: "dashboard-pulse-2",
            caption: "“Production” কার্ডে চলমান ও দেরি হওয়া প্রজেক্ট",
          },
        },
        {
          text: "প্রতিটি কার্ডের নিচের লিংকে চাপলে সেই অংশের পাতা খোলে: “Open the sales overview”, “Open the orders” ও “Open the active projects”।",
        },
      ],
      tips: [
        "আদায় গোনা হয় “Payments” পাতার “Collected today”-এর মতো করেই: বায়ারের দেওয়া টাকা থেকে নগদ ফেরত বাদ।",
        "সপ্তাহ শনিবার থেকে শুরু ধরা হয়, বাংলাদেশের কাজের সপ্তাহের মতো।",
      ],
    },
    {
      slug: "dashboard-key-figures",
      title: "মূল হিসাবগুলো (Key figures) পড়বেন যেভাবে",
      summary:
        "স্টকের মূল্য, স্থায়ী সম্পদ, দেনা, আজকের বিক্রি, এ মাসের নিট লাভ ও নষ্ট মালের মূল্যের কার্ডগুলো বোঝা।",
      keywords: [
        "dashboard",
        "key figures",
        "stock value",
        "fixed assets",
        "liabilities",
        "today's sales",
        "net profit",
        "bad stock value",
        "damage",
        "ড্যাশবোর্ড",
        "আজকের বিক্রি",
        "লাভ",
        "নিট লাভ",
        "স্টকের মূল্য",
        "দেনা",
        "নষ্ট মাল",
      ],
      routes: ["/"],
      who: "যাঁরা আর্থিক হিসাব দেখতে পারেন, যেমন Super Admin ও Accounts। অন্যদের পর্দায় এই কার্ডগুলো আসে না।",
      anyOf: ["dashboard.financials", "accounts.view"],
      steps: [
        {
          text: "মেনুর “Dashboard”-এ চাপুন, অথবা উপরের “Extas ERP” লেখায় চাপুন। “Key figures” অংশে ছয়টি কার্ড দেখবেন।",
          image: {
            id: "dashboard-key-figures-1",
            caption: "ড্যাশবোর্ডের “Key figures” অংশে ছয়টি কার্ড",
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
          text: "“Total bad stock value”: এ পর্যন্ত যত পিস “Damage & QC Rejects”-এ সরানো হয়েছে তার মোট দাম, খরচের দামে। নিচে মোট পিস (“Pieces written off”), এ মাসের পিস ও টাকা (“This month”) আর কয়বার লেখা হয়েছে (“Entries”)।",
        },
        {
          text: "ড্যাশবোর্ড খুললে সব কার্ডের অঙ্ক *** দেখায়। উপরের বারের “Show amounts” চাপলে সব কার্ড একসঙ্গে দেখা যায়, “Hide amounts” চাপলে আবার লুকায়। শুধু একটি কার্ড দেখতে সেই কার্ডের কোণের চোখের আইকনে চাপুন।",
          image: {
            id: "dashboard-key-figures-2",
            caption: "কার্ডের কোণে চোখের আইকন ও উপরের “Show amounts” বোতাম",
          },
        },
      ],
      tips: [
        "অঙ্ক দেখানো শুধু এই পর্দায় যতক্ষণ পাতা খোলা থাকে; পাতা আবার খুললে সব আবার লুকানো থাকে।",
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
