import type { HelpSection } from "../types";

/** Production: projects and their stages, factory deliveries into stock, bills and costs. */
export const productionHelp: HelpSection = {
  id: "production",
  title: "উৎপাদন (Production)",
  description:
    "ফ্যাক্টরিতে দেওয়া প্রতিটি কাজ একটি প্রজেক্ট: কাপড় সংগ্রহ থেকে ফিনিশিং পর্যন্ত ধাপ, ফ্যাক্টরি থেকে আসা মাল স্টকে তোলা, আর বিল ও খরচ থেকে প্রতি পিসের খরচ।",
  href: "/production",
  articles: [
    {
      slug: "production-overview",
      title: "উৎপাদনের সারসংক্ষেপ (Overview) পড়বেন যেভাবে",
      summary:
        "প্রোডাকশন বোর্ডে (Kanban) প্রতিটি ধাপের আলাদা কলামে সব চলমান প্রজেক্টের কার্ড দেখা: কোনগুলো দেরিতে (লাল), লক্ষ্যের তুলনায় কত পিস এসেছে, কত খরচ হয়েছে, আর এক চাপে প্রজেক্টকে পরের ধাপে নেওয়া।",
      keywords: [
        "production overview",
        "production board",
        "kanban",
        "board",
        "late",
        "due this week",
        "on hold",
        "open projects",
        "move to",
        "undo",
        "বোর্ড",
        "কানবান",
        "উৎপাদন",
        "প্রোডাকশন",
        "দেরি",
        "চলমান কাজ",
        "সারসংক্ষেপ",
      ],
      routes: ["/production"],
      who: "যাঁরা Production দেখতে পারেন: Super Admin, Production Manager, Accounts ও Warehouse Team। টাকার অঙ্ক শুধু যাঁরা খরচ দেখতে পারেন তাঁরা দেখেন।",
      steps: [
        {
          text: "মেনু থেকে “Production” খুলুন। “Overview” ট্যাবে উপরে সংখ্যাগুলো থাকে: “In production”, “Late”, “Due this week”, “Planned”, “On hold” ও “Done this month”।",
          image: {
            id: "production-overview-1",
            caption: "“Overview” ট্যাবের উপরের সংখ্যার সারি",
          },
        },
        {
          text: "খরচ দেখার অনুমতি থাকলে “Money in open projects”-এ খোলা প্রজেক্টের মোট খরচ, স্টকে যাওয়া খরচ আর এখনো উৎপাদনে থাকা খরচ দেখাবে।",
        },
        {
          text: "“Production board”-এ প্রতিটি ধাপের একটি কলাম: “Planned” (এখনো শুরু হয়নি), “Fabric sourcing”, “Cutting”, “Sewing”, “Wash and QC” ও “Finishing”। প্রতিটি প্রজেক্ট তার এখনকার ধাপের কলামে কার্ড হয়ে থাকে, দেরির প্রজেক্ট উপরে। হোল্ডে রাখা প্রজেক্ট তার ধাপের কলামেই “On hold” লেখা নিয়ে থাকে।",
          image: {
            id: "production-overview-2",
            caption: "প্রোডাকশন বোর্ড: প্রতিটি ধাপের কলামে প্রজেক্টের কার্ড",
          },
        },
        {
          text: "বোর্ডের উপরে প্রতিটি কলামের নামের একটি করে বোতাম থাকে (যেমন “Sewing”), তাতে কলামে কয়টি প্রজেক্ট ও কয়টি দেরিতে তা লেখা থাকে। বোতামে চাপলে বোর্ড সেই কলামে সরে যায়। ফোনে বোর্ড আঙুল দিয়ে ডানে-বামে সরিয়ে একটি একটি কলাম দেখুন।",
        },
        {
          text: "প্রতিটি কার্ডে লেখা থাকে প্রজেক্টের নাম, কার জন্য, এখনকার ধাপ ও ফ্যাক্টরি, লক্ষ্যের তুলনায় কত পিস স্টকে এসেছে, কত দিন গেছে ও কবে জমা দেওয়ার কথা। খরচ দেখার অনুমতি থাকলে মোট খরচ ও পিসপ্রতি খরচও থাকে।",
        },
        {
          text: "লক্ষ্যের দিন পেরিয়ে গেলে কার্ড লাল হয়ে যায় এবং “… days late” লেখা দেখায়।",
          image: {
            id: "production-overview-3",
            caption: "দেরির প্রজেক্টের লাল কার্ড ও “Move to …” বোতাম",
          },
        },
        {
          text: "Production Manager ও Super Admin কার্ডের নিচের “Move to …” বোতামে (যেমন “Move to Sewing”) এক চাপে প্রজেক্টকে পরের ধাপে নিতে পারেন। কার্ডটি সঙ্গে সঙ্গে পরের কলামে চলে যায়।",
        },
        {
          text: "ভুল করে চাপলে নিচে যে বার্তা আসে তার “Undo” চাপুন। প্রজেক্ট আগের ধাপে ফিরে যাবে, আর ধাপের ইতিহাসে কোনো ভুলের চিহ্ন থাকবে না।",
        },
        { text: "কার্ডের নামে চাপলে সেই প্রজেক্টের পাতা খুলবে।" },
      ],
      tips: [
        "“Undo” শুধু ধাপ বদলের ১০ মিনিটের মধ্যে কাজ করে। পরে ফেরাতে প্রজেক্টের পাতায় “Change the stage” ব্যবহার করুন, তখন কারণ লিখতে হয়।",
        "“Finishing” কলামের কার্ডে “Move to …” থাকে না: কাজ শেষ হলে প্রজেক্টের পাতায় “Complete the project” চাপুন।",
        "পরিকল্পিত (Planned) প্রজেক্ট শুরু করতে প্রজেক্টের পাতায় “Start production” চাপুন।",
        "সময় শেষ হতে কাছাকাছি হলে দাগ হলুদ হয়, আর দেরি হলে কার্ড লাল হয়।",
        "হোল্ডে রাখা প্রজেক্টের দিনও লক্ষ্যের দিনের হিসাবে গোনা হয়।",
        "এআই চালু থাকলে উপরে “Tell AI” বোতাম থাকে: ফ্যাব্রিক এসেছে, কাটিং শুরু বা কোনো সমস্যা লিখে Mehedi 2.0-কে জানান (My HR-এর গাইডে বিস্তারিত)।",
      ],
    },
    {
      slug: "production-new-project",
      title: "নতুন প্রোডাকশন প্রজেক্ট খুলবেন যেভাবে",
      summary:
        "ফ্যাক্টরি, ক্রেতা বা নিজেদের স্টক, স্টাইল, তারিখ ও পিসের সংখ্যা দিয়ে নতুন উৎপাদনের কাজ শুরু করা।",
      keywords: [
        "new project",
        "production project",
        "factory",
        "in-house",
        "target",
        "pieces to make",
        "নতুন প্রজেক্ট",
        "উৎপাদন শুরু",
        "ফ্যাক্টরি",
        "অর্ডার তৈরি",
        "কারখানা",
      ],
      routes: ["/production/projects/new", "/production/projects"],
      who: "যাঁদের প্রজেক্ট সামলানোর অনুমতি আছে, যেমন Production Manager ও Super Admin।",
      anyOf: ["production.manage"],
      steps: [
        {
          text: "“Production” > “Projects” ট্যাবে (বা “Overview”-এ) “New project” চাপুন।",
          image: {
            id: "production-new-project-1",
            caption: "“Projects” ট্যাবে “New project” বোতাম",
          },
        },
        {
          text: "“Project name” লিখুন। ক্যাটালগে স্টাইল থাকলে “Style (optional)” বেছে নিন এবং “Category” দিন।",
        },
        {
          text: "একসাথে বানানো কয়েকটি স্টাইলের একটি হলে “Master batch (optional)” থেকে ব্যাচটি বেছে নিন। ব্যাচের ফ্যাক্টরি আর শেষ করার তারিখ নিজে থেকে বসে যায়। একা একটি কাজ হলে “Not in a batch” রাখুন।",
        },
        {
          text: "“Target price per piece”-এ এক পিসের সর্বোচ্চ খরচ লিখুন (না দিলেও চলে)। তাহলে প্রজেক্টের পাতায় ও কার্ডে “Cost guard” দাগ দেখায়: এখন পর্যন্ত খরচ ÷ বানানোর পিস, লক্ষ্য দামের তুলনায় কত শতাংশ।",
          image: {
            id: "production-new-project-4",
            caption: "“Master batch (optional)” ও “Target price per piece” ঘর",
          },
        },
        {
          text: "“How the factory is given”-এ “A supplier” বেছে “Factory supplier” থেকে ফ্যাক্টরি বেছে নিন। ফ্যাক্টরির প্রোফাইল না থাকলে “Just a name” বেছে “Factory name” লিখুন।",
          image: {
            id: "production-new-project-2",
            caption: "নতুন প্রজেক্টের ফর্ম: ফ্যাক্টরি ও “Who it is made for” অংশ",
          },
        },
        {
          text: "“Who it is made for”-এ কোনো ক্রেতার জন্য হলে “A buyer” বেছে “Buyer” দিন। নিজেদের দোকান বা স্টকের জন্য হলে “In-House”।",
        },
        {
          text: "“Starts” ও “Due” তারিখ দিন। শুরু থেকে ৪৫ দিন পরের তারিখ আগে থেকে বসানো থাকে। “Pieces to make”-এ মোট কত পিস বানাতে হবে লিখুন।",
        },
        {
          text: "চাইলে রং ও সাইজ অনুযায়ী পিসও দিতে পারেন (না দিলেও চলে)। “Pieces per colour and size” অংশে “Style to fill in” থেকে স্টাইল বেছে নিন, প্রতিটি রঙের নিচে সাইজের ঘরে পিস লিখুন। তখন “Pieces to make” নিজে থেকে ঘরগুলোর যোগফল দেখায়।",
          image: {
            id: "production-new-project-3",
            caption: "“Pieces per colour and size” অংশে একটি স্টাইলের রং ও সাইজের ঘর",
          },
        },
        {
          text: "প্রতিটি ঘর হাতে না লিখে সাইজের অনুপাতে ভরাতে স্টাইলের উপরে “Fill by size ratio” চাপুন। “Size ratio”-তে সংরক্ষিত অনুপাত বেছে নিন, অথবা “Type a ratio” বেছে প্রতিটি সাইজের জন্য একটি সংখ্যা লিখুন (যেমন 1:2:2:1)। “Pieces per colour”-এ এক রঙে মোট কত পিস লিখুন, “Colour”-এ “Every colour” বা একটি রং বেছে “Fill the boxes” চাপুন। ঘরগুলো অনুপাতে ভরে যায় এবং যোগফল ঠিক আপনার লেখা পিসের সমান হয়।",
          image: {
            id: "production-new-project-5",
            caption: "“Fill by size ratio”: অনুপাত, এক রঙের পিস ও “Fill the boxes”",
          },
        },
        {
          text: "এখনই কাজ শুরু হলে “In production now”, পরে শুরু হলে “Planned for later” বেছে নিন। তারপর “Create the project” চাপুন।",
        },
      ],
      tips: [
        "প্রজেক্টের কোড নিজে থেকে দেওয়া হয়।",
        "পরে কিছু বদলাতে প্রজেক্টের পাতায় “Edit” চাপুন।",
        "সাইজের অনুপাত সংরক্ষণ করা থাকে Products-এর অনুপাত (ratio preset) তালিকায়; সেখানে রাখা অনুপাতগুলোই “Size ratio”-তে আসে।",
        "কোনো সেলস অর্ডার বা প্রোফর্মার মাল বানাতে হলে ফর্মের উপরে “Find a sales order or proforma”-এ সেটি খুঁজে বেছে নিন: ক্রেতা, স্টাইল আর রং ও সাইজের পিস নিজে থেকে বসে যায়। “সেলস অর্ডার বা প্রোফর্মা থেকে উৎপাদন শুরু” গাইডটি দেখুন।",
        "রং ও সাইজের ঘর থাকলে মোট পিস আলাদা করে বদলানো যায় না: ঘরগুলো বদলান, মোট নিজে বদলে যায়।",
        "হোম স্ক্রিনের “Action Zone”-এ কম স্টকের পাশে “Order now” চাপলেও এই ফর্ম খোলে, শিরোনাম “Restock …”: স্টাইল, ক্যাটাগরি ও “In-House” বসানো থাকে, রং ও সাইজের ঘর খালি থাকে, আর “Running low” লেখায় কোন রং ও সাইজ কম তা বলা থাকে।",
      ],
    },
    {
      slug: "production-batches",
      title: "মাস্টার ব্যাচ (Master batch) খুলবেন ও স্টাইল যোগ করবেন যেভাবে",
      summary:
        "একসাথে বানানো কয়েকটি স্টাইলকে (যেমন তিন ব্র্যান্ডে ৫,০০০ পোলো শার্ট) একটি ব্যাচের নিচে রাখা: প্রতিটি স্টাইল নিজের রং-সাইজ, লক্ষ্য দাম, খরচ ও ডেলিভারি নিয়ে আলাদা প্রজেক্ট, আর ব্যাচ সব যোগ করে দেখায়।",
      keywords: [
        "master batch",
        "batch",
        "batches",
        "styles",
        "add a style",
        "umbrella",
        "child project",
        "readymade",
        "dropshipping",
        "cm",
        "মাস্টার ব্যাচ",
        "ব্যাচ",
        "স্টাইল যোগ",
        "একসাথে উৎপাদন",
        "রেডিমেড",
        "ড্রপশিপিং",
        "reject allowance",
        "রিজেক্ট",
      ],
      routes: ["/production/batches"],
      who: "ব্যাচ দেখেন যাঁরা Production দেখতে পারেন। ব্যাচ খোলা, বদলানো ও স্টাইল যোগ করেন Production Manager ও Super Admin। টাকার অঙ্ক ও “Batch cost” শুধু যাঁরা খরচ দেখতে পারেন তাঁরা দেখেন।",
      steps: [
        {
          text: "“Production” > “Batches” ট্যাব খুলুন। প্রতিটি ব্যাচ একটি কার্ড: কোড, কোন ধরনের কাজ, কয়টি স্টাইল (দেরির স্টাইল লাল), সময়ের দাগ, কত পিস স্টকে এসেছে, আর খরচ দেখার অনুমতি থাকলে খরচ ও ব্যাচের “Cost guard” দাগ।",
          image: {
            id: "production-batches-1",
            caption: "“Batches” ট্যাবে ব্যাচের কার্ড",
          },
        },
        {
          text: "উপরের “All”, “In production”, “Planned”, “No styles yet” ও “Done” দিয়ে ব্যাচ ছাঁকুন, অথবা খোঁজের ঘরে ব্যাচের কোড, নাম, কোনো স্টাইল বা ফ্যাক্টরির নাম লিখে “Find” চাপুন।",
        },
        {
          text: "নতুন ব্যাচের জন্য “New batch” চাপুন। “Batch name” লিখুন, “How the goods are made”-এ বেছে নিন: “Made at a factory (CM)” (নিজেদের কাপড়, ফ্যাক্টরি কেটে-সেলাই করে), “Bought ready-made” (তৈরি মাল কিনে লেবেল বদল) বা “Dropshipping” (অর্ডার অনুযায়ী এনে সরাসরি পাঠানো, স্টকে থাকে না)।",
          image: {
            id: "production-batches-2",
            caption: "নতুন ব্যাচের ফর্ম: নাম, কাজের ধরন, ফ্যাক্টরি ও তারিখ",
          },
        },
        {
          text: "“Factory (optional)” ও “All done by (optional)” দিন। এরপর ব্যাচে যে স্টাইল যোগ করবেন, সেটি এই ফ্যাক্টরি আর তারিখ নিয়েই শুরু হবে (দরকারে স্টাইলে বদলানো যায়)। “Create the batch” চাপুন।",
        },
        {
          text: "ফ্যাক্টরিতে (CM) বানানো ব্যাচে “Reject allowance (%)” থাকে, নিজে থেকে ২%। কাটা পিসের এই ভাগ পর্যন্ত রিজেক্ট (সেলাইয়ের ভুল, এক্সেসরিজ লাগাতে গিয়ে নষ্ট হওয়া বডি) ফ্যাক্টরির কোনো জরিমানা নেই; এর বেশি প্রতিটি রিজেক্ট স্টাইলের লক্ষ্য দামে (target price) ফ্যাক্টরির CM থেকে কাটা হয়। হারানো পিস সবসময় পুরোটাই কাটা হয়, কোনো ছাড় নেই। ব্যাচের পাতার “Details”-এ “Reject allowance” দেখায়।",
        },
        {
          text: "ব্যাচের পাতায় “Add a style” চাপুন। নতুন প্রজেক্টের ফর্ম খোলে, “Master batch (optional)”-এ ব্যাচটি বসানো থাকে। স্টাইল, রং ও সাইজের পিস (চাইলে “Fill by size ratio” দিয়ে) আর “Target price per piece” দিয়ে “Create the project” চাপুন। প্রতিটি স্টাইলের জন্য আবার “Add a style”।",
          image: {
            id: "production-batches-3",
            caption: "ব্যাচের পাতা: “Add a style” ও স্টাইলের কার্ড",
          },
        },
        {
          text: "ব্যাচের পাতায় “Styles”-এর নিচে প্রতিটি স্টাইলের কার্ড থাকে: ধাপ, সময়, পিস আর তার নিজের খরচের দাগ। কোনো স্টাইল লক্ষ্য দামের কাছে বা বেশি হলে উপরে হলুদ বা লাল সতর্কতা দেখায়।",
        },
        {
          text: "ডান পাশে “Batch cost”-এ সব স্টাইলের মোট খরচ, পিসপ্রতি খরচ, আর যেসব স্টাইলে লক্ষ্য দাম আছে তাদের মোট সীমার তুলনায় কত খরচ হয়েছে তা দাগে দেখায়। “Details”-এ ফ্যাক্টরি, শেষ করার তারিখ, বানানোর ও স্টকে আসা পিস।",
        },
        {
          text: "আগে খোলা কোনো প্রজেক্টকে ব্যাচে আনতে সেই প্রজেক্টের “Edit” খুলে “Master batch (optional)” থেকে ব্যাচ বেছে সংরক্ষণ করুন। ব্যাচ থেকে বের করতে “Not in a batch” বেছে নিন।",
        },
      ],
      tips: [
        "ব্যাচের অবস্থা স্টাইলগুলো থেকে আসে: কোনো স্টাইল নেই হলে “No styles yet”, একটিও শুরু না হলে “Planned”, কোনোটা চললে “In production”, সব শেষ বা বাতিল হলে “Done”।",
        "ব্যাচের নাম, ধরন, ফ্যাক্টরি বা তারিখ বদলাতে “Edit the batch” চাপুন। এতে আগের স্টাইলগুলো বদলায় না, শুধু নতুন স্টাইল নতুন ফ্যাক্টরি ও তারিখ নিয়ে শুরু হয়।",
        "ভুল করে খোলা ব্যাচ, যার কোনো স্টাইল নেই, “Delete the batch” দিয়ে মুছে ফেলা যায়।",
        "প্রজেক্টের কার্ডে ও তালিকায় ব্যাচের কোড (MB-…) দেখায়, আর প্রজেক্টের পাতার “Details”-এ “Master batch” থেকে ব্যাচে ফেরা যায়।",
        "পুরো ব্যাচের টাকার হিসাব এক পাতায় দেখতে “Batch cost”-এর পাশে “Batch summary” চাপুন। “ব্যাচের সারাংশ (Batch summary) দেখবেন ও PDF নেবেন যেভাবে” গাইডটি দেখুন।",
      ],
    },
    {
      slug: "production-cost-guard",
      title: "খরচ পাহারা (Cost guard) ও লক্ষ্য দাম কাজ করে যেভাবে",
      summary:
        "প্রতিটি স্টাইলের এক পিসের লক্ষ্য দাম (Target price) দিয়ে রাখলে এখন পর্যন্ত খরচ থেকে পিসপ্রতি খরচ হিসাব হয়; লক্ষ্যের ৮৫%-এ দাগ হলুদ, ১০০% পেরোলে লাল, আর সঙ্গে সঙ্গে ইনবক্সে বার্তা।",
      keywords: [
        "cost guard",
        "target price",
        "target cost",
        "budget",
        "over budget",
        "cost per piece",
        "alert",
        "warning",
        "খরচ পাহারা",
        "লক্ষ্য দাম",
        "বাজেট",
        "পিসপ্রতি খরচ",
        "সতর্কতা",
      ],
      routes: ["/production/projects/[projectId]"],
      who: "যাঁরা প্রোডাকশনের খরচ দেখতে পারেন: Production Manager, Accounts ও Super Admin। লক্ষ্য দাম দেন Production Manager ও Super Admin; সতর্কবার্তা যায় Production Manager ও Super Admin-এর ইনবক্সে।",
      anyOf: ["production.manage", "accounts.view"],
      steps: [
        {
          text: "প্রজেক্ট খোলার সময় বা পরে “Edit”-এ “Target price per piece”-এ এক পিসের সর্বোচ্চ খরচ লিখুন, যেমন 450।",
        },
        {
          text: "প্রজেক্টের পাতায় ডান পাশে “Cost guard” অংশে দেখায় “Cost a piece so far” (এখন পর্যন্ত মোট খরচ ÷ বানানোর পিস) আর “Target price”, কত শতাংশ হলো, আর পিসপ্রতি আরও কত খরচের জায়গা আছে।",
          image: {
            id: "production-cost-guard-1",
            caption: "প্রজেক্টের পাতায় “Cost guard” অংশ",
          },
        },
        {
          text: "দাগের রং: লক্ষ্যের ৮৫%-এর নিচে সবুজ (“Within the target price”), ৮৫% থেকে হলুদ (“Near the target price”), আর ১০০% বা বেশি হলে লাল (“Over the target price”)।",
        },
        {
          text: "বিল, খরচ বা কাঁচামাল দেওয়ার ফলে দাগ হলুদ বা লাল হলেই Production Manager ও Super Admin-এর ইনবক্সে বার্তা আসে, যার শিরোনামে “Near the target price” বা “Over the target price” আর প্রজেক্টের কোড থাকে। বার্তার “Open the project” চাপলে প্রজেক্ট খোলে।",
          image: {
            id: "production-cost-guard-2",
            caption: "ইনবক্সে “Over the target price” বার্তা",
          },
        },
        {
          text: "“Overview” বোর্ডের কার্ডে, “Projects” তালিকায় ও ব্যাচের পাতায়ও প্রতিটি স্টাইলের ছোট দাগ থাকে, তাই কোন স্টাইল সীমা ছাড়াচ্ছে তা এক নজরে দেখা যায়।",
        },
      ],
      tips: [
        "পিসপ্রতি খরচ ধরা হয় বানানোর মোট পিস দিয়ে, তাই কাজ যত এগোয় আর খরচ যত যোগ হয়, দাগ তত বাড়ে। শেষে আসল পিসপ্রতি খরচ “Cost a piece” অংশে দেখায়।",
        "লক্ষ্য দাম কমালে বা পিস বাড়ালে দাগ খারাপের দিকে গেলে তখনও বার্তা যায়।",
        "লক্ষ্য দাম না থাকলে প্রজেক্টের পাতায় “Cost guard” অংশে মনে করিয়ে দেয়; মুছে দিতে “Target price per piece” খালি করে সংরক্ষণ করুন।",
      ],
    },
    {
      slug: "production-materials-per-piece",
      title: "প্রতি পিসের কাঁচামাল (Materials per piece) ও টেক প্যাক বানাবেন যেভাবে",
      summary:
        "প্রতিটি স্টাইলের এক পিসে কোন কাপড়, কলার, বোতাম বা লেবেল কতটুকু লাগে লিখে রাখলে রং ও সাইজ অনুযায়ী মোট কত কিনতে হবে নিজে থেকে হিসাব হয়, আর এক চাপে ছবি ও নির্দেশসহ টেক প্যাক PDF মেলে।",
      keywords: [
        "materials per piece",
        "bill of materials",
        "bom",
        "consumption",
        "wastage",
        "tech pack",
        "collar",
        "cuff",
        "write with ai",
        "কাঁচামাল",
        "টেক প্যাক",
        "কলার",
        "কাফ",
        "অপচয়",
      ],
      routes: ["/production/projects/[projectId]/materials"],
      who: "দেখতে পারেন যাঁদের প্রোডাকশন দেখার অনুমতি আছে; বদলাতে পারেন Production Manager ও Super Admin। এখানে কোনো দাম থাকে না।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "স্টাইলের (প্রজেক্টের) পাতায় “Materials per piece” অংশে “Add materials” চাপুন; আগে দেওয়া থাকলে বোতামটি “Edit materials”।",
          image: {
            id: "production-materials-per-piece-1",
            caption: "স্টাইলের পাতায় “Materials per piece” অংশ",
          },
        },
        {
          text: "“Find the first material”-এ কাপড় বা অ্যাক্সেসরিজের কোড বা নাম লিখে বেছে নিন। “Per piece” ঘরে এক পিসে কতটুকু লাগে লিখুন (যেমন 0.285 kg কাপড়, 6 pcs বোতাম), আর “Wastage (%)”-এ কাটিংয়ের ক্ষতির জন্য বাড়তি শতাংশ।",
        },
        {
          text: "“How it is ordered”-এ বেছে নিন: “One total” (বোতাম, লেবেল, সুতা), “By colour” (শরীরের কাপড়, প্রতিটি রঙের আলাদা হিসাব) বা “By colour and size” (কলার ও কাফ, প্রতিটি রং ও সাইজের জন্য আলাদা বোনা)।",
        },
        {
          text: "“Where it goes (optional)”-এ লিখুন কোথায় বসবে, যেমন Main body, Collar, Main label। “Picture (optional)”-এ লেবেলের ডিজাইন বা বোতামের ছবি টেনে ছেড়ে দিন বা চাপ দিয়ে বেছে নিন; ছবি নিজে থেকে প্রায় 150 KB হয়ে যায়।",
          image: {
            id: "production-materials-per-piece-2",
            caption: "“Materials per piece” ফর্মে কাপড়, কলার ও ছবি",
          },
        },
        {
          text: "প্রতিটি সারির “For all pieces” ঘরে সঙ্গে সঙ্গে দেখায় সব পিসের জন্য কত লাগবে (অপচয়সহ, উপরের দিকে পূর্ণ সংখ্যা করা)। শেষে “Save the materials” চাপুন।",
        },
        {
          text: "স্টাইলের পাতায় প্রতিটি কাঁচামালের নিচে দেখায় কত লাগবে, কত অর্ডার হয়েছে (“ordered”) আর কত বাকি (“to order”); রং বা সাইজ অনুযায়ী ভাগ দেখতে “By colour” বা “By colour and size” চাপুন। “On purchase orders”-এ থাকে কোন অর্ডারে এই স্টাইলের কত অংশ।",
        },
        {
          text: "“Tech pack notes”-এ সেলাই, মাপ মেলানো ও প্যাকিংয়ের নির্দেশ লিখুন, বা “Write with AI” চেপে খসড়া নিন (AI চালু না থাকলে বোতামটি “Draft from the materials”, নিয়ম মেনে খসড়া লেখে)। পড়ে ঠিক করে সংরক্ষণ করুন।",
        },
        {
          text: "স্টাইলের পাতায় “Tech pack (PDF)” চাপলে লেটারহেডে PDF নামে: রং ও সাইজ অনুযায়ী পিস, ছবিসহ প্রতি পিসের কাঁচামাল, কলার ও কাফের রং × সাইজ ছক আর নির্দেশ। এতে কোনো দাম নেই, তাই সরাসরি ফ্যাক্টরিকে দেওয়া যায়।",
          image: {
            id: "production-materials-per-piece-3",
            caption: "টেক প্যাক PDF-এর প্রথম পাতা",
          },
        },
      ],
      tips: [
        "AI-কে শুধু স্টাইল, রং, সাইজ ও কাঁচামালের তথ্য পাঠানো হয়; কোনো দাম বা মানুষের নাম যায় না।",
        "একই কাঁচামাল দুই জায়গায় লাগলে (যেমন কলার ও কাফে একই রিব) আলাদা দুটি সারি দিন; অর্ডারের সময় দুটো যোগ হয়।",
        "প্রজেক্টে রং ও সাইজ না থাকলে সব কাঁচামাল এক মোট হিসেবে ধরা হয়।",
        "প্রজেক্ট শেষ বা বাতিল হলে কাঁচামাল আর বদলানো যায় না।",
      ],
    },
    {
      slug: "production-batch-orders",
      title: "মাস্টার ব্যাচের ট্রিমস ও অ্যাক্সেসরিজ এক সাথে অর্ডার করবেন যেভাবে",
      summary:
        "ব্যাচের সব স্টাইলের ট্রিমস ও অ্যাক্সেসরিজ যোগ হয়ে সরবরাহকারী অনুযায়ী ভাগ হয়; এক চাপে প্রতিটি সরবরাহকারীর জন্য একটি করে পারচেজ অর্ডার, দাম না জানলে মাল আসার সময় দেওয়া যায়। ব্যাচের কাপড় এখানে নয়, বুকিং (Booking) দিয়ে বুক হয়।",
      keywords: [
        "make purchase orders",
        "batch order",
        "fabric order",
        "accessories order",
        "price at receive",
        "collar matrix",
        "style-wise breakdown",
        "print order",
        "পারচেজ অর্ডার",
        "কাপড়ের অর্ডার",
        "অ্যাক্সেসরিজ",
        "ব্যাচ",
      ],
      routes: ["/production/batches/[batchId]/orders/new"],
      who: "অর্ডার দিতে পারেন যাঁদের কাঁচামাল কেনার অনুমতি আছে: Production Manager ও Super Admin। ব্যাচের “Materials” অংশ দেখতে পারেন যাঁরা প্রোডাকশন দেখেন।",
      anyOf: ["materials.purchase", "production.view"],
      steps: [
        {
          text: "ব্যাচের পাতায় “Materials” অংশে প্রতিটি কাঁচামালের মোট “needed”, “ordered” আর “to order” দেখায়। যে স্টাইলের প্রতি পিসের কাঁচামাল এখনো দেওয়া হয়নি, তার নামও সেখানে থাকে।",
          image: {
            id: "production-batch-orders-1",
            caption: "ব্যাচের পাতায় “Materials” অংশ",
          },
        },
        {
          text: "“Make purchase orders” চাপুন। কাঁচামালগুলো তাদের নিয়মিত সরবরাহকারী অনুযায়ী ভাগ হয়ে আসে; যার সরবরাহকারী নেই সেগুলো “No usual supplier” অংশে থাকে, সেখানে “Supplier” বেছে দিন।",
        },
        {
          text: "ব্যাচের কাপড় এই ফর্মে অর্ডার হয় না। উপরে “Fabric is booked with a booking” অংশে কাপড়গুলো আর কতটুকু বুক করা বাকি তা লেখা থাকে; সেখান থেকে “Book fabric” চেপে বুকিং করুন। “ব্যাচের কাপড় বুক করবেন ও বুকিং ব্যাচে যোগ করবেন যেভাবে” গাইডটি দেখুন।",
        },
        {
          text: "টিক দেওয়া কাঁচামাল অর্ডারে যায়। “Quantity” শুরুতে বাকি পরিমাণ দেখায়, দরকার হলে বদলান। দাম জানা থাকলে দামের ঘরে লিখুন, না জানলে খালি রাখুন: লাইনটি “At receive” হয়, মাল আসার সময় দাম দেওয়া হয়।",
          image: {
            id: "production-batch-orders-2",
            caption: "“Make purchase orders” ফর্মে সরবরাহকারী অনুযায়ী ভাগ",
          },
        },
        {
          text: "“Make the purchase orders” চাপলে প্রতিটি সরবরাহকারীর জন্য একটি করে অর্ডার হয়, আর প্রতিটি লাইন স্টাইল, রং ও সাইজ অনুযায়ী ভাগ হয়ে থাকে। ব্যাচের পাতায় নতুন অর্ডারের নম্বর দেখায়।",
        },
        {
          text: "অর্ডারের পাতায় “By style” অংশে দেখায় কোন লাইনের কতটুকু কোন স্টাইল ও রঙের জন্য। “Print order (PDF)” চাপলে লেটারহেডে অর্ডার নামে: ছবিসহ লাইন, দাম বা “At receive”, তারপর স্টাইল অনুযায়ী ভাগ, আর প্রতিটি কলার ও কাফের রং × সাইজ ছক আলাদা পাতায়।",
          image: {
            id: "production-batch-orders-3",
            caption: "অর্ডারের PDF-এ কলারের রং ও সাইজ ছক",
          },
        },
      ],
      tips: [
        "একই সরবরাহকারী দুই অংশে বেছে নিলে দুটো মিলে একটি অর্ডারই হয়।",
        "কাপড় এই অর্ডারে দেওয়ার চেষ্টা করলে সিস্টেম নেয় না, বলে বুকিং দিয়ে বুক করতে। তাই কাপড়ের GSM, DIA বা চওড়া, রং আর শর্তাবলি সবসময় বুকিংয়ে লেখা থাকে।",
        "আগে অর্ডার করা পরিমাণ বাদ দিয়েই “to order” দেখায়; বাতিল অর্ডার গোনা হয় না, আর আগে বন্ধ করা অর্ডারে যতটুকু এসেছে ততটুকুই গোনা হয়।",
        "অর্ডারের দাম শুধু যাঁরা কাঁচামালের দাম দেখতে পারেন তাঁরাই দেখেন; প্রিন্টেও তাই।",
      ],
    },
    {
      slug: "production-bookings",
      title: "বুকিং (Booking) কী, আর বুকিংয়ের তালিকা দেখবেন যেভাবে",
      summary:
        "বুকিং হলো মিল বা ট্রিমস সরবরাহকারীকে (Supplier PO) অথবা ইসলামপুরের মতো খোলা বাজারের দোকানকে (Market purchase) দেওয়া কাপড়, সুতা ও ট্রিমসের অর্ডার: স্পেসিফিকেশন, কলার-কাফের ছক আর কড়া শর্তাবলিসহ, সরবরাহকারীর জন্য PDF-এ ছাপা।",
      keywords: [
        "booking",
        "bookings",
        "fabric booking",
        "supplier po",
        "market purchase",
        "ready stock",
        "islampur",
        "trims booking",
        "বুকিং",
        "কাপড় বুকিং",
        "মার্কেট পারচেজ",
        "ইসলামপুর",
        "রেডি স্টক",
      ],
      routes: ["/production/bookings"],
      who: "বুকিং দেখেন যাঁদের “See bookings” বা বুকিংয়ের অন্য কোনো অনুমতি আছে (শুরুতে Super Admin, Production Manager, Accounts, Warehouse Team)। বুকিং করেন ও বদলান যাঁদের “Add bookings”-এর অনুমতি আছে (শুরুতে Production Manager ও Super Admin)। দাম শুধু যাঁরা কাঁচামালের দাম দেখতে পারেন তাঁরা দেখেন।",
      steps: [
        {
          text: "“Production” > “Bookings” ট্যাব খুলুন। নতুন বুকিং আগে উপরে থাকে। ফোনে প্রতিটি বুকিং একটি কার্ড, কম্পিউটারে একটি টেবিল: বুকিং নম্বর, তারিখ, অবস্থা, সরবরাহকারী, কী বুক হলো (কাপড়ের মোট কেজি বা গজ, কলারের সেট, কয়টি আইটেম), কোন ব্যাচের জন্য আর কবে দেওয়ার কথা।",
          image: {
            id: "production-bookings-1",
            caption: "“Bookings” ট্যাবে বুকিংয়ের তালিকা",
          },
        },
        {
          text: "উপরের “All”, “Supplier PO” ও “Market purchase” দিয়ে উৎস অনুযায়ী ছাঁকুন। খোঁজের ঘরে বুকিং নম্বর, সরবরাহকারী, শিরোনাম বা স্টাইল লিখে, চাইলে “All garments” ও “Any status” থেকে বেছে “Find” চাপুন।",
        },
        {
          text: "“Supplier PO” মানে মিল বা ট্রিমস হাউস আমাদের স্পেসিফিকেশন অনুযায়ী মাল বানিয়ে দেবে। “Market purchase” মানে খোলা বাজার থেকে তৈরি মাল (রেডি স্টক) কেনা, দোকানেই মাল দেখে নেওয়া হয়। দুটোর শর্তাবলি আলাদা।",
        },
        {
          text: "নতুন বুকিংয়ের জন্য “New booking” চাপুন। “নতুন বুকিং করবেন যেভাবে” গাইডটি দেখুন।",
        },
        {
          text: "কোনো বুকিংয়ে চাপলে তার পাতা খোলে: কাপড় ও ট্রিমস তাদের স্পেসিফিকেশনসহ, কত এসেছে ও কত বাকি, “Collar & cuff matrix”, ব্যাচে থাকলে “By style”, আর “Terms & conditions”। ডান পাশে সরবরাহকারীর ঠিকানা ও বুকিংয়ের বিস্তারিত।",
          image: {
            id: "production-bookings-2",
            caption: "একটি বুকিংয়ের পাতা: কাপড়, ট্রিমস, কলারের ছক ও শর্তাবলি",
          },
        },
      ],
      tips: [
        "প্রতিটি বুকিং একটি পারচেজ অর্ডারও: “Materials” > “Orders”-এও একই নম্বরে দেখায়, আর মাল আসা, বিল ও বাকি টাকা সব আগের মতোই চলে। বুকিংয়ের পাতার “Purchase order” থেকে সেই অর্ডারে যাওয়া যায়।",
        "অর্ডারের পাতায় বুকিংয়ের জন্য “Change the booking” থাকে: বুকিংয়ের আইটেম, স্পেসিফিকেশন ও শর্তাবলি বুকিংয়েই বদলায়।",
        "সুতা পাউন্ডে কিনলে একক “Pounds (lb)” বেছে নিন।",
      ],
    },
    {
      slug: "production-booking-new",
      title: "নতুন বুকিং করবেন যেভাবে (৫ ধাপ)",
      summary:
        "পাঁচ ছোট ধাপে বুকিং: উৎস ও পোশাকের ধরন, কাপড় (ধরন অনুযায়ী ঘর আর হিসাব করে পরিমাণ), ট্রিমস (নিজে থেকে বসানো, সাথে “Add custom item”), কলার-কাফের ছক, তারপর শর্তাবলি ও শেষবার মিলিয়ে দেখা।",
      keywords: [
        "new booking",
        "booking wizard",
        "knitwear",
        "woven",
        "outerwear",
        "sweater",
        "gsm",
        "dia",
        "fabric width",
        "construction",
        "yarn count",
        "gauge",
        "consumption per dozen",
        "process loss",
        "add custom item",
        "নতুন বুকিং",
        "নিট",
        "ওভেন",
        "সোয়েটার",
        "জিএসএম",
        "ডায়া",
        "কনজাম্পশন",
      ],
      routes: ["/production/bookings/new"],
      who: "যাঁদের “Add bookings”-এর অনুমতি আছে (শুরুতে Production Manager ও Super Admin): “Supplier PO (a mill or trims house)” থাকলে সাপ্লায়ার PO, “Ready stock (market purchase)” থাকলে বাজার থেকে কেনা। মাল সাথে সাথে স্টকে তুলতে কাঁচামাল কেনার অনুমতিও লাগে।",
      anyOf: ["production.bookings.supplier", "production.bookings.market"],
      steps: [
        {
          text: "“Bookings” ট্যাবে “New booking” চাপুন। উপরে ধাপগুলো দেখায়: “Booking type”, “Fabric”, “Trims & accessories”, “Collar & cuff” (শুধু নিটে) ও “Terms & review”। ফোনে কততম ধাপে আছেন (যেমন 5টির মধ্যে 1) আর একটি দাগে কতদূর এগোলেন তা দেখায়।",
          image: {
            id: "production-booking-new-1",
            caption: "বুকিংয়ের প্রথম ধাপ: উৎস ও পোশাকের ধরনের কার্ড",
          },
        },
        {
          text: "প্রথম ধাপে “Where the goods come from”-এ “Supplier PO” বা “Ready stock / market purchase” বেছে নিন। “Garment family”-তে পোশাকের ধরন: “Knitwear” (পোলো, টি-শার্ট), “Woven” (শার্ট, প্যান্ট), “Outerwear” (জ্যাকেট, ভেস্ট), “Sweater” বা “Other”। ধরন বদলালে কাপড়ের ঘর, একক আর ট্রিমস নিজে থেকে বদলে যায়।",
        },
        {
          text: "“Supplier (mill or trims house)” (বাজার থেকে কিনলে “Shop or seller”) খুঁজে বেছে নিন। চাইলে “Deliver by (optional)”, “Supplier's reference (optional)”, “Title (optional)”, “Style reference (optional)” ও “Garment pieces (optional)” দিন। পিসের সংখ্যা কাপড়ের হিসাবে নিজে থেকে বসে।",
        },
        {
          text: "বাজার থেকে কিনে মাল হাতে নিয়ে এসেছেন? “Ready stock / market purchase” বেছে “Bought and collected: add to stock now” টিক দিন (শুধু ব্যাচ ছাড়া নতুন বুকিংয়ে)। তখন মাল আসার অপেক্ষা থাকে না: সংরক্ষণ করলেই মাল মূল স্টোরে ঢোকে। প্রতিটি আইটেমে কেনা দাম লিখতে হয়, আর শেষের বোতামটি হয় “Save and add to stock”। বিলটি বিক্রেতার কাছে বাকি হিসেবে থাকে, টাকা দেয় অ্যাকাউন্টস।",
        },
        {
          text: "“Next: …” চাপুন। দ্বিতীয় ধাপ “Fabric”: নিটে একক কেজি, আর ঘর “Fabric type”, “Composition”, “Colour”, “Weight” (GSM) ও “DIA (inches)” সাথে “Tube” বা “Open”। ওভেনে একক গজ বা মিটার, ঘর “Width (inches)”, “Construction” ও “Weight” (GSM বা oz/yd²)। সোয়েটারে একক পাউন্ড বা কেজি, ঘর “Yarn count” ও “Gauge (GG)”।",
          image: {
            id: "production-booking-new-2",
            caption: "“Fabric” ধাপ: নিটের GSM, DIA ও হিসাব করে পরিমাণ",
          },
        },
        {
          text: "পরিমাণ সরাসরি লিখতে “Type it”, হিসাব করাতে “Work it out” চাপুন: “Garment pieces”, “Consumption per dozen (…)” আর “Process loss (%)” দিলে বুক করার পরিমাণ নিজে বেরিয়ে আসে (পিস ÷ ১২ × প্রতি ডজনে কাপড় + লস, উপরের দিকে রাউন্ড)। দাম জানলে “Price per …” ঘরে লিখুন, না জানলে খালি রাখুন, মাল আসার সময় দাম দেওয়া হবে।",
        },
        {
          text: "ক্যাটালগের কোনো কাপড় নিতে “Pick from the catalogue” চাপুন, না হলে নাম লিখুন: নতুন কাপড় বুকিং সংরক্ষণের সময় ক্যাটালগে যোগ হয়ে যায়। রিব বা কন্ট্রাস্ট কাপড়ের জন্য “Add another fabric”।",
        },
        {
          text: "তৃতীয় ধাপ “Trims & accessories”: নিটে “Collar”, “Cuff”, “Twill tape” ও “Button”, ওভেনে “Pocketing”, “Interlining”, “Collar bone” ও “Button”, আউটারওয়্যারে “Lining”, “Padding” ও “Zipper” নিজে থেকে বসে থাকে। প্রতিটির পরিমাণ লিখুন, দরকার না হলে “Remove”। মুছে ফেলা ট্রিম “Add back a standard trim” থেকে ফেরত আনা যায়, আর তালিকার বাইরের কিছু “Add custom item” দিয়ে যোগ করুন।",
          image: {
            id: "production-booking-new-3",
            caption: "“Trims & accessories” ধাপ ও “Add custom item”",
          },
        },
        {
          text: "নিটে চতুর্থ ধাপ “Collar & cuff”: “কলার ও কাফের ছক পূরণ করবেন যেভাবে” গাইডটি দেখুন। কলার ও কাফের পরিমাণ ছক থেকেই আসে।",
        },
        {
          text: "শেষ ধাপ “Terms & review”: “Payment terms (optional)”, “Deliver to (optional)”, শর্তাবলি (ইংরেজি বা বাংলা) আর “Notes (optional)”। নিচে “Check before saving”-এ পুরো বুকিং একবার মিলিয়ে নিন, তারপর “Save the booking” চাপুন।",
        },
      ],
      tips: [
        "প্রতিটি “Next: …” চাপলে সেই ধাপের ভুল সাথে সাথে লাল হয়ে দেখায়; ঠিক না করলে পরের ধাপে যাওয়া যায় না। উপরের ধাপের নামে চেপে যেকোনো ধাপে ফেরা যায়, ভুল থাকা ধাপ লাল দেখায়।",
        "শেষ ধাপে “Save the booking” না চাপা পর্যন্ত কিছুই সংরক্ষণ হয় না।",
        "ধরন বদলানোর আগে আইটেমে কিছু লিখে থাকলে সেগুলো রাখা হয়, আর নতুন ধরনের আইটেম আনতে একটি বোতাম দেখায়।",
        "পিস (PCS), সেট, রোল বা কোনের মতো একক ভাগে লেখা যায় না, পুরো সংখ্যায় লিখতে হয়।",
        "সংরক্ষণ করা বুকিং “Draft” থাকে: মালিক “Approve booking” দিলে তবেই সরবরাহকারীকে পাঠানো ও মাল নেওয়া যায়।",
      ],
    },
    {
      slug: "production-booking-collar",
      title: "কলার ও কাফের ছক (Collar & cuff matrix) পূরণ করবেন যেভাবে",
      summary:
        "পোলোর ফ্ল্যাট-নিট কলার ও কাফ সাইজ গ্রুপ (যেমন S-M: 42×9, L-XL: 44×9, 2XL: 46×9) আর পোশাকের রং অনুযায়ী বুক করা: কলারের ধরন, মাপ, প্রতিটি রঙের পিস, আর অতিরিক্ত ভাগসহ মোট সেট নিজে থেকে হিসাব।",
      keywords: [
        "collar",
        "cuff",
        "collar matrix",
        "collar size",
        "tipping",
        "jacquard rib",
        "ambush rib",
        "honeycomb",
        "flat knit",
        "sets",
        "কলার",
        "কাফ",
        "টিপিং",
        "ফ্ল্যাট নিট",
        "সেট",
      ],
      routes: ["/production/bookings/new"],
      who: "যাঁদের “Add bookings”-এর অনুমতি আছে: শুরুতে Production Manager ও Super Admin।",
      anyOf: ["production.bookings.supplier", "production.bookings.market"],
      steps: [
        {
          text: "নিটের বুকিংয়ে “Collar & cuff” ধাপে “Book collars and cuffs by size and colour” টিক দেওয়া থাকে। টিক তুলে দিলে কলার ও কাফ ট্রিমসের ধাপে লেখা পরিমাণেই বুক হয়।",
          image: {
            id: "production-booking-collar-1",
            caption: "“Collar & cuff” ধাপ: কলারের ধরন, সাইজ গ্রুপ ও রঙের পিস",
          },
        },
        {
          text: "“Collar style” থেকে বেছে নিন: “Solid”, “Jacquard rib”, “Ambush rib”, “Tipping” বা “Honeycomb”। “Tipping” বাছলে প্রতিটি রঙে “Tipping colour” ঘর আসে।",
        },
        {
          text: "“Extra over the pieces (%)”-এ নিটিং ও লিংকিংয়ের লসের জন্য অতিরিক্ত ভাগ দিন (নিজে থেকে ৩%)।",
        },
        {
          text: "“Size groups and measurements (cm)”-এ প্রতিটি “Size group”-এর নাম (যেমন S-M), “Collar” দৈর্ঘ্য × প্রস্থ আর “Cuff (optional)” দৈর্ঘ্য × প্রস্থ দিন (যেমন 38 × 3.5)। নতুন গ্রুপের জন্য “Add size group”, এতে কলার নিজে থেকে ২ সেমি লম্বা বসে।",
        },
        {
          text: "“Garment pieces by colour”-এ প্রতিটি রঙের জন্য “Garment colour” লিখুন, কলার অন্য রঙের হলে “Collar colour”, তারপর প্রতিটি সাইজ গ্রুপের ঘরে পোশাকের পিস। প্রতিটি ঘরের নিচে সেই ঘরের সেট আর রঙের নিচে মোট সেট সাথে সাথে দেখায়। আরেকটি রঙের জন্য “Add colour”।",
          image: {
            id: "production-booking-collar-2",
            caption: "রং × সাইজ গ্রুপের ঘর ও সাথে সাথে হিসাব হওয়া সেট",
          },
        },
        {
          text: "নিচে মোট দেখায়: “Garment pieces”, “Collar sets to knit”, “Cuffs (2 a set)”, আর সাইজ গ্রুপ অনুযায়ী মাপ, পিস ও সেটের একটি টেবিল। দরকারে “Collar & cuff notes (optional)” লিখুন।",
        },
      ],
      tips: [
        "সেট = পিস + অতিরিক্ত ভাগ, প্রতিটি ঘরে উপরের দিকে রাউন্ড করা; তাই মাল কখনো কম পড়ে না।",
        "কাফ পিসে বুক হলে প্রতি সেটে ২টি গোনা হয়, সেটে বুক হলে ১টি।",
        "ছক চালু থাকলে ট্রিমসে অন্তত একটি “Collar” বা “Cuff” আইটেম লাগে, আর সেগুলোর একক পিস বা সেট হতে হয়। কোনো আইটেম কলার বা কাফ হিসেবে গুনতে “Counts as” থেকে বেছে নিন।",
        "ব্যাচ থেকে বুকিং করলে ব্যাচের স্টাইলগুলোর রং ও সাইজের পিস সাইজ গ্রুপ অনুযায়ী নিজে থেকে বসে যায় (M যায় S-M-এ, XXL যায় 2XL-এ)।",
      ],
    },
    {
      slug: "production-booking-print",
      title: "বুকিংয়ের শর্তাবলি বাংলা বা ইংরেজিতে দেবেন ও PDF প্রিন্ট করবেন যেভাবে",
      summary:
        "মান, GSM ও DIA-র সহনসীমা, শেড, ৪-পয়েন্ট ত্রুটি নীতি আর ন্যাপস বা লোমশ কাপড়ের কড়া শর্তাবলি ইংরেজি বা বাংলায় নিজে থেকে বসে; তারপর Landscape বা Portrait-এ PDF: উপরে বাঁধাইয়ের ফাঁকা জায়গা, প্রতিটি পাতায় কোম্পানির হেডার ও ফুটার, নেভি টেবিল, QR কোড, কাপড়ের সোয়াচ লিস্ট আর সরবরাহকারীর সই।",
      keywords: [
        "terms and conditions",
        "bengali terms",
        "booking pdf",
        "print booking",
        "qr code",
        "spiral binding",
        "page numbers",
        "landscape",
        "portrait",
        "swatch list",
        "orientation",
        "gsm tolerance",
        "defect policy",
        "naps",
        "hairy",
        "শর্তাবলি",
        "বাংলা শর্ত",
        "প্রিন্ট",
        "কিউআর কোড",
        "স্পাইরাল বাঁধাই",
        "সোয়াচ লিস্ট",
        "আড়াআড়ি",
        "লম্বালম্বি",
      ],
      routes: ["/production/bookings/[bookingId]"],
      who: "শর্তাবলি বদলান যাঁদের “Add bookings”-এর অনুমতি আছে। PDF প্রিন্ট করতে পারেন যিনি বুকিং দেখতে পারেন; দাম ছাড়া প্রিন্ট হয় যাঁরা দাম দেখতে পারেন না তাঁদের জন্য।",
      steps: [
        {
          text: "বুকিংয়ের শেষ ধাপ “Terms & review”-এ উৎস ও পোশাকের ধরন অনুযায়ী কড়া শর্তাবলি নিজে থেকে বসে থাকে, প্রতিটি শর্ত আলাদা ঘরে, নম্বরসহ।",
          image: {
            id: "production-booking-print-1",
            caption: "শর্তাবলির ঘর ও “English” / “বাংলা” বোতাম",
          },
        },
        {
          text: "“Language of the terms”-এর পাশে “English” বা “বাংলা” চাপুন। শর্তাবলি না বদলে থাকলে সাথে সাথে অন্য ভাষার শর্তাবলি চলে আসে। নিজে বদলে থাকলে জিজ্ঞেস করে: “Load the standard terms” চাপলে আদর্শ শর্তাবলি আসে, “Keep mine” চাপলে আপনার লেখা থাকে।",
        },
        {
          text: "যেকোনো শর্ত ঘরে বদলান, ঘরের পাশের ক্রস চিহ্নে মুছুন, নতুন শর্তের জন্য “Add a condition”। কোলনের আগে শিরোনাম লিখলে (যেমন “Shade: …”) PDF-এ তা মোটা অক্ষরে ছাপা হয়। আবার শুরু করতে “Reset to the standard terms”।",
        },
        {
          text: "বুকিং সংরক্ষণের পর তার পাতায় “Print booking (PDF)” চাপুন। একটি ছোট জানালা জিজ্ঞেস করে “Which way round?”: “Landscape” (পাতা আড়াআড়ি) বা “Portrait” (পাতা লম্বালম্বি)। বেছে নিয়ে “Download the PDF” চাপুন। আপনার শেষ বাছাই মনে থাকে; প্রথমবার “Landscape” বাছাই করা থাকে।",
        },
        {
          text: "A4 PDF-এর প্রতিটি পাতার উপরে ১৫ মিমি ফাঁকা জায়গা থাকে বাঁধাইয়ের জন্য। তার নিচে হেডার: বাঁয়ে কোম্পানির নাম ও ট্যাগলাইন, মাঝে ডকুমেন্টের নাম, ডানে DOC NO, BUYER · PO, DATE আর PREPARED BY: যিনি বুকিংটি বানিয়েছেন তাঁর নাম, পাশে সইয়ের রেখা। কোম্পানির নাম, ক্রেতা বা ঠিকানা লম্বা হলে কেটে “…” হয় না, দ্বিতীয় লাইনে যায়। প্রথম পাতায় QR কোড (স্ক্যান করলে বুকিংটি খোলে), তারপর নেভি রঙের মাথাসহ কাপড় ও ট্রিমসের টেবিল, কলার-কাফের ছক আলাদা পাতায়, ব্যাচে থাকলে স্টাইল অনুযায়ী ভাগ, নম্বর দেওয়া শর্তাবলি আর চারটি সই।",
          image: {
            id: "production-booking-print-2",
            caption: "বুকিংয়ের PDF: হেডার, QR কোড, কাপড়ের টেবিল ও ফুটার",
          },
        },
        {
          text: "কাপড় থাকলে শেষ পাতায় “Fabric swatch list”: স্টাইল ও রং অনুযায়ী এক সারি করে, প্রতিটিতে প্রায় ১৫ মিমি উঁচু “Swatch paste area” (কাপড় এলে সোয়াচ আঠা দিয়ে লাগান), পরিমাণ, আর হাতে লেখার জন্য “No. of rolls” ও “Cutting report”। শেষ সারিতে সরবরাহকারীর মোট কাপড়।",
        },
        {
          text: "প্রতিটি পাতার নিচে নেভি রেখার নিচে কোম্পানির নাম, ফোন, ইমেইল ও ঠিকানা আর পাতার নম্বর (যেমন PAGE 2 OF 5), তার উপরে সরবরাহকারীর ছোট সইয়ের জায়গা (“Supplier's initials”, বাজার থেকে কেনায় “Seller's initials”)। টেবিল কয়েক পাতা জুড়ে চললে প্রতিটি পাতায় টেবিলের মাথা আবার ছাপা হয়, কোনো সারি দুই পাতায় ভাঙে না। কোনো সংখ্যা কখনো কাটা হয় না: সাইজ বা কলাম অনেক হলে আগে অক্ষর ছোট হয়, তাতেও না ধরলে টেবিল দুই বা বেশি ভাগে ছাপা হয়, প্রতিটি ভাগে রঙ বা বিবরণের কলাম আবার থাকে আর শিরোনামে লেখা থাকে কোন কলাম থেকে কোন কলাম (continued)। পাতার নম্বর সবসময় পুরো ছাপা হয়।",
        },
      ],
      tips: [
        "শর্তাবলির ঘর পুরো খালি করে সংরক্ষণ করলে সেই ভাষার আদর্শ শর্তাবলি বসে যায়।",
        "মাল আসার পরও শর্তাবলি ও ভাষা বদলানো যায়: বুকিংয়ের পাতায় “Change the paperwork”। বদলানোর পর PDF আবার প্রিন্ট করে সরবরাহকারীকে দিন।",
        "বাতিল বা বন্ধ বুকিংয়ের PDF-এ বড় করে “Cancelled” বা “Closed” ছাপা থাকে।",
        "হেডারের BUYER · PO ঘরে ক্রেতার নাম নয়, ব্যাচ বা স্টাইলের রেফারেন্স ছাপা হয়।",
        "হেডারের ট্যাগলাইন, ফুটারের ঠিকানা-ফোন আর কোম্পানির শুরুর দিক (Landscape বা Portrait) বদলাতে “Settings” > “Company” > “Letterhead”।",
      ],
    },
    {
      slug: "production-booking-batch",
      title: "ব্যাচের কাপড় বুক করবেন ও বুকিং ব্যাচে যোগ (Attach) করবেন যেভাবে",
      summary:
        "মাস্টার ব্যাচের কাপড় শুধু বুকিং দিয়েই অর্ডার হয়: ব্যাচের পাতা থেকে “Book fabric” চাপলে বাকি কাপড়, পোশাকের ধরন আর রঙের পিস নিজে থেকে বসে; আগে আলাদা করা বুকিং “Attach a booking” দিয়ে ব্যাচে যোগ হয়, আর মাল আসার আগে সরানো যায়।",
      keywords: [
        "book fabric",
        "attach booking",
        "attach a booking",
        "take off",
        "fabric bookings",
        "batch fabric",
        "fabric rule",
        "কাপড় বুক",
        "ব্যাচে যোগ",
        "বুকিং যোগ",
        "ব্যাচের কাপড়",
      ],
      routes: ["/production/batches/[batchId]"],
      who: "“Book fabric” পান যাঁদের “Add bookings”-এর অনুমতি আছে। বুকিং ব্যাচে যোগ ও সরান যাঁদের “Attach bookings to a batch” আছে (শুরুতে Production Manager ও Super Admin)।",
      steps: [
        {
          text: "ব্যাচের পাতায় ডান পাশে “Fabric bookings” অংশে ব্যাচের সব বুকিং দেখায়: নম্বর, সরবরাহকারী, কত কাপড় আর কবে দেওয়ার কথা। “Materials” অংশেও “Book fabric” বোতাম থাকে।",
          image: {
            id: "production-booking-batch-1",
            caption: "ব্যাচের পাতায় “Fabric bookings” অংশ",
          },
        },
        {
          text: "“Book fabric” চাপুন। বুকিং ব্যাচের জন্য খোলে: যে কাপড় বুক করা বাকি তা পরিমাণসহ, পোশাকের ধরন স্টাইল থেকে, মোট পিস, আর নিটে স্টাইলগুলোর রং ও সাইজের পিস কলারের ছকে বসানো থাকে। ব্যাচের অন্য কাঁচামাল “From the batch's materials” থেকে এক চাপে যোগ হয়।",
        },
        {
          text: "সংরক্ষণ করলে বুকিংয়ের প্রতিটি লাইন ব্যাচের স্টাইল, রং ও সাইজ অনুযায়ী ভাগ হয়ে যায়, তাই “Materials”-এ সেই কাপড় অর্ডার হয়ে গেছে দেখায়। মাল আসে ব্যাচের “Receive a delivery” দিয়ে।",
        },
        {
          text: "আগে আলাদা করা খোলা বুকিং ব্যাচে আনতে “Attach a booking” চাপুন, তালিকা থেকে বুকিং বেছে “Attach”। অথবা বুকিংয়ের পাতা থেকে “Attach to a batch” চেপে ব্যাচ বেছে নিন। ব্যাচের স্টাইলে লাগে না এমন আইটেম বুকিংয়ে থাকে, কিন্তু কোনো স্টাইলের অর্ডার হিসেবে গোনা হয় না, সেটি বার্তায় বলে দেয়। অনুমোদিত বুকিং ব্যাচে যোগ করলে তা নতুন সংশোধনী (R1) হয়ে আবার “Draft” হয়, আর ব্যাচের চেক (টেক প্যাক, Fabric first) পার হয়ে আবার অনুমোদন লাগে।",
          image: {
            id: "production-booking-batch-2",
            caption: "“Attach a booking” জানালায় খোলা বুকিংয়ের তালিকা",
          },
        },
        {
          text: "ভুল ব্যাচে গেলে মাল আসার আগে “Take off” (বুকিংয়ের পাতায় “Take off the batch”) চেপে “Take it off” দিন। বুকিং ব্যাচের হিসাব থেকে সরে যায়; অনুমোদিত বুকিং হলে তা নতুন সংশোধনী হয়ে আবার অনুমোদন লাগে।",
        },
      ],
      tips: [
        "ব্যাচের “Make purchase orders”-এ কাপড় দেওয়া যায় না: সেখানে শুধু ট্রিমস ও অ্যাক্সেসরিজ। কাপড়ের GSM, DIA, রং আর শর্তাবলি তাই সবসময় বুকিংয়ে থাকে।",
        "নতুন ব্যাচ খোলার সময় কাপড় দেওয়া হয় না। ব্যাচে স্টাইল যোগ করার পর তার পাতা থেকে “Book fabric” বা “Attach a booking”।",
        "যে ব্যাচে কোনো খোলা স্টাইল নেই, তাতে বুকিং যোগ করা যায় না।",
        "মাল আসা শুরু হলে বুকিং আর ব্যাচ থেকে সরানো যায় না।",
        "ব্যাচের বুকিংয়ে কোনো স্টাইলের কাঁচামালের তালিকায় নেই এমন আইটেম থাকলে অনুমোদনের চেকে তা ব্যাচের সব খোলা স্টাইলের জন্য ধরা হয়, তাই টেক প্যাকের নিয়ম এড়িয়ে যাওয়া যায় না। চেকে হলুদ লাইনে আইটেমগুলোর নাম দেখায়।",
        "অনুমোদনের পরে কোনো স্টাইলের কাপড় বদলালে ব্যাচের পাতার “Fabric bookings” অংশে আর বুকিংয়ের তালিকায় সেই বুকিংয়ে লাল “Fabric changed” চিহ্ন বসে, সঙ্গে কত কেজি কাপড় ঝুঁকিতে।",
      ],
    },
    {
      slug: "production-booking-change",
      title: "বুকিং বদলাবেন, মাল নেবেন, বন্ধ বা বাতিল করবেন যেভাবে",
      summary:
        "মাল আসার আগে পুরো বুকিং বদলানো যায় (সরবরাহকারী, আইটেম, ছক, শর্তাবলি); মাল আসার পর শুধু কাগজপত্র (তারিখ, রেফারেন্স, শর্তাবলি)। বাকিটা আর না এলে বন্ধ, কিছু না এলে বাতিল।",
      keywords: [
        "change booking",
        "edit booking",
        "change the paperwork",
        "receive the goods",
        "close booking",
        "cancel booking",
        "বুকিং বদল",
        "বুকিং বাতিল",
        "বুকিং বন্ধ",
        "মাল গ্রহণ",
      ],
      routes: ["/production/bookings/[bookingId]/edit"],
      who: "বদলান যাঁদের “Add bookings”-এর অনুমতি আছে, বন্ধ বা বাতিল করেন যাঁদের “Close or cancel bookings” আছে (শুরুতে Production Manager ও Super Admin)। মাল নেন যাঁদের কাঁচামাল কেনার অনুমতি আছে, আর ব্যাচের বাইরের বুকিংয়ে Accounts-ও।",
      anyOf: [
        "production.bookings.supplier",
        "production.bookings.market",
        "production.bookings.close",
      ],
      steps: [
        {
          text: "বুকিংয়ের পাতায় “Change” চাপুন। মাল আসার আগে পাঁচ ধাপের পুরো ফর্ম খোলে, সব বদলে “Save the changes” চাপুন। ব্যাচে থাকা বুকিংয়ের নতুন লাইনও আবার স্টাইল অনুযায়ী ভাগ হয়।",
        },
        {
          text: "মাল আসা শুরু হলে বোতামটি হয় “Change the paperwork”: শুধু তারিখ, রেফারেন্স, শিরোনাম, পেমেন্ট ও ডেলিভারির শর্ত, শর্তাবলি ও তার ভাষা আর নোট বদলায়। “Save the paperwork” চাপুন। অনুমোদিত বুকিংয়ে “Deliver by”, “Deliver to”, “Payment terms” বা শর্তাবলি বদলালে বুকিং নতুন সংশোধনী (R1) হয়ে আবার অনুমোদন লাগে; শিরোনাম, রেফারেন্স আর নোট বদলালে হয় না।",
        },
        {
          text: "মাল এলে “Receive the goods” চাপুন। ব্যাচের বুকিং ব্যাচের “Receive a delivery” পাতায় খোলে (চালান বনাম আসল), আলাদা বুকিং “Materials”-এর সাধারণ মাল গ্রহণে। “Bought and collected: add to stock now” দিয়ে রাখা বাজারের কেনাকাটা সংরক্ষণের সময়েই স্টোরে ঢুকে যায়, তাতে আর মাল নিতে হয় না।",
        },
        {
          text: "কিছু এসেছে কিন্তু বাকিটা আর আসবে না হলে “Close: the rest will not come”, কিছুই না এলে “Cancel the booking”। দুটোতেই কারণ লিখতে হয়, আর সরবরাহকারীকে জানাতে হয়।",
        },
      ],
      tips: [
        "অর্ডারের পাতা (“Materials” > “Orders”) থেকে বুকিংয়ের আইটেম বদলানো যায় না; সেখানে “Change the booking” চাপলে বুকিংয়ের ফর্ম খোলে।",
        "বন্ধ বা বাতিল বুকিং আর বদলায় না, তবে তার PDF প্রিন্ট করা যায়।",
        "অনুমোদিত বা পাঠানো বুকিংয়ের আইটেম, ভেতরে আসার তারিখ, ডেলিভারির জায়গা, পেমেন্টের শর্ত বা শর্তাবলি বদলালে তা নতুন সংশোধনী (R1, R2) হয়ে আবার “Draft” হয়, আর অনুমোদনের আগে তাতে মাল নেওয়া যায় না। “বুকিং অনুমোদন (Approve) করবেন …” গাইডটি দেখুন।",
      ],
    },
    {
      slug: "production-booking-approval",
      title:
        "বুকিং অনুমোদন (Approve) করবেন, সরবরাহকারীকে পাঠাবেন আর সংশোধনী (R1, R2) সামলাবেন যেভাবে",
      summary:
        "প্রতিটি নতুন বুকিং প্রথমে “Draft” থাকে: চেকগুলো পার হলে মালিক “Approve booking” দেন, তারপর ছাপা বুকিং সরবরাহকারীকে দিয়ে “Mark as sent to the supplier”। অনুমোদিত বা পাঠানো বুকিং বদলালে তা নতুন সংশোধনী (R1, R2) হয়, বদলগুলো লাল রঙে দেখায়, আর আবার অনুমোদন লাগে।",
      keywords: [
        "approve booking",
        "booking approval",
        "draft booking",
        "mark as sent",
        "sent to the supplier",
        "revision",
        "r1",
        "r2",
        "changes from r0",
        "fabric at risk",
        "বুকিং অনুমোদন",
        "অনুমোদন",
        "ড্রাফট",
        "সংশোধনী",
        "রিভিশন",
      ],
      routes: ["/production/bookings/[bookingId]"],
      who: "অনুমোদন দেন যাঁদের “Approve bookings before they go to the supplier” অনুমতি আছে (শুরুতে শুধু Super Admin, মানে মালিক)। “Mark as sent to the supplier” চাপেন যাঁরা বুকিং করেন (“Add bookings”)।",
      steps: [
        {
          text: "নতুন বুকিং সংরক্ষণ করলে তা “Draft” থাকে: তালিকায় ও বুকিংয়ের পাতায় হলুদ “Draft” চিহ্ন, আর PDF-এ লাল “Draft” ছাপ। অনুমোদনের আগে বুকিংটি সরবরাহকারীকে পাঠানো হয় না, আর এতে মালও নেওয়া যায় না।",
        },
        {
          text: "বুকিংয়ের পাতার উপরে অনুমোদনের আগের চেকগুলো দেখায়। সবুজ টিক মানে ঠিক আছে, হলুদ মানে সতর্কতা (যেমন কাপড়ের বুকিংয়ে স্টাইলের টেক প্যাক এখনো অনুমোদিত নয়), লাল মানে আগে ঠিক করতে হবে, যেমন “Set the in-house date (Deliver by) in the paperwork”। লাল কিছু থাকলে “Approve booking” বোতাম কাজ করে না।",
        },
        {
          text: "কলার, কাফ আর ট্রিমস অপেক্ষা করে স্টাইলের পুরো টেক প্যাক অনুমোদন পর্যন্ত: লাল লাইনে লেখা থাকে “Collar, cuff and trims wait for the tech pack of … to be approved”। খুব দরকার হলে মালিক “Approve with a reason” চেপে “Reason” ঘরে কারণ লিখে (অন্তত ৫ অক্ষর) “Approve booking” দিতে পারেন। কারণটি আপনার নামসহ কার্যকলাপের লগে থাকে। অন্য কেউ (যিনি বুকিং অনুমোদন করেন তিনিও) এটা পারেন শুধু যদি মালিক তাঁর রোলে “Approve collar, cuff and trims before the tech pack is approved (with a reason)” টিক দেন; না থাকলে বোতামটি দেখায়ই না। AI কখনো এভাবে অনুমোদন করে না।",
          image: {
            id: "production-booking-approval-1",
            caption: "লাল চেকসহ বুকিং আর “Approve with a reason” বোতাম",
          },
        },
        {
          text: "সব ঠিক থাকলে “Approve booking” চাপুন, জানালায় আবার “Approve booking”। বুকিং হয় “Approved”, আর সেই সময়ের বুকিংটি R0 হিসেবে রাখা হয়। এখন থেকে এর মাল নেওয়া যায়।",
        },
        {
          text: "“Print booking (PDF)” দিয়ে বুকিং ছেপে সরবরাহকারীকে দিন, তারপর “Mark as sent to the supplier” চেপে “Mark as sent”। বুকিং হয় “Sent”, কে কবে পাঠালেন তা পাতায় লেখা থাকে।",
        },
        {
          text: "অনুমোদিত বা পাঠানো বুকিংয়ে “Change” চেপে সরবরাহকারী, তারিখ, পিস, আইটেম, পরিমাণ, স্পেসিফিকেশন, দাম, কলারের ছক, ডেলিভারির জায়গা, পেমেন্টের শর্ত বা শর্তাবলি বদলালে, অথবা বুকিং কোনো ব্যাচে যোগ বা সরালে, বুকিং নতুন সংশোধনী হয়ে আবার “Draft” হয়: নম্বরের শেষে R1 বসে (যেমন PO-2026-00012-R1), পরের বদলে R2।",
        },
        {
          text: "বুকিংয়ের পাতায় “Changes from …” অংশে প্রতিটি বদল দেখায়: আগে কী ছিল (কাটা দাগে) আর এখন কী (লাল রঙে)। পাঠানো বুকিংয়ের কাপড় বদলালে “Fabric at risk” লাইনে দেখায় কোন কাপড় সরবরাহকারী হয়তো আগেই বানানো শুরু করেছে: তাঁদের সাথে কথা বলে ঠিক করুন সেটির কী হবে। এই বদলের তালিকা সংশোধনীর PDF-এও থাকে।",
        },
        {
          text: "নতুন সংশোধনী আবার “Approve booking” দিয়ে অনুমোদন করে ছেপে পাঠান, তারপর “Mark as sent to the supplier”। সরবরাহকারী তখন নতুনটি অনুযায়ী কাজ করেন।",
        },
        {
          text: "অনুমোদনের পরে স্টাইলের প্রতি পিসের কাপড় বদলালে বুকিংয়ের পাতায় লাল রঙে “Fabric changed after this booking was approved” দেখায়, কী বদলেছে তাসহ, আর প্রতিটি স্টাইলের নিচে “Fabric at risk” লাইনে এই বুকিংয়ে সেই স্টাইলের জন্য কত কেজি কাপড় আছে। বুকিংয়ের তালিকায় আর ব্যাচের পাতায়ও লাল “Fabric changed” চিহ্নে মোট কেজি দেখায়। বুকিং বদলে নতুন সংশোধনী পাঠান, অথবা সরবরাহকারীকে জানান যে আগেরটিই থাকছে।",
        },
      ],
      tips: [
        "শুধু শিরোনাম, স্টাইলের রেফারেন্স, সরবরাহকারীর রেফারেন্স বা নোট বদলালে নতুন সংশোধনী হয় না। শর্তাবলি বা তার ভাষা বদলালে হয়, কারণ সেটি সরবরাহকারীকে জানানো হয়।",
        "দাম যাঁরা দেখতে পারেন না, তাঁরা বদলের তালিকায় দামের বদল দেখেন না; PDF-এও দাম থাকে না।",
        "বাজার থেকে কিনে সঙ্গে সঙ্গে স্টোরে তোলা কেনাকাটা (“Bought and collected: add to stock now”) সরাসরি “Sent” হয়, তাতে অনুমোদন লাগে না।",
        "আগে থেকে থাকা বুকিংগুলো “Sent” হিসেবেই আছে; বদলালে সেগুলোও R1 হয়।",
      ],
    },
    {
      slug: "production-booking-book",
      title: "ব্যাচের বুকিং বই (Booking book) PDF নেবেন যেভাবে",
      summary:
        "একটি ব্যাচের সব বুকিং এক বইয়ে: প্রথম পাতায় কে কোন অংশ পাবেন (“Distribution list”), তারপর অর্ডারের সারাংশ, প্রতিটি সরবরাহকারীর কাপড়, কলার-কাফ ও ট্রিমসের পাতা, প্রয়োজন বনাম বুকিংয়ের হিসাব, সই আর কাপড়ের নমুনার (swatch) তালিকা। এতে কোনো দাম থাকে না।",
      keywords: [
        "booking book",
        "distribution list",
        "swatch list",
        "booking pdf",
        "batch booking",
        "sign-off",
        "landscape",
        "portrait",
        "বুকিং বই",
        "বুকিং বুক",
        "সোয়াচ",
        "নমুনা",
      ],
      routes: ["/production/batches/[batchId]"],
      who: "নিতে পারেন যাঁরা বুকিং দেখতে পারেন (“See bookings” বা বুকিংয়ের অন্য কোনো অনুমতি)।",
      steps: [
        {
          text: "ব্যাচের পাতায় “Fabric bookings” অংশে “Booking book (PDF)” চাপুন।",
        },
        {
          text: "“Which way round?”-এ “Landscape” বা “Portrait” বেছে “Download the PDF” চাপুন। আপনার শেষ বাছাই পরের বার নিজে থেকে বাছা থাকে; শুরুতে “Landscape”। দুটোতেই উপরে বাঁধাইয়ের জন্য 15 mm ফাঁকা জায়গা থাকে।",
        },
        {
          text: "প্রথম পাতার “Distribution list”-এ দেখায় কোন অংশ কার কাছে যাবে: মার্চেন্ডাইজিং অর্ডারের সারাংশ, প্রতিটি মিল তার কাপড়ের অংশ, কলার-কাফ ও ট্রিমস সরবরাহকারী তাঁদের অংশ, স্টোর ও কাটিং নমুনার তালিকা, আর মালিক সারাংশ ও সই। প্রতিটি অংশের বুকিং নম্বর, পাতা নম্বর, ইন-হাউস তারিখ আর অবস্থা (“Draft”, “Approved” বা “Sent”) সেখানে লেখা।",
        },
        {
          text: "অর্ডারের সারাংশে প্রতিটি স্টাইলের কোড (A, B, C), রং আর সাইজ অনুযায়ী পিস থাকে; কাপড়ের পাতায় প্রতিটি রঙের কোড (যেমন A-01) ধরে কোন স্টাইলের কোন রঙে কত কাপড়।",
        },
        {
          text: "সারাংশের পাতায় প্রতিটি কাঁচামালের প্রয়োজন বনাম বুক করা পরিমাণ (“OK” বা “Short”) আর সব বুকিংয়ের অবস্থা। সইয়ের পাতায় যিনি বানালেন, যিনি দেখলেন, যিনি অনুমোদন দিলেন আর সরবরাহকারীর সই।",
        },
        {
          text: "শেষে প্রতিটি কাপড় সরবরাহকারীর জন্য নমুনার তালিকা: প্রতিটি কাপড়ের পাশে নমুনা লাগানোর ঘর, স্টোর ও কাটিংয়ের জন্য।",
        },
      ],
      tips: [
        "বইয়ে কোনো দাম নেই, তাই প্রতিটি অংশ ছিঁড়ে সরাসরি সরবরাহকারীকে দেওয়া যায়।",
        "একটি বুকিংয়ের PDF আলাদা নিতে বুকিংয়ের পাতা থেকে “Print booking (PDF)”।",
      ],
    },
    {
      slug: "production-fabric-first",
      title: "আগে কাপড় পাঠাবেন (Fabric first) আর টেক প্যাক অনুমোদন করবেন যেভাবে",
      summary:
        "তাড়া থাকলে মালিক ব্যাচে “Send fabric first” চালু করেন: তখন প্রতিটি স্টাইলের কাপড়ের অংশ (“Lock fabric part”) লক হলেই কাপড়ের বুকিং অনুমোদন হয়, আর ট্রিমস অপেক্ষা করে পুরো টেক প্যাক অনুমোদন (“Approve tech pack”) পর্যন্ত। লক বা অনুমোদনের পরে কাপড় বদলালে লাল রঙে দেখায়।",
      keywords: [
        "fabric first",
        "send fabric first",
        "tech pack approval",
        "approve tech pack",
        "lock fabric part",
        "fabric lock",
        "টেক প্যাক অনুমোদন",
        "আগে কাপড়",
        "কাপড় লক",
        "ফেব্রিক ফার্স্ট",
      ],
      routes: ["/production/projects/[projectId]"],
      who: "“Send fabric first” চালু বা বন্ধ করেন যাঁদের “Approve bookings before they go to the supplier” অনুমতি আছে। কাপড়ের অংশ লক ও টেক প্যাক অনুমোদন করেন যাঁদের “Lock a style's fabric part and approve its tech pack for production” অনুমতি আছে। শুরুতে দুটোই শুধু Super Admin-এর।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "স্টাইলের (প্রজেক্টের) পাতায় “Tech pack approval” অংশে টেক প্যাকের অবস্থা দেখায়: ড্রাফট, কাপড়ের অংশ লক করা, বা অনুমোদিত। আগে “Materials per piece”-এ স্টাইলের কাপড় দিতে হয়।",
        },
        {
          text: "“Lock fabric part” চাপলে স্টাইলের কাপড়, প্রতি পিসে কতটুকু আর রং ও সাইজের পিস যেমন আছে তেমন রাখা হয়, যাতে বাকি টেক প্যাক শেষ হওয়ার আগেই কাপড় বুক করা যায়।",
        },
        {
          text: "পুরো টেক প্যাক তৈরি হলে “Approve tech pack” চাপুন। স্টাইলটি উৎপাদনের জন্য অনুমোদিত হয়, কাপড়ের অংশও সাথে লক হয়, আর ট্রিমস বুক করা যায়।",
        },
        {
          text: "ব্যাচের পাতায় “Fabric bookings” অংশে “Send fabric first” চেপে নিশ্চিত করুন। অংশটিতে প্রতিটি স্টাইলের টেক প্যাকের অবস্থা দেখায় (“Tech pack approved”, “Fabric part locked” বা “Tech pack in draft”)। বন্ধ করতে “Turn off Fabric first”।",
        },
        {
          text: "Fabric first চালু থাকলে কাপড়ের বুকিং অনুমোদন হয় যখন তার সব স্টাইলের কাপড়ের অংশ লক করা। কলার, কাফ আর ট্রিমস সবসময় (Fabric first চালু হোক বা না হোক) অপেক্ষা করে পুরো টেক প্যাক অনুমোদন পর্যন্ত; মালিক কারণ লিখে “Approve with a reason” দিয়ে আগে অনুমোদন করতে পারেন। Fabric first বন্ধ থাকলে কাপড়ের বুকিংয়ে অনুমোদিত না হওয়া টেক প্যাক শুধু হলুদ সতর্কতা।",
        },
        {
          text: "লক বা অনুমোদনের পরে স্টাইলের কাপড় বদলালে “Tech pack approval” অংশে লাল রঙে আগে কী ছিল আর এখন কী দেখায়। “Lock the fabric part again” বা “Approve again” চেপে নতুনটি রাখুন, আর কাপড়ের বুকিং বদলে নতুন সংশোধনী পাঠান।",
        },
      ],
      tips: [
        "স্টাইল লক বা অনুমোদনের পরেও বদলানো যায়; বদল শুধু লাল রঙে দেখায়, কিছু আটকায় না।",
        "AI কখনো টেক প্যাক অনুমোদন বা লক করে না; এটি সবসময় মানুষের কাজ।",
      ],
    },
    {
      slug: "production-tech-pack",
      title: "স্টাইলের টেক প্যাক (Tech pack) তৈরি ও পূর্ণ করবেন যেভাবে",
      summary:
        "স্টাইলের টেক প্যাক পাতায় মাপের ছক, AI খসড়া, বিশেষজ্ঞের পরামর্শ, সংরক্ষিত রেফারেন্স, লোগো ও রং এক জায়গায়। প্রতিটি জিনিস সবুজ (নিশ্চিত), হলুদ (AI-এর অনুমান) বা লাল (নেই), আর উপরে কত শতাংশ পূর্ণ তা দেখায়।",
      keywords: [
        "tech pack",
        "measurements",
        "measurement chart",
        "size chart",
        "grading",
        "ai draft",
        "experts",
        "review board",
        "completeness",
        "red cells",
        "টেক প্যাক",
        "মাপ",
        "মাপের ছক",
        "সাইজ চার্ট",
        "গ্রেডিং",
        "বিশেষজ্ঞ",
      ],
      routes: ["/production/projects/[projectId]/tech-pack"],
      who: "দেখতে পারেন যাঁরা Production দেখতে পারেন। ছক, নির্দেশ, AI খসড়া, রেফারেন্স, লোগো ও রং বদলাতে পারেন Production Manager ও Super Admin। AI-এর বোতামগুলো আসে শুধু মালিক AI Center-এ AI চালু করলে।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "স্টাইলের (প্রজেক্টের) পাতায় “Tech pack approval” অংশে “Open the tech pack” চাপুন। উপরে “Completeness” দেখায় কতটা সবুজ। চিহ্নের মানে: “Confirmed” (সবুজ ✓), “AI guess” (হলুদ ?), “Missing” (লাল !)।",
          image: {
            id: "production-tech-pack-1",
            caption:
              "টেক প্যাক পাতা: উপরে Completeness, নিচে মাপের ছক, AI খসড়া, রেফারেন্স, লোগো ও রং",
          },
        },
        {
          text: "“Measurements” অংশে “Make the chart” চাপুন। “Garment”, “Unit”, “Sizes”, “The buyer's size”, “Chest at that size”, “Chest measured” আর “Body length at that size” দিন। “Chest grade per size” খালি রাখলে পুরো বুকে প্রতি সাইজে 2 ইঞ্চি (5 সেমি)। বাকি সব মাপ ও সাইজ নিয়ম মেনে তৈরি হয়, হলুদ রঙে।",
        },
        {
          text: "কোনো মাপে চাপ দিয়ে বদলান; আপনার দেওয়া মান সবুজ হয়। নিয়মে তৈরি পুরো সারি ঠিক থাকলে “Confirm” চাপুন। ছকে নেই এমন মাপ যোগ করতে “Add a measurement”। “Show in” দিয়ে ইঞ্চি বা সেমিতে দেখুন।",
        },
        {
          text: "“Measurement sheet” চাপলে মাপের PDF, আর “Excel” চাপলে ইঞ্চি ও সেমি দুই শিটসহ Excel ফাইল নামে। “To settle with the buyer” অংশে থাকে যে প্রশ্নগুলো বায়ারের সাথে মেটাতে হবে।",
        },
        {
          text: "“Instructions for AI” অংশে “Write instructions” চেপে প্রতিটি ভাগে আপনার নির্দেশ লিখুন (বাংলা বা ইংরেজিতে)। AI খসড়ার আগে এগুলো পড়ে, আর এগুলো তার নিজের অনুমানের চেয়ে বড়। বায়ারের ফাইলের সাথে না মিললে দুটোই লাল রঙে দেখায়, আপনি ঠিক করেন।",
        },
        {
          text: "“AI draft” অংশে “Ask” বা “Auto” বেছে “Draft with AI” চাপুন। AI সংরক্ষিত রেফারেন্স, প্রতি পিসের কাঁচামাল, ছক ও আপনার নির্দেশ পড়ে খসড়া লেখে। প্রতিটি লাইনে “OK” বা “Change” চাপুন। নিচে থাকে “Questions from the AI” আর “Rules applied”।",
        },
        {
          text: "“Experts” অংশে “Ask an expert” চেপে প্যাটার্ন মাস্টার, ফ্যাব্রিক ইঞ্জিনিয়ার বা QC ম্যানেজারকে প্রশ্ন করুন, বা “Let the AI pick”। অনুমোদনের আগে “Run the review board” চাপলে কাটিং মাস্টার ও হেড মার্চেন্ডাইজার খসড়াটি পরীক্ষা করেন।",
        },
        {
          text: "লাল কিছু থাকলে (মাপ নেই, সিদ্ধান্ত না নেওয়া লাল লাইন, মালিকের টিক ছাড়া লোগো) “Tech pack approval” অংশে “Red cells keep it from approval” তালিকা দেখায় আর অনুমোদন হয় না। সব ঠিক হলে অনুমোদন করুন। “Tech pack PDF” চাপলে ছক, লোগো ও রংসহ PDF নামে।",
        },
      ],
      tips: [
        "AI খসড়া লেখে আর পরামর্শ দেয়; টেক প্যাকে নিজে কিছু বদলায় না, অনুমোদনও করে না।",
        "আগে খরচ জানতে চাইলে (AI Center-এ ঠিক করা) AI চালানোর আগে আনুমানিক খরচ দেখায়: “Go on” চাপলে চলে, “Not now” চাপলে থামে।",
        "“Make the chart again” চাপলে আপনার দেওয়া ও নিশ্চিত করা মান থেকে যায়; শুধু নিয়মে তৈরি মান নতুন করে হয়।",
        "দাম, সরবরাহকারী বা মার্জিন কখনো AI-কে পাঠানো হয় না।",
      ],
    },
    {
      slug: "production-tech-pack-logos",
      title: "টেক প্যাকে লোগো ও এমব্রয়ডারির মেশিন ফাইল রাখবেন যেভাবে",
      summary:
        "প্রতিটি লোগোর মাপ, সুতা ও কাপড় লিখে মেশিন ফাইল রাখুন: আগে বায়ারের ফাইল, না থাকলে এমব্রয়ডারি ফ্যাক্টরির পাঞ্চার, শেষে বায়ারের ভেক্টর থেকে খসড়া। প্রতিটি ফাইল মাপের সাথে মেলানো হয়; সেলাইয়ের নমুনা (sew-out) দেখে মালিক টিক দিলে ফাইলটি লক হয়।",
      keywords: [
        "logo",
        "embroidery",
        "dst",
        "exp",
        "pes",
        "sew-out",
        "digitizing",
        "digitizing brief",
        "puncher",
        "vector",
        "svg",
        "tick for bulk",
        "লোগো",
        "এমব্রয়ডারি",
        "পাঞ্চিং",
        "সেলাইয়ের নমুনা",
      ],
      routes: ["/production/projects/[projectId]/tech-pack"],
      who: "লোগো যোগ, ফাইল আপলোড ও ভেক্টর থেকে খসড়া: Production Manager ও Super Admin। বাল্কের জন্য টিক দেন যাঁদের “Tick logos for bulk after the sew-out” অনুমতি আছে; শুরুতে শুধু Super Admin।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "টেক প্যাকের “Logos and embroidery” অংশে “Add a logo” চেপে নাম, “Placement”, “Width (mm)”, “Height (mm)”, “Threads”, “Thread colours”, “Fabric” আর জানা থাকলে “Approved stitches” দিন।",
        },
        {
          text: "“Upload a file” চেপে বায়ারের আর্টওয়ার্ক (SVG, PDF, AI বা EPS), মেশিন ফাইল বা সেলাইয়ের নমুনার ছবি আপলোড করুন। মেশিন ফাইলের জন্য “From”-এ বেছে নিন বায়ারের ফাইল না ফ্যাক্টরির পাঞ্চারের।",
        },
        {
          text: "মেশিন ফাইল (DST বা EXP) আপলোড হলেই “File check” দেখায়: সেলাই সংখ্যা, মাপ, রং আর সবচেয়ে লম্বা সেলাই। PASS মানে মাপ মিলেছে; WARN হলে কারণগুলো পড়ুন; FAIL হলে ফাইল ঠিক করাতে হবে।",
        },
        {
          text: "বায়ারের বা পাঞ্চারের ফাইল না থাকলে আর আর্টওয়ার্ক SVG হলে “Draft from the vector” চাপুন: ভেক্টর থেকে খসড়া DST তৈরি হয়। খসড়াটি অবশ্যই ফ্যাক্টরিতে সেলাই করে দেখতে হয়।",
        },
        {
          text: "“Digitizing brief” চাপলে পাঞ্চারের জন্য নির্দেশপত্র (PDF) নামে। “DST” বা “EXP” চাপলে অন্য মেশিনের জন্য একই ফাইল সেই ফরম্যাটে নামে।",
        },
        {
          text: "মেশিন ফাইল আর সেলাইয়ের নমুনার ছবি থাকলে মালিক নমুনা দেখে “Tick for bulk” চাপেন। এরপর লোগো আর তার মেশিন ফাইল লক থাকে; বদলাতে হলে আগে “Take back the tick”।",
        },
      ],
      tips: [
        "Wilcom EMB ফাইল নেওয়া হয় না; পাঞ্চারের কাছে DST চান।",
        "ছবি (JPG) থেকে কখনো লোগো তৈরি হয় না; বায়ারের ভেক্টর ফাইল লাগে।",
        "AI কখনো লোগোতে টিক দেয় না; এটি মালিকের কাজ।",
        "PES, JEF বা U01 ফাইলও রাখা যায়, তবে যাচাই হয় শুধু DST ও EXP।",
      ],
    },
    {
      slug: "production-tech-pack-colours",
      title: "রং ও ল্যাব ডিপ (lab dip) যাচাই করবেন যেভাবে",
      summary:
        "প্রতিটি রঙের বায়ারের কোড ও ΔE সীমা দিন। ডাইং মিলের ল্যাব ডিপের প্রতিটি অপশন সীমার সাথে মিলিয়ে পাস বা ফেল দেখায়, কোনগুলো বায়ারকে পাঠাবেন বলে দেয়, আর বায়ারের উত্তর রাখা যায়।",
      keywords: [
        "colour",
        "color",
        "lab dip",
        "delta e",
        "cmc",
        "pantone",
        "dye",
        "dyeing",
        "metamerism",
        "best can do",
        "রং",
        "ল্যাব ডিপ",
        "ডাইং",
        "প্যানটোন",
      ],
      routes: ["/production/projects/[projectId]/tech-pack"],
      who: "রং, ল্যাব ডিপ ও বায়ারের উত্তর রাখেন Production Manager ও Super Admin। AI দিয়ে রিপোর্ট পড়া বা ছবি থেকে রং শুধু AI চালু থাকলে।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "টেক প্যাকের “Colours and lab dips” অংশে “Add a colour” চেপে রঙের নাম, “Buyer's code”, “ΔE limit” (বায়ার না দিলে 1.0), “Main light” আর দরকার হলে “Second light” দিন।",
        },
        {
          text: "মিলের রিপোর্ট এলে “Add lab dips” চেপে “Round” আর প্রতিটি অপশনের অক্ষর, ΔE এবং থাকলে dL, dC, dH ও MI লিখুন। AI চালু থাকলে “Read the mill's report” চেপে রিপোর্ট (PDF বা ছবি) দিন; AI সংখ্যাগুলো ফর্মে বসায়, আপনি রিপোর্টের সাথে মিলিয়ে সংরক্ষণ করুন।",
        },
        {
          text: "প্রতিটি অপশনে PASS বা FAIL আর কারণ দেখায়: ΔE সীমার বেশি হলে ফেল, আর MI (মেটামেরিজম) 1-এর বেশি হলে ΔE পাস করলেও ফেল। নিচের লাইনে বলে কোন অপশনগুলো বায়ারকে পাঠাবেন বা মিলকে কী বলবেন।",
        },
        {
          text: "বায়ার উত্তর দিলে “Buyer's answer” চেপে অনুমোদিত অপশন বেছে নিন, বা দুই রাউন্ডেও না মিললে “Best can do”। ভুল হলে “Open again”।",
        },
        {
          text: "“Colour from a photo” চেপে ছবি দিলে AI আনুমানিক Pantone কোড বলে, পাশে “approx.” লেখা থাকে। এটি শুধু ধারণা; বায়ারের কোড আর মিলের ল্যাব ডিপই রং ঠিক করে।",
        },
      ],
      tips: [
        "বায়ার ল্যাব ডিপ অনুমোদন না করা পর্যন্ত বাল্ক ডাইং নয়।",
        "হিদার, সাদা, নিয়ন ও ফ্রেঞ্চ টেরি রং সংখ্যা দিয়ে নয়, চোখে দেখে অনুমোদন হয়।",
        "অনুমোদন না হওয়া রং হলুদ বা লাল দেখায়, তবে টেক প্যাক অনুমোদন আটকায় না।",
      ],
    },
    {
      slug: "production-save-to-tech-pack",
      title: "ফোন থেকে ছবি বা লিংক টেক প্যাকে রাখবেন যেভাবে (Save to Tech Pack)",
      summary:
        "ফোনে কোনো ছবি বা পণ্যের পাতা খুলে Share চেপে Extas ERP বেছে নিন; “Save to Tech Pack” পাতায় স্টাইল বেছে ছোট নোট লিখে সংরক্ষণ করুন। AI খসড়ার সময় এগুলো পড়ে।",
      keywords: [
        "save to tech pack",
        "share",
        "reference",
        "saved references",
        "photo",
        "link",
        "poshmark",
        "etsy",
        "রেফারেন্স",
        "শেয়ার",
        "ছবি",
        "লিংক",
      ],
      routes: ["/production/save"],
      who: "যাঁদের Production বদলের অনুমতি আছে: Production Manager ও Super Admin।",
      anyOf: ["production.manage"],
      steps: [
        {
          text: "প্রথমবার ফোনে Extas ERP হোম স্ক্রিনে যোগ করুন (Add to Home Screen)। তাহলে ফোনের Share তালিকায় Extas ERP আসে।",
        },
        {
          text: "কোনো ছবি বা পণ্যের পাতা (যেমন Etsy বা Poshmark) খুলে Share চাপুন, তারপর Extas ERP। “Save to Tech Pack” পাতা খোলে, ছবি ও লিংকসহ।",
        },
        {
          text: "“Style code or name” ঘরে খুঁজে স্টাইল বেছে নিন, “Note”-এ ছোট নোট লিখুন (যেমন “4-hole MOP button, about 18L”) আর “Save to Tech Pack” চাপুন।",
        },
        {
          text: "সংরক্ষণের পরে “Open the tech pack” চেপে “Saved references” অংশে দেখুন। কম্পিউটারে এই পাতায় সরাসরি লিংক বা ছবি দিয়েও রাখা যায়, বা টেক প্যাকে “Save a reference” চেপে।",
        },
      ],
      tips: [
        "সিস্টেম কখনো ওই সাইটগুলোতে নিজে ঢোকে না বা কপি করে না; শুধু আপনি যা শেয়ার করেন তা রাখে।",
        "ছবি শুধু ভেতরের রেফারেন্স; কোনো AI প্রশিক্ষণে ব্যবহার হয় না।",
        "শেয়ার করা ছবি 24 ঘণ্টার মধ্যে কোনো স্টাইলে রাখতে হয়; পরে হলে আবার শেয়ার করুন।",
        "রেফারেন্স কেউ হাতে সরানো পর্যন্ত থাকে।",
      ],
    },
    {
      slug: "production-costing",
      title: "অর্ডারের কস্টিং শিট বানাবেন যেভাবে (Costing)",
      summary:
        "বায়ার কোনো অর্ডারের কথা বললে নেওয়ার আগে খরচ হিসাব করুন: প্রতি ডজনে কাপড় (সাপ্লায়ারের কেজি প্রতি দাম), ট্রিমস, প্রিন্ট বা এমব্রয়ডারি, ফ্যাক্টরির সাথে ঠিক করা CM, আর এই অর্ডারের জন্য আপনার নিজের লাভ %। অফিস খরচ কস্টিংয়ে ধরা হয় না।",
      keywords: [
        "costing",
        "cost sheet",
        "order costing",
        "profit",
        "profit %",
        "cm",
        "fabric price",
        "price per kg",
        "supplier quote",
        "fabric quote",
        "fob price",
        "tt",
        "lc",
        "bank transfer",
        "কস্টিং",
        "খরচ",
        "লাভ",
        "কাপড়ের দাম",
        "কোটেশন",
        "সিএম",
      ],
      routes: ["/production/costing"],
      who: "যাঁদের কস্টিং দেখার অনুমতি আছে (“See costing sheets, costs, profit and the Order check card”); শুরুতে শুধু Super Admin। শিট বানাতে ও বদলাতে লাগে “Make costing sheets and add supplier fabric quotes”। অর্ডার নেওয়া বা না নেওয়ার সিদ্ধান্ত মালিকের।",
      anyOf: ["costing.view"],
      steps: [
        {
          text: "Production-এ “Costing” ট্যাবে যান, “New costing” চাপুন। “Order”-এ অর্ডারের নাম, “Buyer” ও “Factory” বেছে নিন, “Currency” দিন (কোম্পানির মুদ্রা না হলে বিনিময় হারও)।",
          image: {
            id: "production-costing-1",
            caption: "কস্টিং শিট: উপরে Order check card, নিচে স্টাইলগুলোর প্রতি ডজনের খরচ",
          },
        },
        {
          text: "“Profit % for this order”-এ এই অর্ডারের লাভ % আপনি নিজে দিন। কোনো নির্দিষ্ট % বসানো থাকে না, সর্বনিম্নও নেই; না জানলে খালি রাখুন। এই বায়ারের আগের শিটের লাভ % পাশে শুধু ইঙ্গিত হিসেবে দেখায়।",
        },
        {
          text: "“How the buyer pays”-এ “TT”, “Direct bank transfer” বা “LC” বেছে নিন। “As the buyer pays” রাখলে বায়ারের প্রোফাইলে যা আছে তা-ই আসে, আর প্রতিটি অর্ডারে আলাদা করে বদলানো যায়।",
        },
        {
          text: "দাম থেকে যা কাটা যায় তা দিন: “Source tax %”, “Bank charges %” ও “Commission %”। তারপর “Ship date”, “Days for the fabric” (খালি মানে 30 দিন) ও “Days to make” (খালি মানে 25 দিন) দিন, “Risks”-এ প্রতি লাইনে একটি ঝুঁকি লিখে “Make the sheet” চাপুন।",
        },
        {
          text: "“Add a style” চেপে প্রতিটি স্টাইল যোগ করুন: “Style or buyer's reference”, “Pieces”, কাপড় আর প্রতি ডজনে কত কাপড় (“Fabric a dozen (…)”)। নিট কাপড় কেজিতে, ওভেন গজে।",
        },
        {
          text: "“Supplier's price per …” ঘরে সাপ্লায়ারের দেওয়া কেজি (বা গজ) প্রতি দাম দিন। “Fabric prices” চাপলে “Supplier quotes” আর “Paid on past bookings” পাশাপাশি দেখায়; যেটা চান তার নিচে “Use” চাপুন।",
        },
        {
          text: "“Trims a dozen”, “Print, embroidery, wash a dozen” ও “Other a dozen” দিন। “CM (…)”-এ ফ্যাক্টরির সাথে এই স্টাইলের জন্য ঠিক করা CM দিন, আর “CM is”-এ “per piece” বা “per dozen”। আগে ঠিক করা CM তুলনার জন্য “CM agreed before, to compare:”-এ দেখায়।",
        },
        {
          text: "বায়ার যে দাম বলেছেন বা আপনি যা কোট করবেন তা “Buyer's price a piece (…)”-এ দিয়ে “Save” চাপুন। প্রতিটি স্টাইলে দেখায় “Cost a dozen”, “Cost a piece”, “Price at your profit” ও “Profit at the buyer's price”।",
        },
        {
          text: "কস্টিং পাতার নিচে “Supplier fabric quotes” অংশে “Add a supplier quote” চেপে মিলের কোটেশন রাখুন: “Supplier”, “Fabric”, “Price”, “Per” (kg বা yard), “Quoted on” ও “Good until” দিয়ে “Save the quote”।",
        },
      ],
      tips: [
        "দাম = খরচ ÷ (1 − সব % এর যোগফল)। যেমন প্রতি ডজনে খরচ 38.77, উৎসে কর 1%, ব্যাংক চার্জ 0.15% আর লাভ 7% হলে দাম 38.77 ÷ 0.9185 = প্রায় 42.21 প্রতি ডজন।",
        "অফিস খরচ (ভাড়া, বেতন) কস্টিংয়ে ধরা হয় না।",
        "কোনো অংশ (কাপড়ের দাম, CM) না দিলে স্টাইলে “Still missing” লেখা থাকে: খরচ তখন আসলের চেয়ে কম দেখায়।",
        "কাপড়ের দাম কেজি প্রতি সাপ্লায়ারের কোটেশন থেকে নেওয়া হয়, সুতা থেকে হিসাব করে নয়।",
        "CM মিনিট হিসেবে নয়: প্রতি স্টাইলে ফ্যাক্টরির সাথে ঠিক করা একটি দাম।",
      ],
    },
    {
      slug: "production-order-check",
      title: "অর্ডার নেবেন কি না: Order check card পড়বেন যেভাবে",
      summary:
        "কস্টিং শিটের উপরে পাঁচটি পরীক্ষা: “Price vs cost”, “Time to ship”, “Factory”, “Buyer payment” ও “Risks”, প্রতিটি সবুজ, হলুদ বা লাল, সাথে এক লাইনে কারণ। কোনো স্কোর নেই, আর কার্ড কখনো নিজে অর্ডার বাতিল করে না: সিদ্ধান্ত আপনার।",
      keywords: [
        "order check",
        "order check card",
        "go no go",
        "take order",
        "decline order",
        "capacity",
        "monthly capacity",
        "payment history",
        "risks",
        "eid",
        "অর্ডার নেব কি না",
        "ক্যাপাসিটি",
        "ঝুঁকি",
        "ঈদ",
      ],
      routes: ["/production/costing/[costingId]"],
      who: "যাঁরা কস্টিং দেখতে পারেন তাঁরা কার্ড দেখেন। “Take the order” ও “Decline the order” শুধু মালিকের (“Take or decline an order”), আর AI কখনো এই অনুমতি পায় না।",
      anyOf: ["costing.view"],
      steps: [
        {
          text: "কস্টিং শিট খুলুন। উপরে “Order check card”: সবুজ মানে ঠিক আছে, হলুদ মানে আবার দেখুন, লাল মানে সমস্যা। প্রতিটির পাশে এক লাইনে কারণ।",
          image: {
            id: "production-order-check-1",
            caption: "Order check card: পাঁচটি পরীক্ষা, প্রতিটি সবুজ, হলুদ বা লাল, সাথে কারণ",
          },
        },
        {
          text: "“Price vs cost”: বায়ারের দাম খরচের নিচে হলে লাল। আপনার লাভ %-এর নিচে হলে, লাভ % না দিলে, বায়ারের দাম না থাকলে বা কোনো খরচ বাকি থাকলে হলুদ। না হলে সবুজ।",
        },
        {
          text: "“Time to ship”: কাপড়ের দিন (খালি হলে 30), বানানোর দিন (খালি হলে 25) আর শেষ করে বন্দরে পৌঁছাতে 7 দিন যোগ হয়। শিপ ডেট পর্যন্ত এত দিন না থাকলে লাল, 7 দিনের কম হাতে থাকলে হলুদ।",
        },
        {
          text: "“Factory”: শিপ ডেট পর্যন্ত ফ্যাক্টরির হাতে থাকা পিস আর এই অর্ডার মিলে তার মাসিক ক্যাপাসিটির বেশি হলে লাল, 85%-এর বেশি হলে বা ক্যাপাসিটি দেওয়া না থাকলে হলুদ। ক্যাপাসিটি দিন সাপ্লায়ারের প্রোফাইলে “Monthly capacity (pieces)” ঘরে। ফ্যাক্টরি বাছা না থাকলে কোন ফ্যাক্টরিতে জায়গা আছে তা দেখায়।",
        },
        {
          text: "“Buyer payment”: বায়ারের কোনো টাকা মেয়াদ পেরিয়ে বাকি থাকলে লাল। নতুন বায়ার (আগে কোনো ইনভয়েস নেই) বা কোনো ইনভয়েস দেরিতে (মেয়াদের 3 দিনের বেশি পরে) দিলে হলুদ। সব সময়মতো দিলে সবুজ।",
        },
        {
          text: "“Risks”: আপনার লেখা ঝুঁকি, নতুন বায়ার, LC (কাগজ LC-র সাথে হুবহু মিলতে হবে) আর উৎপাদনের সময়ে ঈদ নিজে থেকে যোগ হয়। 1 বা 2টি ঝুঁকিতে হলুদ, 3 বা বেশি হলে বা শিপ ডেটের আগের 21 দিনে ঈদ পড়লে লাল।",
        },
        {
          text: "পড়ে নিজে ঠিক করুন: “Your decision” অংশে “Take the order” বা “Decline the order” চাপুন, চাইলে কারণ লিখুন। এটা শিটে আর অ্যাক্টিভিটি লগে থাকে; বায়ারকে কিছু পাঠানো হয় না।",
        },
      ],
      tips: [
        "এই সীমাগুলো (30, 25, 7 দিন, 85%, 3 দিন, 21 দিন) শুরুর নিয়ম; বদলাতে চাইলে বলুন।",
        "ঈদের তারিখ আসে HR-এর ছুটির তালিকা থেকে, নামে Eid শব্দ থাকলে।",
        "কার্ড কোনো স্কোর দেয় না আর নিজে কখনো অর্ডার বাতিল করে না।",
      ],
    },
    {
      slug: "production-contracts",
      title: "ব্যাচের কাপড়, অ্যাক্সেসরিজ ও ফ্যাক্টরির (CM) চুক্তি তৈরি ও প্রিন্ট করবেন যেভাবে",
      summary:
        "মাস্টার ব্যাচ থেকে এক চাপে তিন রকম চুক্তির খসড়া: কাপড়ের সরবরাহকারী, অ্যাক্সেসরিজের সরবরাহকারী আর ফ্যাক্টরির CM চুক্তি। ধারাগুলো পড়ে বদলান, স্টাইল অনুযায়ী CM দিন, তারপর PDF প্রিন্ট করে সই করান।",
      keywords: [
        "contract",
        "agreement",
        "fabric contract",
        "accessories contract",
        "factory contract",
        "cm rate",
        "cm per piece",
        "draft again",
        "signed on",
        "চুক্তি",
        "সিএম",
        "ফ্যাক্টরি",
      ],
      routes: ["/production/batches/[batchId]/contracts/[contractId]"],
      who: "চুক্তি তৈরি ও বদল করতে পারেন Production Manager ও Super Admin। দাম ও CM থাকায় দেখতে পারেন শুধু Production Manager, Accounts ও Super Admin।",
      anyOf: ["production.manage", "accounts.view"],
      steps: [
        {
          text: "ব্যাচের পাতায় “Contracts” অংশে “Ready to draft” তালিকায় ব্যাচের অর্ডার ও স্টাইল থেকে কোন সরবরাহকারী বা ফ্যাক্টরির সাথে কোন চুক্তি দরকার তা দেখায়। পাশের “Draft” চাপুন। তালিকায় না থাকলে “Draft for another supplier” চাপে ধরন ও সরবরাহকারী বেছে “Draft it” চাপুন।",
          image: {
            id: "production-contracts-1",
            caption: "ব্যাচের পাতায় “Contracts” অংশ",
          },
        },
        {
          text: "খসড়া খুললে ডান দিকে “What is bought” বা “What is made” অংশে চুক্তিতে কী আছে দেখায়: সরবরাহকারীর অর্ডারের লাইন (দাম বা “price at receive”), অথবা ফ্যাক্টরির স্টাইল, পিস আর CM। এগুলো সবসময় ব্যাচ থেকে এখনকার অবস্থায় প্রিন্ট হয়।",
        },
        {
          text: "ফ্যাক্টরির চুক্তিতে প্রতিটি স্টাইলের “CM per piece” লিখুন; এটা চুক্তিতে ছাপা হয় আর পরে চূড়ান্ত CM হিসাবে কাজে লাগে।",
        },
        {
          text: "“Terms” অংশে প্রতিটি ধারার “Title” ও “What it says” পড়ে দরকার মতো বদলান, ওপরে সরান বা “Remove” করুন, নতুন ধারা লাগলে “Add a clause” চাপুন। ব্যাচ বদলালে “Draft again” চাপলে নতুন খসড়া বসে; AI চালু থাকলে লেখা সহজ করে দেয়, না থাকলে নিয়ম মেনে লেখা হয়।",
          image: {
            id: "production-contracts-2",
            caption: "চুক্তির ধারা বদলানোর ফর্ম",
          },
        },
        {
          text: "“Save the contract” চাপুন, তারপর “Print (PDF)” চাপলে লেটারহেডে চুক্তি নামে: দুই পক্ষ, কী কেনা বা বানানো হচ্ছে, নম্বরসহ ধারা আর সইয়ের জায়গা। দুই পক্ষ সই করলে “Signed on (optional)” ঘরে তারিখ দিয়ে আবার সেভ করুন।",
          image: {
            id: "production-contracts-3",
            caption: "চুক্তির PDF",
          },
        },
      ],
      tips: [
        "সই হওয়া চুক্তির ধারা ও CM বদলানো যায় না; বদলাতে হলে আগে “Signed on (optional)” ঘর খালি করে সেভ করুন।",
        "শুধু খসড়া চুক্তি “Delete the draft” দিয়ে মোছা যায়; সই হওয়া চুক্তি থাকলে ব্যাচটিও মোছা যায় না।",
        "কাপড়ের চুক্তিতে ওজন কম-বেশি (Short/Extra) আর কাপড়ের ত্রুটির নিয়ম থাকে; অ্যাক্সেসরিজের চুক্তিতে চলমান হিসাব (Supplier Due); ফ্যাক্টরির চুক্তিতে A/B/C গ্রেড, Missing পিস আর অগ্রিম বাদ দিয়ে চূড়ান্ত পাওনা।",
      ],
    },
    {
      slug: "production-batch-receive",
      title: "ব্যাচের মাল এক জায়গায় রিসিভ করবেন যেভাবে (চালান বনাম আসল ওজন)",
      summary:
        "মাস্টার ব্যাচের সব স্টাইলের কাপড় ও অ্যাক্সেসরিজ এক জায়গায় রিসিভ: চালানে কত লেখা আর আসলে কত ওজন বা গোনা হলো তা পাশাপাশি লিখুন। বেশি কম এলে লাল সতর্কতা দেখায় আর সরবরাহকারীর Fault Log-এ উঠে যায়।",
      keywords: [
        "receive",
        "central receive",
        "challan",
        "challan vs actual",
        "actual weight",
        "short",
        "extra",
        "short/extra",
        "price at receive",
        "রিসিভ",
        "চালান",
        "ওজন",
        "কম এসেছে",
      ],
      routes: ["/production/batches/[batchId]/receive"],
      who: "রিসিভ করেন যাঁরা কাঁচামাল কেনেন (materials.purchase): Production Manager ও Super Admin। মাল বাকিতে (Supplier Due) স্টোরে ঢোকে।",
      anyOf: ["materials.purchase"],
      steps: [
        {
          text: "ব্যাচের পাতায় “Materials” অংশের নিচে “Receive a delivery” চাপুন। ব্যাচের যেসব পারচেজ অর্ডারে মাল আসা বাকি সেগুলো দেখায়; যে অর্ডারের মাল এসেছে সেটি বেছে নিন। একটিই থাকলে নিজে থেকে বাছা হয়।",
          image: {
            id: "production-batch-receive-1",
            caption: "ব্যাচের যেসব অর্ডারে মাল আসা বাকি",
          },
        },
        {
          text: "“Challan no. (optional)” ঘরে সরবরাহকারীর চালান নম্বর আর “Received on” ঘরে তারিখ দিন।",
        },
        {
          text: "“Challan vs Actual” অংশে প্রতিটি লাইনে চালানে কত লেখা (“Challan says”) আর আসলে কত ওজন বা গোনা হলো তা লিখুন। লেখার সাথে সাথে নিচে দেখায়: সমান হলে Final Match, বেশি হলে Extra, কম হলে Short। কাপড়ে ২% আর বাকিতে ১%-এর বেশি কম হলে লাল হয়ে যায়।",
          image: {
            id: "production-batch-receive-2",
            caption: "চালান বনাম আসল ওজন, লাল Short সতর্কতা সহ",
          },
        },
        {
          text: "অর্ডারে যে লাইনের দাম রিসিভে ঠিক হবে বলা ছিল, তার “Agreed price” ঘরে এখন দাম দিন। তারপর “Receive into the store” চাপুন। শুধু যা আসলে এসেছে তাই বিল হয়ে স্টোরে ঢোকে।",
        },
        {
          text: "সীমার বেশি কম এলে সেই লাইন সরবরাহকারীর “Fault log”-এ লাইনের দামে উঠে যায় আর Production Manager-রা সাথে সাথে নোটিফিকেশন পান। ব্যাচের পাতায় লাল বার্তায় তা দেখায়।",
          image: {
            id: "production-batch-receive-3",
            caption: "রিসিভের পর ব্যাচের পাতায় লাল বার্তা",
          },
        },
      ],
      tips: [
        "কোনো লাইনের কিছুই না এলে ঘর খালি রাখুন; চালানে লেখা থাকলে আসল ঘরে 0 লিখুন, তাহলে পুরোটাই কম হিসেবে ধরা হয়।",
        "Extra বা সীমার মধ্যে কম শুধু দেখায়, Fault Log-এ ওঠে না।",
      ],
    },
    {
      slug: "production-batch-issue",
      title: "ব্যাচের কাপড় ও অ্যাক্সেসরিজ রং অনুযায়ী স্টাইলে ইস্যু করবেন যেভাবে",
      summary:
        "স্টোর থেকে মাস্টার ব্যাচের সব স্টাইলে এক সাথে মাল ইস্যু: প্রতিটি স্টাইলের প্রতিটি রঙের জন্য কত লাগবে, কত আগে দেওয়া হয়েছে আর কত বাকি তা দেখে লিখুন। প্রতিটি স্টাইলে শুধু যা নিল তার খরচই ওঠে।",
      keywords: [
        "issue",
        "issue to styles",
        "colour wise",
        "color wise",
        "store issue",
        "fabric issue",
        "fill what is still to issue",
        "ইস্যু",
        "রং অনুযায়ী",
        "স্টোর",
      ],
      routes: ["/production/batches/[batchId]/issue"],
      who: "ইস্যু করেন স্টোর (Warehouse Team), Production Manager ও Super Admin (materials.manage)। এই পাতায় দাম দেখায় না।",
      anyOf: ["materials.manage"],
      steps: [
        {
          text: "ব্যাচের পাতায় “Materials” অংশের নিচে “Issue to styles” চাপুন। প্রতিটি কাঁচামালের জন্য স্টোরে কত আছে, কত লাগবে, কত দেওয়া হয়েছে আর কত বাকি দেখায়।",
        },
        {
          text: "প্রতিটি স্টাইলের নিচে রঙের ঘরে সেই রঙের জন্য কত দিচ্ছেন লিখুন। “Fill what is still to issue” চাপলে সব ঘরে বাকি পরিমাণ বসে যায়, দরকার মতো বদলান। নিচে মোট আর স্টোরে কত আছে দেখায়; বেশি হলে লাল হয়।",
          image: {
            id: "production-batch-issue-1",
            caption: "রং অনুযায়ী স্টাইলে ইস্যুর ঘর",
          },
        },
        {
          text: "“Taken by (optional)” ঘরে কে নিল লিখে “Issue to the styles” চাপুন। প্রতিটি স্টাইলের জন্য আলাদা ইস্যু নোট (MI-) হয়, রঙের হিসাব নোটে লেখা থাকে, আর সব একসাথে হয় না হলে কোনোটাই হয় না।",
          image: {
            id: "production-batch-issue-2",
            caption: "ইস্যুর পর ব্যাচের পাতায় নোটের নম্বর",
          },
        },
      ],
      tips: [
        "স্টোরে কম থাকলে পুরো ইস্যু আটকে যায় আর কোন মাল কত আছে তা দেখায়।",
        "বেঁচে যাওয়া মাল আগের মতো Materials > Issue notes থেকে ফেরত নিন; ফেরত নেওয়া পরিমাণ এখানে দেওয়া হিসাব থেকে বাদ যায়।",
      ],
    },
    {
      slug: "production-fault-log",
      title: "সরবরাহকারীর Fault Log আর রিপোর্ট কার্ড ব্যবহার করবেন যেভাবে",
      summary:
        "রিসিভে কম আসা, কাপড়ের ত্রুটি, মানের সমস্যা আর হারানো পিস এক তালিকায়: কার কাছে কত টাকা কাটতে হবে, কোনটা কাটা হয়েছে বা ছাড় দেওয়া হয়েছে। এক চাপে সরবরাহকারীর ১২ মাসের রিপোর্ট কার্ড PDF।",
      keywords: [
        "fault log",
        "supplier fault",
        "deduction",
        "deduct",
        "waive",
        "fabric fault",
        "report card",
        "supplier grade",
        "ফল্ট",
        "ত্রুটি",
        "কাটা",
        "রিপোর্ট কার্ড",
        "spoiled at embroidery or print",
      ],
      routes: ["/production/faults"],
      who: "তালিকা দেখেন Production, স্টোর ও Accounts; টাকার অঙ্ক দেখেন শুধু Production Manager, Accounts ও Super Admin। ফল্ট লেখেন Production Manager; কাটা বা ছাড় দেন Production Manager ও Accounts।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "“Production” > “Fault log” ট্যাবে সব ফল্ট নতুনটা আগে দেখায়। ওপরের “Open”, “Deducted”, “Waived” দিয়ে বাছুন। ডান দিকে “Still to deduct” অংশে কোন সরবরাহকারীর কাছে কতগুলো খোলা আর কত টাকা কাটতে হবে দেখায়।",
          image: {
            id: "production-fault-log-1",
            caption: "Fault log পাতা ও Still to deduct অংশ",
          },
        },
        {
          text: "কাপড়ে ফুটো, রঙের দাগ বা পিস হারালে “Log a fault” চাপুন: সরবরাহকারী, “What went wrong”, পরিমাণ, কত টাকা কাটবেন আর কী সমস্যা লিখুন; চাইলে “Photo (optional)”-এ ছবি দিন। তারপর “Log the fault” চাপুন। ছবি ফল্টের সাথে “Photo of the fault” হয়ে থাকে। ব্যাচের পাতা থেকে লিখলে ব্যাচ নিজে থেকে বসে।",
          image: {
            id: "production-fault-log-2",
            caption: "Log a fault ফর্ম",
          },
        },
        {
          text: "সরবরাহকারীর পেমেন্ট থেকে কেটে নিলে “Mark deducted” চাপুন। ছাড় দিলে “Waive” চেপে কারণ লিখুন। ভুল হলে “Put back to open” চাপুন।",
        },
        {
          text: "“Report card (PDF)” চাপলে সরবরাহকারীর গত ১২ মাসের রিপোর্ট কার্ড নামে: কত অর্ডার সময়মতো এসেছে, চালান বনাম আসল, Fault Log, চুক্তি, A থেকে D গ্রেড আর ছোট সারাংশ। যেকোনো সরবরাহকারীর জন্য “Supplier report card” অংশে তাকে বেছে নিন।",
          image: {
            id: "production-fault-log-3",
            caption: "সরবরাহকারীর রিপোর্ট কার্ড PDF",
          },
        },
      ],
      tips: [
        "AI চালু থাকলে রিপোর্ট কার্ডের সারাংশ AI লেখে; না থাকলে হিসাব থেকে নিয়ম মেনে লেখা হয়।",
        "ব্যাচের পাতার “Fault log” অংশে শুধু সেই ব্যাচের ফল্ট দেখায়।",
        "“Spoiled at embroidery or print” ফল্ট এমব্রয়ডারি বা প্রিন্টের কারখানার নষ্ট পিস থেকে নিজে থেকে আসে, আর আসার সাথেই Deducted: টাকাটা তাঁর Supplier Due থেকে কমে গেছে। “Put back to open” বা “Waive” চাপলে সেই কাটা টাকা আবার তাঁর Supplier Due-তে ফিরে আসে; আবার “Mark deducted” চাপলে আবার কমে।",
      ],
    },
    {
      slug: "production-cutting",
      title: "কাটিং রিপোর্ট, ক্রস-চেক আর এমব্রয়ডারি সামলাবেন যেভাবে",
      summary:
        "প্রতিদিনের কাটিং রং ও সাইজ অনুযায়ী লিখুন বা কাটিং শিটের ছবি থেকে AI দিয়ে পড়ান। সাথে সাথে কাপড়, কলার-কাফ আর এক্সেসরিজের সাথে মিলিয়ে কম পড়লে সতর্কবার্তা যায়। এমব্রয়ডারি বা প্রিন্টে পাঠানো, ফেরত নেওয়া, নষ্ট পিস আবার কাটা, কাটিং ও সেলাইয়ের তারিখ আর Fabric Fault Note এক পাতায়।",
      keywords: [
        "cutting",
        "cutting report",
        "cut",
        "embroidery",
        "print",
        "replace from cutting",
        "spoiled",
        "cross-check",
        "collar",
        "cuff",
        "pieces per kg",
        "fabric fault note",
        "milestone",
        "cutting date",
        "sewing date",
        "embroidery house",
        "কাটিং",
        "এমব্রয়ডারি",
        "প্রিন্ট",
        "নষ্ট পিস",
        "কলার",
        "সেলাই",
      ],
      routes: [
        "/production/projects/[projectId]/cutting",
        "/production/projects/[projectId]/cutting/new",
      ],
      who: "পাতাটি দেখেন Production-এর সবাই, স্টোর ও Accounts। কাটিং, এমব্রয়ডারি আর তারিখ লেখেন Production Manager; Fabric Fault Note লেখেন Production Manager ও ক্রেতা (buyer)। টাকার অঙ্ক দেখেন শুধু যাঁরা উপকরণের দাম দেখেন।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "প্রজেক্টের পাতায় “Cutting and embroidery” অংশে কত পিস কাটা হলো, কত পিস বাইরে আছে আর কাটিং ও সেলাইয়ের তারিখ দেখায়। “Open cutting” চাপলে কাটিংয়ের পুরো পাতা খোলে।",
          image: {
            id: "production-cutting-1",
            caption: "প্রজেক্টের পাতায় “Cutting and embroidery” অংশ",
          },
        },
        {
          text: "“New cutting report” চাপুন। কাটিং শিটের ছবি দিয়ে “Read with AI” চাপলে রং ও সাইজের ঘরগুলো নিজে থেকে ভরে যায়; সেভ করার আগে প্রতিটি ঘর শিটের সাথে মিলিয়ে নিন। AI চালু না থাকলে ঘরে নিজে পিস লিখুন, ছবি তবুও রিপোর্টের সাথে থাকে।",
          image: {
            id: "production-cutting-2",
            caption: "রং ও সাইজ অনুযায়ী কাটিং রিপোর্টের ফর্ম",
          },
        },
        {
          text: "“Fabric used (optional)”-এ কত কেজি কাপড় লেগেছে লিখলে প্রতি কেজিতে কত পিস হলো তা টেক প্যাকের সাথে মেলানো হয়। “Save the cutting report” চাপুন।",
        },
        {
          text: "সেভ হলেই “Cross-checks” অংশে কাপড় (প্রতি কেজিতে পিস আর বাকি পিসের জন্য কাপড় আছে কিনা), রং ও সাইজ অনুযায়ী অর্ডার করা কলার-কাফ আর দেওয়া এক্সেসরিজ মিলিয়ে দেখায়। কিছু কম পড়লে লাল “Short” দেখায় আর Production Manager ও স্টোর সাথে সাথে বার্তা পান।",
          image: {
            id: "production-cutting-3",
            caption: "“Pieces by colour and size” আর “Cross-checks” অংশ",
          },
        },
        {
          text: "কাটা পিস এমব্রয়ডারি বা প্রিন্টে পাঠাতে “Send for embroidery or print” চাপুন: কোথায়, কবে ফেরত আসবে আর রং ও সাইজ অনুযায়ী কত পিস। যত পিস কাটা আছে তার বেশি পাঠানো যায় না।",
        },
        {
          text: "পিস ফেরত এলে “Receive back” চেপে ভালো আর নষ্ট পিস আলাদা লিখুন। নষ্ট পিস থাকলে সাথে সাথে “Replace from cutting immediately?” জিজ্ঞেস করে; “Cut them again” চাপলে নতুন কাটিং রিপোর্ট হয় আর Production-কে জানানো হয়। পরে করতে চাইলে “Replace from cutting” বোতাম থাকে।",
        },
        {
          text: "যেখানে পাঠিয়েছেন সেটি “Embroidery / Print” ধরনের সরবরাহকারী হলে নষ্ট পিসের দাম তাঁর: ফেরত নেওয়ার সাথে সাথে নষ্ট পিস তাঁর ফল্ট লগে “Spoiled at embroidery or print” হয়ে যায়, একটি কাটা পিসে যতটুকু কাপড় যায় তার দামে (ব্যাচে ইস্যু করা কাপড়ের দাম ÷ কাটা পিস), আর টাকাটা সাথে সাথে তাঁর নিজের Supplier Due থেকে কমে যায়; ফ্যাক্টরির থেকে কখনো নয়। অন্য কোথাও পাঠালে আগের মতো চাইলে টিক দিয়ে নষ্ট পিস তাঁর ফল্ট লগে পাঠান।",
          image: {
            id: "production-cutting-4",
            caption: "নষ্ট পিস আবার কাটার জিজ্ঞাসা",
          },
        },
        {
          text: "“Cutting and sewing dates” চেপে কাটিং ও সেলাই কবে শেষ হবে ঠিক করুন। তারিখের তিন দিন আগে থেকে আর পার হয়ে গেলে স্টাইলের পাতায় ও মাস্টার ব্যাচের পাতায় সতর্কবার্তা দেখায়।",
        },
        {
          text: "কাটার সময় কাপড়ে ফুটো, রঙের দাগ বা শেড পেলে “Fabric Fault Note” চাপুন: কোন কাপড়, কত কেজি, কত টাকা কাটবেন, একটি ছবি আর কী সমস্যা লিখে “Log the Fabric Fault Note” চাপুন। এটি সরবরাহকারীর ফল্ট লগে যায়, পরের পেমেন্ট থেকে কাটার জন্য।",
        },
      ],
      tips: [
        "ভুল করে লেখা কাটিং রিপোর্ট মুছে ফেলা যায়, তবে যে রিপোর্টের পিস এমব্রয়ডারি বা প্রিন্টে গেছে সেটি মোছা যায় না।",
        "নষ্ট পিস আবার কাটা না হওয়া পর্যন্ত কাটা পিসের হিসাব থেকে বাদ থাকে।",
      ],
    },
    {
      slug: "production-finishing",
      title: "ফিনিশিং, A/B/C গ্রেড আর পুরো প্যাকিং লিস্ট গ্রহণ করবেন যেভাবে",
      summary:
        "ফিনিশিংয়ে প্রতিটি পিস রং ও সাইজ অনুযায়ী A, B বা C (মেরামতে যাবে) গ্রেডে ভাগ করুন, সেলাইয়ের ভুলের রিজেক্ট আলাদা রাখুন। “Receive Full Packing List” চাপলে শুধু A ও B পিস সেলসের স্টকে যায়, হারানো বা চুরি যাওয়া পিস ফ্যাক্টরির ফল্ট লগে যায়, আর এক পিসের চূড়ান্ত খরচ হয় মোট খরচ ÷ (A + B)।",
      keywords: [
        "finishing",
        "qc",
        "a grade",
        "b grade",
        "c grade",
        "mending",
        "reject",
        "missing",
        "packing list",
        "final unit cost",
        "unit cost",
        "ফিনিশিং",
        "গ্রেড",
        "মেরামত",
        "রিজেক্ট",
        "হারানো পিস",
        "প্যাকিং লিস্ট",
      ],
      routes: [
        "/production/projects/[projectId]/finishing",
        "/production/projects/[projectId]/finishing/new",
      ],
      who: "পাতাটি দেখেন Production-এর সবাই, স্টোর ও Accounts। ফিনিশিং গণনা আর মেরামত থেকে ফেরত লেখেন Production Manager ও স্টোর; প্যাকিং লিস্ট গ্রহণ করেন যাঁরা পণ্য স্টকে তোলেন। স্টাইল বন্ধ করেন শুধু Production Manager। খরচ দেখেন Production Manager ও Accounts।",
      anyOf: ["production.view"],
      steps: [
        {
          text: "প্রজেক্টের পাতায় “Finishing and QC” অংশে কত পিস A, B, C, রিজেক্ট আর হারানো তা দেখায়। “Open finishing” চাপলে ফিনিশিংয়ের পুরো পাতা খোলে।",
          image: {
            id: "production-finishing-1",
            caption: "প্রজেক্টের পাতায় “Finishing and QC” অংশ",
          },
        },
        {
          text: "“New finishing count” চাপুন। প্রতিটি রং ও সাইজের ঘরে কত পিস A-grade, B-grade, C (মেরামতে যাবে) আর Reject (সেলাইয়ের ভুল, ঠিক করা যায় না) লিখুন। যত পিস কাটা হয়েছে আর এমব্রয়ডারি থেকে ফিরেছে তার বেশি লেখা যায় না। QC শিটের ছবি দিয়ে “Save the finishing count” চাপুন।",
          image: {
            id: "production-finishing-2",
            caption: "রং ও সাইজ অনুযায়ী A, B, C আর রিজেক্টের ঘর",
          },
        },
        {
          text: "C-grade পিস মেরামত হয়ে ফিরলে “Back from mending” চেপে লিখুন কত পিস A, কত B আর কত ঠিক হলো না (Reject)।",
        },
        {
          text: "ফ্যাক্টরি পুরো প্যাকিং লিস্ট দিলে “Receive Full Packing List” চাপুন। যত পিস কাটা হয়েছে কিন্তু গোনা হয়নি, “Missing (lost or stolen)” ঘরে নিজে থেকে বসে যায়; যে পিস এখনো আসবে তার ঘরে 0 দিন। “Receive the packing list” চাপলে শুধু A ও B পিস একটি ডেলিভারিতে সেলসের স্টকে যায়; C, রিজেক্ট আর হারানো পিস স্টকে যায় না।",
          image: {
            id: "production-finishing-3",
            caption: "“Receive Full Packing List” জানালা",
          },
        },
        {
          text: "হারানো পিস চূড়ান্ত খরচে ফ্যাক্টরির ফল্ট লগে যায়, যাতে CM থেকে কেটে রাখা যায়, আর Production Manager-রা সাথে সাথে বার্তা পান। Production Manager “Close the style now” টিক দিলে স্টাইলটি বন্ধ হয় আর স্টকের প্রতিটি পিসের খরচ সমান হয়ে যায়।",
        },
        {
          text: "“Final unit cost” অংশে দেখায় মোট খরচ ÷ (A + B) = এক পিসের খরচ। C-grade, রিজেক্ট আর হারানো পিস স্টকে যায় না, তাই পুরো খরচ A ও B পিস বহন করে।",
          image: {
            id: "production-finishing-4",
            caption: "“Pieces by grade” আর “Final unit cost”",
          },
        },
        {
          text: "প্যাকিং লিস্টের পরে মেরামত থেকে আরও A বা B পিস ফিরলে “Move mended pieces to stock” চেপে সেগুলো স্টকে তুলুন।",
        },
      ],
      tips: [
        "ভুল ফিনিশিং গণনা মুছে ফেলা যায়; প্যাকিং লিস্ট মোছা যায় না, তার ডেলিভারি ফিরিয়ে নিলে (undo) প্যাকিং লিস্টও বাতিল হয় আর নতুন করে নেওয়া যায়।",
        "আগের ডেলিভারিতে কিছু পিস স্টকে উঠে থাকলে প্যাকিং লিস্ট শুধু বাকি A ও B পিস নেয়।",
      ],
    },
    {
      slug: "production-action-log",
      title: "কে কখন কী করলেন: Action log দেখবেন যেভাবে",
      summary:
        "প্রতিটি স্টাইল আর মাস্টার ব্যাচের প্রতিটি কাজ (কে পণ্য গ্রহণ করলেন, কে কাটিং রিপোর্ট লিখলেন, কে কাপড় দিলেন) সময় ও নামসহ এক তালিকায়। এই তালিকা কেউ বদলাতে বা মুছতে পারেন না।",
      keywords: [
        "action log",
        "audit",
        "employee log",
        "who did",
        "history",
        "activity",
        "কাজের তালিকা",
        "কে করলেন",
        "ইতিহাস",
      ],
      routes: ["/production/projects/[projectId]/log", "/production/batches/[batchId]/log"],
      who: "দেখেন Production Manager ও Accounts, কারণ কিছু লাইনে খরচের অঙ্ক থাকে।",
      anyOf: ["production.manage", "accounts.view"],
      steps: [
        {
          text: "স্টাইল বা মাস্টার ব্যাচের পাতায় “Action log” অংশে “Open the action log” চাপুন। মাস্টার ব্যাচের তালিকায় ব্যাচ আর তার সব স্টাইলের কাজ একসাথে থাকে।",
        },
        {
          text: "দিন অনুযায়ী নতুন থেকে পুরোনো সাজানো থাকে: সময়, কে করলেন, কোন জিনিস (Cutting, Finishing, Delivery to stock, Material issue…) আর কী হলো।",
          image: {
            id: "production-action-log-1",
            caption: "একটি স্টাইলের Action log",
          },
        },
        {
          text: "“Person” আর “What” বেছে “Show” চাপলে শুধু একজনের বা এক ধরনের কাজ দেখায়। পুরোনো কাজ দেখতে নিচে “Show older” চাপুন।",
        },
      ],
      tips: [
        "প্রতিটি কাজ যেই মুহূর্তে সেভ হয় সেই মুহূর্তেই এখানে লেখা হয়; পরে বদলানো বা মোছা যায় না।",
      ],
    },
    {
      slug: "production-batch-money",
      title: "মাস্টার ব্যাচের খরচ ভাগ আর ফ্যাক্টরিকে অগ্রিম CM দেবেন যেভাবে",
      summary:
        "QC, যাতায়াতের মতো ব্যাচের খরচ সব স্টাইলে সমান ভাগে বা একটি স্টাইলে বসানো (Cost Setup), আর মাস্টার ব্যাচের নামে ফ্যাক্টরিকে অগ্রিম CM দেওয়া।",
      keywords: [
        "cost setup",
        "split cost",
        "qc cost",
        "travel cost",
        "advance cm",
        "advance payment",
        "factory payment",
        "খরচ ভাগ",
        "অগ্রিম",
        "ফ্যাক্টরি পেমেন্ট",
      ],
      routes: ["/production/batches/[batchId]"],
      who: "খরচ বসান Production Manager ও Accounts; টাকা দেন শুধু Accounts।",
      anyOf: ["production.manage", "accounts.view"],
      steps: [
        {
          text: "মাস্টার ব্যাচের পাতায় “Factory money” অংশে “Add a cost (QC, travel…)” চাপুন।",
          image: {
            id: "production-batch-money-1",
            caption: "মাস্টার ব্যাচের Factory money অংশ",
          },
        },
        {
          text: "“Cost Setup”-এ বেছে নিন: সব খোলা স্টাইলে সমান ভাগ (পয়সা পর্যন্ত মিলিয়ে), নাকি “On one style”। তারপর খরচের খাত, টাকা আর কার কাছে বাকি তা দিন। সাপ্লায়ারের বাকি হলে একটিই বিল হয়, স্টাইলগুলোতে ভাগ করা।",
          image: {
            id: "production-batch-money-2",
            caption: "খরচ সব স্টাইলে সমান ভাগ করা",
          },
        },
        {
          text: "ফ্যাক্টরিকে অগ্রিম দিতে Accounts “Pay an advance” চাপুন। টাকাটি মাস্টার ব্যাচের নামে থাকে: আগে ব্যাচের স্টাইলগুলোর বিল মেটায়, বাকিটা অগ্রিম হিসেবে থাকে। শেষে “Record the payment” চাপুন।",
          image: {
            id: "production-batch-money-3",
            caption: "মাস্টার ব্যাচের নামে অগ্রিম CM",
          },
        },
      ],
      tips: [
        "কাপড় আর ফ্যাক্টরির টাকা স্টাইল বা ব্যাচ ধরে মেটে (project-wise)। এক্সেসরিজ সাপ্লায়ারের টাকা এক চলতি হিসাবে যায়, যা তাঁর মোট Supplier Due থেকে কমে; তাই তাঁদের ব্যাচের নামে টাকা দেওয়া যায় না।",
        "বন্ধ হয়ে যাওয়া স্টাইলে নতুন খরচ বসে না; সমান ভাগ হয় শুধু খোলা স্টাইলগুলোতে।",
      ],
    },
    {
      slug: "production-cm-settlement",
      title: "ফ্যাক্টরির ফাইনাল CM হিসাব আর PDF বিল করবেন যেভাবে",
      summary:
        "মোট CM থেকে কাটাকাটি (হারানো পিস, কাপড়ের ত্রুটি, ছাড়ের বেশি রিজেক্ট, চাইলে C-গ্রেডের CM) আর নেওয়া অগ্রিম বাদ দিয়ে ফ্যাক্টরির শেষ পাওনা, তার PDF বিল, আর সেভ করলেই কাটাকাটির টাকা ফ্যাক্টরির Supplier Due থেকে নিজে থেকে কমে যাওয়া।",
      keywords: [
        "cm settlement",
        "final bill",
        "factory bill",
        "deduction",
        "final payable",
        "c-grade",
        "supplier due",
        "deductions from suppliers",
        "ফাইনাল হিসাব",
        "ফ্যাক্টরির বিল",
        "কাটাকাটি",
        "শেষ পাওনা",
        "সাপ্লায়ারের পাওনা",
        "reject allowance",
        "rejects over the allowance",
        "রিজেক্ট",
      ],
      routes: ["/production/batches/[batchId]/cm-settlement"],
      who: "দেখেন Production Manager ও Accounts; সেভ বা বাতিল করেন Production Manager ও যাঁরা টাকা দেন (Accounts)।",
      anyOf: ["production.manage", "accounts.view"],
      steps: [
        {
          text: "মাস্টার ব্যাচের “Factory money” অংশে “Work out the CM settlement” চাপুন। প্রতিটি স্টাইলের A, B, C আর reject পিস তার CM রেট দিয়ে গুণ করে মোট CM দেখায়। হারানো পিসের CM দেওয়া হয় না।",
        },
        {
          text: "রিজেক্ট ব্যাচের “Reject allowance” (নিজে থেকে কাটা পিসের ২%) পর্যন্ত বিনা জরিমানায় থাকে। এর বেশি হলে স্টাইলের সারিতে কয়টি বেশি (“over”) দেখায়, আর কাটাকাটিতে “Rejects over the allowance” লাইনে প্রতিটি বেশি রিজেক্ট স্টাইলের লক্ষ্য দামে বসে। যেমন ১,২২৪ পিস কাটা হলে ২৪টি পর্যন্ত বিনা জরিমানায়; ৩৭টি রিজেক্ট হলে ১৩টির দাম কাটা হয়। কোনো স্টাইলে লক্ষ্য দাম না থাকলে একটি সতর্কতা দেখায়, সেই স্টাইলের রিজেক্টের জন্য কিছু কাটা হয় না।",
          image: {
            id: "production-cm-settlement-1",
            caption: "স্টাইল ধরে CM আর কাটাকাটি",
          },
        },
        {
          text: "কাটাকাটিতে নিজে থেকে বসে ফ্যাক্টরির খোলা ফল্ট: হারানো পিসের দাম (কোনো ছাড় ছাড়াই, পুরোটা) আর কাপড়ের ত্রুটি। এমব্রয়ডারি বা প্রিন্টের কারখানার নষ্ট পিস এখানে আসে না, সেগুলো সেই কারখানার নিজের Supplier Due থেকে কাটা হয়। C-গ্রেড পিসের CM কাটবেন কি না তা আপনি টিক দিয়ে ঠিক করেন; টিক দিলেই শেষ পাওনা বদলে যায়।",
        },
        {
          text: "হিসাব: Total CM − Deductions − Advance taken = Final payable। ঠিক থাকলে “Save and make the PDF bill” চাপুন। এরপর “Download the PDF bill” দিয়ে ফ্যাক্টরির বিল নামান; Accounts-কে শেষ পাওনা জানানো হয়।",
        },
        {
          text: "সেভ করার সাথে সাথে কাটাকাটির মোট টাকা ফ্যাক্টরির Supplier Due (আমাদের কাছে তাদের পাওনা) থেকে নিজে থেকে কমে যায়; Accounts-কে আলাদা করে কিছু করতে হয় না। খাতায় একটি এন্ট্রি হয়, যা আগে এই ব্যাচের স্টাইলগুলোর বিল মেটায়, আর টাকাটা আয়ের খাত “Deductions from Suppliers”-এ জমা হয়। “Final payable” পাতায় দেখায় কত টাকা কোন এন্ট্রিতে (JV-…) কমানো হলো।",
          image: {
            id: "production-cm-settlement-2",
            caption: "শেষ পাওনা আর PDF বিল",
          },
        },
      ],
      tips: [
        "সেভ করলে যে ফল্টগুলো কাটা হলো সেগুলো ফল্ট লগে Deducted হয়ে যায়। ভুল হলে “Undo the settlement” চাপুন; ফল্টগুলো আবার খোলা হয়ে যায় আর কাটাকাটির টাকা আবার ফ্যাক্টরির Supplier Due-তে ফিরে আসে।",
        "এই সুবিধা আসার আগে সেভ করা কোনো হিসাবে কাটাকাটি Supplier Due থেকে কমেনি; তার পাতায় একটি নোট তা জানায়। সেটি “Undo the settlement” করে আবার সেভ করলেই কাটাকাটি Supplier Due থেকে কমে যায়।",
        "কোনো স্টাইলের CM রেট ঠিক না থাকলে আগে ফ্যাক্টরির চুক্তিতে CM রেট দিন।",
      ],
    },
    {
      slug: "production-batch-summary",
      title: "ব্যাচের সারাংশ (Batch summary) দেখবেন ও PDF নেবেন যেভাবে",
      summary:
        "এক পাতায় পুরো মাস্টার ব্যাচের টাকার গল্প: মোট খরচ, একটি ভালো পিসের খরচ, সরবরাহকারীদের থেকে কাটা জরিমানা, স্টাইল ধরে পিস ও খরচ, টাকা কোথায় গেল, আর গুদামে কত পিস কত দামে উঠল; সঙ্গে এর PDF।",
      keywords: [
        "batch summary",
        "summary",
        "cost a good piece",
        "penalties",
        "batch pdf",
        "ব্যাচের সারাংশ",
        "পিসপ্রতি খরচ",
        "জরিমানা",
        "কাটাকাটি",
      ],
      routes: ["/production/batches/[batchId]/summary"],
      who: "দেখেন Production Manager, Accounts ও Super Admin (যাঁরা উৎপাদনের খরচ দেখতে পারেন)।",
      anyOf: ["production.manage", "accounts.view"],
      steps: [
        {
          text: "মাস্টার ব্যাচের পাতায় “Batch cost” অংশের পাশে “Batch summary” চাপুন।",
          image: {
            id: "production-batch-summary-1",
            caption: "ব্যাচের পাতায় “Batch cost”-এর পাশে “Batch summary”",
          },
        },
        {
          text: "ওপরে “At a glance”: “Total cost” (ব্যাচের সব খরচ), “Cost a good piece” (মোট খরচ ÷ A ও B পিস, লক্ষ্য দামের পাশে), “Taken back from suppliers” (ফল্ট আর ছাড়ের বেশি রিজেক্টের জন্য কাটা টাকা) আর “In stock” (গুদামে ওঠা A ও B পিস)।",
          image: {
            id: "production-batch-summary-2",
            caption: "“At a glance”: মোট খরচ, ভালো পিসের খরচ, কাটা টাকা, স্টক",
          },
        },
        {
          text: "“Pieces and cost by style”-এ প্রতিটি স্টাইলের লক্ষ্য, কাটা, A, B, C, রিজেক্ট, হারানো পিস, মোট খরচ আর এক পিসের খরচ দেখায়।",
        },
        {
          text: "“Where the money went”-এ স্টোর থেকে দেওয়া কাপড় ও এক্সেসরিজ আর খরচের খাত (যেমন CM, এমব্রয়ডারি, QC) বড় থেকে ছোট করে, আর “Billed by supplier”-এ কোন সরবরাহকারী কত বিল করেছেন।",
        },
        {
          text: "“Penalties and deductions”-এ ফ্যাক্টরির CM হিসাব (সেভ না হলে আজকের হিসাবে), “Rejects over the allowance” আর “Faults on the batch”। এমব্রয়ডারি বা প্রিন্টের কারখানার নষ্ট পিসের পাশে “Off their due” লেখা থাকে, মানে টাকাটা তাঁর Supplier Due থেকে কমে গেছে।",
          image: {
            id: "production-batch-summary-3",
            caption: "“Penalties and deductions”: CM হিসাব, ছাড়ের বেশি রিজেক্ট ও ফল্ট",
          },
        },
        {
          text: "“Delivered to stock”-এ কোন গুদামে কত A ও B পিস কত দামে উঠল। পুরো পাতার PDF নিতে ওপরের “Download the PDF” চাপুন।",
        },
      ],
      tips: [
        "শুধু A ও B পিস স্টকে যায়, তাই পুরো খরচ ভালো পিসের ওপর পড়ে। কাটা টাকা “Deductions from Suppliers” খাতে আয় হিসেবে যায়, তাই নিট খরচ মোট খরচ থেকে সেটুকু কম।",
        "PDF চাইলে তখনই বানানো হয়, রেখে দেওয়া হয় না; প্রতিবার সর্বশেষ হিসাব আসে।",
      ],
    },
    {
      slug: "production-start-from-sales",
      title: "সেলস অর্ডার বা প্রোফর্মা থেকে উৎপাদন শুরু করবেন যেভাবে",
      summary:
        "সেলস অর্ডার বা প্রোফর্মা ইনভয়েসের পাতা থেকে এক চাপে প্রোডাকশন প্রজেক্ট খোলা, যাতে ক্রেতা, স্টাইল আর রং ও সাইজ অনুযায়ী কত পিস বানাতে হবে তা নিজে থেকে বসে যায়।",
      keywords: [
        "start production",
        "sales order",
        "order",
        "proforma",
        "pi",
        "colour and size",
        "color size",
        "size breakdown",
        "matrix",
        "grid",
        "pieces per colour and size",
        "split",
        "উৎপাদন শুরু",
        "অর্ডার থেকে",
        "প্রোফর্মা থেকে",
        "রং ও সাইজ",
        "সাইজ",
        "ম্যাট্রিক্স",
        "ফ্যাক্টরিতে ভাগ",
      ],
      routes: ["/production/projects/new", "/sales/orders", "/sales/proformas"],
      who: "প্রজেক্ট খোলেন Production Manager ও Super Admin। Production Manager সেলসের পাতা খোলেন না, তাই তিনি “New project” পাতার খোঁজ থেকে শুরু করেন। অর্ডার বা প্রোফর্মার পাতায় “Production” অংশে তার প্রজেক্টগুলো সেলসের সবাই দেখেন, কিন্তু “Start production” বোতাম পান শুধু যাঁরা প্রজেক্ট খুলতেও পারেন (যেমন Super Admin)।",
      anyOf: ["production.manage"],
      steps: [
        {
          text: "“Production” > “Projects” ট্যাবে “New project” চাপুন। উপরের “Making a sales order or a proforma?” ঘরে “Find a sales order or proforma”-এ অর্ডার বা PI নম্বর, অথবা ক্রেতার নাম লিখুন। খোলা অর্ডার ও প্রোফর্মাগুলো তাদের পিসসহ দেখাবে (দাম নয়); যেটি বানাবেন তাতে চাপুন।",
          image: {
            id: "production-start-from-sales-1",
            caption: "“New project” পাতায় সেলস অর্ডার বা প্রোফর্মা খোঁজার ঘর",
          },
        },
        {
          text: "সেলসের পাতা খুলতে পারলে (যেমন Super Admin) অর্ডার বা প্রোফর্মার পাতার “Production” অংশে “Start production” চাপলেও একই ফর্ম খোলে।",
          image: {
            id: "production-start-from-sales-2",
            caption: "অর্ডারের পাতায় “Production” অংশ ও “Start production” বোতাম",
          },
        },
        {
          text: "“Start production for …” পাতা খুলবে। “Project name”, ক্রেতা, স্টাইল ও “Category” আগে থেকে বসানো থাকে। অর্ডারের পাঠানোর দিন (ship-by) থাকলে সেটিই “Due” হয়। ক্রেতা অর্ডারের ক্রেতাই থাকে, বদলানো যায় না।",
        },
        {
          text: "“Pieces per colour and size” অংশে স্টাইলের প্রতিটি রঙের নিচে সাইজের ঘরে কত পিস বানাতে হবে তা বসানো থাকে। অর্ডারের পিস থেকে যা আগেই ডেলিভারি হয়েছে আর যা অন্য প্রজেক্টে বানানো হচ্ছে তা বাদ যায়। যেকোনো ঘর বদলাতে পারেন, “Pieces to make” নিজে থেকে যোগফল দেখায়।",
          image: {
            id: "production-start-from-sales-3",
            caption: "রং ও সাইজ অনুযায়ী পিসের ঘর, আর নিজে থেকে যোগ হওয়া “Pieces to make”",
          },
        },
        {
          text: "আরেকটি স্টাইল যোগ করতে “Another style (optional)” থেকে স্টাইল বেছে নিন। কোনো স্টাইল বাদ দিতে তার পাশে “Remove” চাপুন।",
        },
        {
          text: "ফ্যাক্টরি বেছে নিন, “In production now” বা “Planned for later” ঠিক করুন, তারপর “Create the project” চাপুন।",
        },
        {
          text: "প্রজেক্টের পাতায় “Started from”-এ অর্ডার বা প্রোফর্মার নম্বর থাকে। “Pieces to make” অংশে প্রতিটি রং ও সাইজে কত পিস বানাতে হবে আর ফ্যাক্টরি থেকে কত পিস স্টকে এসেছে তা দেখা যায়। কোনো ঘরের সব পিস এলে টিক চিহ্ন পড়ে।",
          image: {
            id: "production-start-from-sales-4",
            caption: "প্রজেক্টের পাতায় রং ও সাইজ অনুযায়ী লক্ষ্য ও স্টকে আসা পিসের তালিকা",
          },
        },
        {
          text: "অর্ডার বা প্রোফর্মার পাতার “Production” অংশে তার সব প্রজেক্ট, এখনকার ধাপ ও জমার দিন দেখা যায়। প্রজেক্টের কোডে চাপলে প্রজেক্টের পাতা খোলে।",
        },
      ],
      tips: [
        "একই অর্ডারের কাজ কয়েকটি ফ্যাক্টরিতে ভাগ করতে আবার “Start production” চাপুন। নতুন ফর্মে শুধু বাকি পিস বসে।",
        "কোটেশনের কোনো পণ্য রং ও সাইজে মেলানো না গেলে (যেমন Products-এ নেই এমন কাস্টম পণ্য, বা অচেনা রঙের নাম), ফর্মে “Not on the grid, so add these by hand or in the total” নোটে তার নাম থাকে। পণ্যটির স্টাইল Products-এ থাকলে সেটি আগে থেকে বেছে রাখা হয়: “Fill in …'s colours and sizes” চেপে তার ঘর খুলে পিস লিখুন।",
        "প্রোফর্মা অর্ডারে পরিণত হলে উৎপাদন অর্ডারের পাতা থেকে শুরু করুন। কাউন্টারের (walk-in) বিক্রি, বাতিল অর্ডার বা মাল পাঠানো হয়ে যাওয়া অর্ডার থেকে উৎপাদন শুরু হয় না।",
        "প্রোফর্মার অগ্রিম পুরো পেলে প্রজেক্ট নিজে থেকেই খোলে, আর সব পণ্য রং ও সাইজে মিললে ঘরগুলোও বসে যায়। আগেই হাতে প্রজেক্ট খোলা থাকলে আরেকটি খোলে না।",
        "কোনো প্রজেক্টের রং ও সাইজের ঘরে থাকা স্টাইল Products থেকে মুছে ফেলা যায় না, কারণ সেটি প্রজেক্টের ইতিহাসে থাকে। দরকারে স্টাইলটি আর্কাইভ করুন।",
      ],
    },
    {
      slug: "production-stages",
      title: "প্রজেক্টের ধাপ (কাটিং, সেলাই…) এগিয়ে নেবেন যেভাবে",
      summary:
        "প্রজেক্ট শুরু করা, পরের ধাপে নেওয়া, দরকারে পেছনের ধাপে ফেরত পাঠানো, আর হোল্ডে রাখা ও আবার চালু করা।",
      keywords: [
        "stage",
        "change the stage",
        "fabric sourcing",
        "cutting",
        "sewing",
        "wash and qc",
        "finishing",
        "on hold",
        "rework",
        "ধাপ",
        "কাটিং",
        "সেলাই",
        "ফিনিশিং",
        "হোল্ড",
      ],
      routes: ["/production/projects"],
      who: "যাঁদের প্রজেক্ট সামলানোর অনুমতি আছে, যেমন Production Manager ও Super Admin।",
      anyOf: ["production.manage"],
      steps: [
        {
          text: "“Projects” ট্যাবে প্রজেক্টে চাপুন। উপরে “Stages” অংশে ধাপগুলো দেখবেন: “Fabric sourcing”, “Cutting”, “Sewing”, “Wash and QC”, “Finishing”, প্রতিটিতে কত দিন লেগেছে সহ।",
          image: {
            id: "production-stages-1",
            caption: "প্রজেক্টের পাতায় ধাপের সারি, এখনকার ধাপে “Now” চিহ্ন",
          },
        },
        {
          text: "পরিকল্পিত (Planned) প্রজেক্টে কাজ শুরু হলে “Start production” চাপুন।",
        },
        {
          text: "এক ধাপ শেষ হলে “Move to …” বোতামে চাপুন (যেমন “Move to Sewing”)। চাইলে “Note (optional)”-এ মন্তব্য লিখুন।",
        },
        {
          text: "নোট ছাড়া দ্রুত বদলাতে “Production” > “Overview”-এর বোর্ডে প্রজেক্টের কার্ডে “Move to …” চাপুন। ভুল হলে ১০ মিনিটের মধ্যে বার্তার “Undo” চাপলে আগের ধাপে ফিরে যায়।",
        },
        {
          text: "অন্য কোনো ধাপে যেতে “Change the stage” চাপুন এবং “Move to” থেকে ধাপ বেছে নিন। পেছনের ধাপে ফেরত পাঠালে (যেমন সেলাই ভুলের জন্য) “Why it goes back”-এ কারণ লিখতেই হবে।",
          image: {
            id: "production-stages-2",
            caption: "“Change the stage” জানালা: “Move to” ও “Why it goes back”",
          },
        },
        {
          text: "কাজ সাময়িক বন্ধ থাকলে “Put on hold”, আবার শুরু হলে “Resume” চাপুন।",
        },
        {
          text: "“Stage log”-এ প্রতিটি ধাপ বদল, নোট ও ফেরত পাঠানো (“Sent back”) কাজের পুরো ইতিহাস থাকে।",
        },
      ],
      tips: [
        "কাটা বা সেলাই হওয়া পিস আলাদা করে গোনার ব্যবস্থা এখনো নেই। অগ্রগতি বোঝা যায় ধাপ, দিন ও নোট থেকে।",
      ],
    },
    {
      slug: "production-receive-goods",
      title: "ফ্যাক্টরি থেকে আসা মাল স্টকে তুলবেন যেভাবে",
      summary:
        "ফ্যাক্টরির ডেলিভারির পিস রং ও সাইজ অনুযায়ী ভালো (A-grade) ও B-grade আলাদা করে গুনে গুদামে তোলা; অর্ডারের ছক থেকে কত পিস বাকি তা প্রতিটি ঘরে দেখা যায়।",
      keywords: [
        "receive goods",
        "factory delivery",
        "delivery",
        "intake",
        "a-grade",
        "b-grade",
        "good",
        "still to come",
        "fill in",
        "receiving matrix",
        "packing list",
        "stock in",
        "মাল গ্রহণ",
        "ডেলিভারি",
        "স্টকে তোলা",
        "বি গ্রেড",
        "মাল এসেছে",
        "বাকি পিস",
      ],
      routes: ["/production/deliveries/new", "/production/deliveries"],
      who: "যাঁদের মাল গ্রহণের অনুমতি আছে: Warehouse Team, Production Manager ও Super Admin।",
      anyOf: ["production.stock_intake"],
      steps: [
        {
          text: "“Production” > “Deliveries” ট্যাবে “Receive goods” চাপুন। “Which project are the goods for?” থেকে প্রজেক্ট বেছে নিন।",
          image: {
            id: "production-receive-goods-1",
            caption: "“Receive goods” পাতায় প্রজেক্ট বাছাই",
          },
        },
        {
          text: "“Pieces received” অংশে রং × সাইজের ছক আসে। প্রজেক্টে রং ও সাইজ অনুযায়ী পিসের ছক (target grid) থাকলে তার স্টাইলগুলো নিজে থেকেই খোলে, না থাকলে স্টাইল বেছে নিন। প্রতিটি ঘরে কত পিস এসেছে লিখুন: ভালো পিস “Good (A-grade)” ট্যাবে, সামান্য ত্রুটির পিস “B-grade” ট্যাবে। একই ডেলিভারিতে আরেকটি স্টাইল থাকলে “Add a style” চাপুন।",
          image: {
            id: "production-receive-goods-2",
            caption:
              "রং × সাইজের ছকে “Good (A-grade)” ও “B-grade” ট্যাব, প্রতিটি ঘরের নিচে কত পিস বাকি",
          },
        },
        {
          text: "ছক থাকলে প্রতিটি ঘরের নিচে লেখা থাকে কত পিস এখনো আসা বাকি (যেমন “… to come”), সব এসে গেলে “All in”, আর অর্ডারের চেয়ে বেশি লিখলে হলুদ রঙে “… over”। স্টাইলের ওপরে মোট “To make …”, আগে কত এসেছে ও কত বাকি দেখায়। ফ্যাক্টরি বাকি সব পিস একসাথে পাঠালে “Fill in what is still to come” চাপুন: প্রতিটি ঘরে বাকি পিস ভালো পিস হিসেবে বসে যায় (B-grade-এ যা লিখেছেন তা বাদ দিয়ে), তারপর দরকারমতো বদলে নিন।",
          image: {
            id: "production-receive-goods-4",
            caption: "“Fill in what is still to come” বোতাম ও ঘরের নিচে বাকি পিসের সংখ্যা",
          },
        },
        {
          text: "“Into the store”-এ কোন “Warehouse”-এ রাখা হবে বেছে নিন। ফ্যাক্টরির প্যাকিং লিস্টের নম্বর ও ছবি বা PDF দিন।",
        },
        {
          text: "খরচ দেখার অনুমতি থাকলে “Cost of the pieces” অংশে খরচ কীভাবে ভাগ হবে বেছে নিন: “Same cost for every piece”, “B-grade pieces cost less” (B-grade একটি A-grade পিসের খরচের কত শতাংশ বহন করবে) বা “Type the cost per piece”।",
        },
        {
          text: "“Save the delivery” (বা “Save as a draft”) চাপুন। মনে রাখবেন, নিশ্চিত না করা পর্যন্ত কিছুই স্টকে যায় না।",
        },
        {
          text: "ডেলিভারির পাতায় পিস মিলিয়ে নিন। ভুল থাকলে “Correct the pieces” চাপুন। সব ঠিক থাকলে “Confirm into stock” চাপুন।",
        },
        {
          text: "খরচ দেখার অনুমতি থাকলে খরচ বেছে নিন: “Their share” (প্রজেক্টের খরচের এই ডেলিভারির ভাগ), “All that is left” (ফ্যাক্টরির শেষ ডেলিভারির জন্য বাকি সব খরচ) বা “Type the cost”। শেষ ডেলিভারি হলে “This is the factory's last delivery…” টিক দিন। আবার “Confirm into stock” চাপুন।",
          image: {
            id: "production-receive-goods-3",
            caption: "“Confirm into stock” জানালা: খরচের তিনটি বিকল্প ও শেষ ডেলিভারির টিক",
          },
        },
        {
          text: "Production Manager হলে শেষ ডেলিভারির সাথেই “Also complete …” টিক দিয়ে প্রজেক্ট শেষ করতে পারেন। টিক দিলে জানালায় লেখা আসে মোট কত পিস হলো, কত পিস কম (wastage হিসেবে তালিকায় থাকবে, কোনো লস বুক হয় না), আর খরচ দেখার অনুমতি থাকলে প্রতিটি পিসের একই খরচ কত হবে (মোট খরচ ÷ পাওয়া পিস)।",
          image: {
            id: "production-receive-goods-5",
            caption: "“Also complete …” টিক দিলে ঘাটতি ও পিসপ্রতি একই খরচের বার্তা",
          },
        },
      ],
      tips: [
        "মাল স্টকে তোলার সঙ্গে সঙ্গে পিস মূল ইনভেন্টরিতে যোগ হয় এবং প্রতিটি SKU-র গড় খরচ নতুন করে হিসাব হয়।",
        "স্টাইলের রং ও সাইজ (SKU) না থাকলে আগে Products-এ সেগুলো যোগ করুন।",
        "প্রজেক্টে এখনো কোনো খরচ না থাকলে পিস শূন্য খরচে স্টকে যাবে। তখন “Receive them at zero cost” টিক দিতে হয়, অথবা আগে খরচ লিখুন।",
        "দরকার না হলে খসড়া ডেলিভারি “Cancel the draft” দিয়ে বাতিল করা যায়।",
        "প্যাকিং লিস্ট AI দিয়ে পড়ে নেওয়া এখনো চালু হয়নি, পিস হাতে লিখতে হয়।",
      ],
    },
    {
      slug: "production-undo-delivery",
      title: "ভুল করে স্টকে তোলা ডেলিভারি ফিরিয়ে নেবেন যেভাবে",
      summary:
        "নিশ্চিত করা ডেলিভারি কারণসহ বাতিল করা, যাতে পিস স্টক থেকে বেরিয়ে যায় এবং ঠিক করার জন্য একটি খসড়া কপি তৈরি হয়।",
      keywords: [
        "undo delivery",
        "undo this delivery",
        "reverse",
        "wrong delivery",
        "correct",
        "ডেলিভারি বাতিল",
        "ভুল ডেলিভারি",
        "ফিরিয়ে নেওয়া",
        "সংশোধন",
      ],
      routes: ["/production/deliveries"],
      who: "যাঁদের মাল গ্রহণের অনুমতি আছে।",
      anyOf: ["production.stock_intake"],
      steps: [
        { text: "“Deliveries” ট্যাবে “In stock” অবস্থার ডেলিভারিটি খুলুন।" },
        {
          text: "“Undo this delivery” চাপুন এবং কারণ লিখুন।",
          image: {
            id: "production-undo-delivery-1",
            caption: "“Undo this delivery” জানালা: কারণ ও “Open a copy to correct” টিক",
          },
        },
        {
          text: "ঠিক করে আবার তুলতে চাইলে “Open a copy to correct” টিক রাখুন। “Undo the delivery” চাপুন।",
        },
        {
          text: "পিস স্টক থেকে বেরিয়ে যাবে এবং ডেলিভারিটি “Undone” দেখাবে। খসড়া কপিতে পিস ঠিক করে আবার “Confirm into stock” করুন।",
        },
      ],
      tips: [
        "ডেলিভারির পিস ইতিমধ্যে বিক্রি হয়ে গেলে বা অর্ডারে আটকে থাকলে ফিরিয়ে নেওয়া যায় না। বার্তায় কোন SKU-র কত পিস খালি আছে লেখা থাকবে।",
        "শেষ হওয়া (Completed) প্রজেক্টের ডেলিভারি ফিরিয়ে নিলে প্রজেক্ট আবার চালু হয়, আর সব পিসের একই খরচ (মোট ÷ পাওয়া পিস) তুলে নিয়ে প্রতিটি ডেলিভারি যে খরচে এসেছিল সেখানে ফিরে যায়। আবার শেষ করলে নতুন করে একই খরচ হিসাব হয়।",
      ],
    },
    {
      slug: "production-materials-sent",
      title: "ফ্যাক্টরিতে কী মালামাল পাঠালেন তা চালানসহ লিখে রাখবেন যেভাবে",
      summary:
        "প্রজেক্টের জন্য ফ্যাক্টরিতে কাপড়, ট্রিমস বা কার্টন পাঠালে সহজ লেখায় (যেমন 500 kg Oxford fabric) MC- নম্বরের চালানসহ রেকর্ড রাখা, আর ছাপার জন্য দাম ছাড়া Material Challan PDF।",
      keywords: [
        "materials sent",
        "send material",
        "material challan",
        "challan",
        "mc",
        "fabric sent",
        "sent to factory",
        "চালান",
        "মালামাল পাঠানো",
        "কাপড় পাঠানো",
        "ফ্যাক্টরিতে পাঠানো",
        "ম্যাটেরিয়াল চালান",
      ],
      routes: ["/production/projects"],
      who: "পাঠানো লিখতে ও চালান বাতিল করতে পারেন Production Manager ও Super Admin। প্রজেক্ট যাঁরা দেখেন (Accounts, Warehouse Team) তাঁরা তালিকা দেখেন ও PDF ছাপতে পারেন।",
      steps: [
        {
          text: "প্রজেক্টের পাতায় “Materials sent” অংশে “Send material” চাপুন।",
          image: {
            id: "production-materials-sent-1",
            caption: "প্রজেক্টের “Materials sent” অংশ: চালানের তালিকা, “PDF” ও “Cancel”",
          },
        },
        {
          text: "“Sent to”-তে প্রজেক্টের ফ্যাক্টরির নাম আগে থেকেই বসানো থাকে। মাল অন্য কোথাও (যেমন ওয়াশিং প্ল্যান্টে) গেলে নামটি বদলে দিন। “Date” আজকের বা আগের কোনো দিন হতে পারে।",
        },
        {
          text: "“What was sent” অংশে প্রতিটি লাইনে “Item” (যেমন Oxford fabric, navy), “Quantity” (যেমন 500) ও “Unit” (যেমন kg) লিখুন। আরও জিনিস থাকলে “Add a line” চাপুন, ভুল লাইন “Remove” দিয়ে সরান।",
          image: {
            id: "production-materials-sent-2",
            caption: "“Send material for …” জানালা: জিনিসের লাইন ও “Add a line”",
          },
        },
        {
          text: "চাইলে “Sent with (optional)”-এ গাড়ির নম্বর, চালক বা কুরিয়ার আর “Notes (optional)” লিখুন, তারপর “Save the challan” চাপুন। চালানটি একটি MC- নম্বর পায়।",
        },
        {
          text: "তালিকায় চালানের পাশে “PDF” চাপলে Material Challan তৈরি হয়: কী কী, কত, কোথায় গেল, কোন প্রজেক্টের জন্য, আর গ্রহীতার সইয়ের জায়গা। এতে কোনো দাম থাকে না।",
          image: {
            id: "production-materials-sent-3",
            caption: "ছাপা Material Challan: জিনিস, পরিমাণ ও সইয়ের জায়গা",
          },
        },
        {
          text: "ভুল চালান তালিকা থেকে “Cancel” চেপে কারণ লিখে “Cancel the challan” দিয়ে বাতিল করুন। চালানটি “Cancelled” চিহ্নসহ তালিকায় থেকে যায়, আর তার PDF-এ বাতিলের সিল পড়ে।",
        },
      ],
      tips: [
        "এটি শুধু রেকর্ড: স্টক বা খরচ কিছুই বদলায় না। স্টোরের কাঁচামাল প্রজেক্টে দিতে Raw materials-এর “Issue materials” ব্যবহার করুন, আর পাঠানোর খরচ (যেমন পরিবহন) “Add a cost” দিয়ে যোগ করুন।",
        "ছাপা সব চালান “Reports & documents” > “Printed documents”-এ পাওয়া যায়, সেখান থেকে প্রজেক্টেও যাওয়া যায়।",
        "প্রজেক্ট শেষ বা বাতিল হলে আর কিছু পাঠানো লেখা যায় না, তবে আগের চালানগুলো থেকে যায়।",
      ],
    },
    {
      slug: "production-costs",
      title: "প্রজেক্টে খরচ যোগ করবেন ও পিসপ্রতি খরচ দেখবেন যেভাবে",
      summary:
        "মজুরি, ট্রিমস, পরিবহন ইত্যাদি খরচ প্রজেক্টে যোগ করা, আর A-grade ও B-grade পিসের খরচ দেখা।",
      keywords: [
        "add a cost",
        "cost",
        "cost a piece",
        "cost sheet",
        "making charge",
        "cm",
        "costing",
        "paid from",
        "duplicate",
        "খরচ",
        "খরচ যোগ",
        "পিসপ্রতি খরচ",
        "মজুরি",
        "কস্টিং",
        "দুবার",
      ],
      routes: ["/production/projects"],
      who: "Production Manager (সরবরাহকারীর কাছে বকেয়া হিসেবে), Accounts ও Super Admin (এখনই পরিশোধ হিসেবেও)। খরচের অঙ্ক শুধু এঁরাই দেখেন।",
      anyOf: ["production.manage", "accounts.payments.record"],
      steps: [
        {
          text: "প্রজেক্টের পাতায় “Add a cost” চাপুন।",
          image: {
            id: "production-costs-1",
            caption: "“Add a cost” জানালা: “What for”, পরিমাণ, “Owed to” ও তারিখ",
          },
        },
        {
          text: "“What for”-এ খরচের খাত (cost head) বেছে নিন এবং পরিমাণ লিখুন।",
        },
        {
          text: "অনুমতি থাকলে কীভাবে পরিশোধ হবে বেছে নিন: “Due to the supplier” (সরবরাহকারীর হিসাবে যাবে, Accounts পরে দেবেন) বা “Paid now” (এখনই ক্যাশ, ব্যাংক বা ওয়ালেট থেকে)।",
        },
        {
          text: "“Paid now” বাছলে “Paid from”-এ ঠিক কোন ক্যাশ, ব্যাংক বা ওয়ালেট অ্যাকাউন্ট থেকে টাকা গেল (ব্যালান্সসহ দেখায়) বেছে নিন, তারপর “How” ও “Reference (optional)” দিন। টাকা সঙ্গে সঙ্গে সেই অ্যাকাউন্ট থেকে কমে, একবারই হিসাবে ওঠে।",
        },
        {
          text: "“Owed to” (বা “Paid to (optional)”)-এ সরবরাহকারী, “Their bill number (optional)”, “Date” ও “Details (optional)” দিয়ে “Add the cost” চাপুন।",
        },
        {
          text: "পাতার “Costs” অংশে মোট খরচ (“Supplier bills”, “Paid directly”, “Raw materials”), কতটা স্টকে গেছে, কতটা এখনো উৎপাদনে, আর “Cost a piece”-এ A-grade ও B-grade পিসের খরচ দেখবেন।",
          image: {
            id: "production-costs-2",
            caption: "প্রজেক্টের “Costs” অংশ ও “Cost a piece”",
          },
        },
        {
          text: "ভুল খরচ “Cost entries” তালিকা থেকে “Void” করা যায়।",
        },
      ],
      tips: [
        "একাধিক প্রজেক্টে ভাগ হওয়া বড় বিল “Bills” ট্যাব থেকে লিখুন (পরের নির্দেশিকা)।",
        "কাঁচামাল Raw materials থেকে প্রজেক্টে ইস্যু করলে তার খরচও নিজে থেকে যোগ হয়।",
        "প্রজেক্ট শেষ হলে “Cost a piece”-এ সব পিসের একই খরচ দেখায়: যত খরচ স্টকে গেছে ÷ যত পিস পাওয়া গেছে, যে ডেলিভারিতেই আসুক না কেন।",
        "একই খরচ দুবার লেখা ঠেকাতে অ্যাপ আগে সতর্ক করে: একই সরবরাহকারীর একই বিল নম্বর; নম্বর না থাকলে ৩ দিনের মধ্যে একই সরবরাহকারীর একই অঙ্ক; সরবরাহকারী না থাকলে একই দিনে একই প্রজেক্ট, খাত ও অঙ্ক। মিলে যাওয়াটা দেখে সত্যিই আলাদা হলে “It is a different one: enter it anyway” টিক দিয়ে আবার চাপুন।",
      ],
    },
    {
      slug: "production-bills",
      title: "সরবরাহকারীর বিল লিখবেন ও পরিশোধ করবেন যেভাবে",
      summary:
        "ফ্যাক্টরি বা অন্য সরবরাহকারীর বিল এক বা একাধিক প্রজেক্টে ভাগ করে লেখা, বিলের ছবি রাখা আর পরে টাকা দেওয়া।",
      keywords: [
        "supplier bill",
        "enter a bill",
        "bill",
        "pay the supplier",
        "void the bill",
        "split",
        "factory bill",
        "বিল",
        "সরবরাহকারীর বিল",
        "ফ্যাক্টরির বিল",
        "বিল পরিশোধ",
      ],
      routes: ["/production/bills/new", "/production/bills"],
      who: "Production Manager বিল বকেয়া হিসেবে লিখতে পারেন। টাকা দেন ও বিল বাতিল করেন Accounts ও Super Admin।",
      anyOf: ["production.manage", "accounts.payments.record"],
      steps: [
        {
          text: "“Production” > “Bills” ট্যাবে “Enter a bill” চাপুন (প্রজেক্টের পাতার “Enter a supplier bill” থেকেও যাওয়া যায়)।",
          image: {
            id: "production-bills-1",
            caption: "“Bills” ট্যাবে বিলের তালিকা ও “Enter a bill” বোতাম",
          },
        },
        {
          text: "“Supplier”, “Their bill number (optional)” ও “Bill date” দিন।",
        },
        {
          text: "অনুমতি থাকলে “How it is paid”-এ “Due to the supplier” বা “Paid now” বেছে নিন। “Paid now” হলে “Paid from”-এ ঠিক কোন ক্যাশ, ব্যাংক বা ওয়ালেট অ্যাকাউন্ট থেকে দিলেন বেছে নিন। Production Manager-এর বিল সবসময় বকেয়া হিসেবে যায়, Accounts পরে দেন।",
        },
        {
          text: "“What it is for” অংশে “Project”, “What for” (খরচের খাত), পরিমাণ ও “Details (optional)” দিন। বিল একাধিক প্রজেক্টের হলে “Split across another project” চাপুন।",
          image: {
            id: "production-bills-2",
            caption: "বিলের লাইন: প্রজেক্ট, খাত, পরিমাণ ও “Split across another project”",
          },
        },
        {
          text: "“Photo or PDF of the bill (optional)”-এ বিলের ছবি দিন এবং “Save the bill” চাপুন।",
        },
        {
          text: "পরে টাকা দিতে বিলের পাতায় “Pay the supplier” চাপুন। পরিমাণ, “Paid on”, “Paid from” (কোন ক্যাশ, ব্যাংক বা ওয়ালেট অ্যাকাউন্ট), “How” ও “Reference (optional)” দিয়ে “Record the payment” চাপুন। ভুল বিল “Void the bill” দিয়ে বাতিল করুন।",
        },
      ],
      tips: [
        "খাত (cost head) না থাকলে আগে “Cost heads” ট্যাবে যোগ করুন।",
        "একজন সরবরাহকারীর সব বিল একসঙ্গে পরিশোধ করতে Accounts-এর “Supplier payments” ব্যবহার করুন।",
        "একই সরবরাহকারীর একই বিল নম্বর আগে লেখা থাকলে, বা নম্বর ছাড়া ৩ দিনের মধ্যে একই অঙ্কের বিল থাকলে, সেভ করার আগে অ্যাপ সেই বিলটি দেখিয়ে সতর্ক করে। একই বিল হলে বাতিল করুন; আলাদা হলে “It is a different one: enter it anyway” টিক দিয়ে আবার “Save the bill” চাপুন।",
      ],
    },
    {
      slug: "production-complete-cancel",
      title: "প্রজেক্ট শেষ বা বাতিল করবেন যেভাবে",
      summary:
        "সব মাল আসার পর প্রজেক্ট শেষ করা, অথবা কাজ বন্ধ হলে বাতিল করা, আর বাকি খরচের কী হবে তা ঠিক করা। শেষ করলে কম আসা পিস wastage হিসেবে থাকে আর প্রতিটি পিসের খরচ সমান হয়।",
      keywords: [
        "complete the project",
        "cancel the project",
        "close project",
        "finish",
        "write off",
        "wastage",
        "short",
        "cost per piece",
        "unit cost",
        "প্রজেক্ট শেষ",
        "প্রজেক্ট বাতিল",
        "সমাপ্ত",
        "বন্ধ",
        "ঘাটতি",
        "পিসপ্রতি খরচ",
      ],
      routes: ["/production/projects"],
      who: "Production Manager ও Super Admin। যে প্রজেক্টের কিছু খরচ এখনো স্টকে যায়নি, তা শেষ বা বাতিল করতে হিসাবের অনুমতি (Accounts বা Super Admin) লাগে, কারণ বাকি খরচ বাদ (write off) দিতে হয়।",
      anyOf: ["production.manage", "accounts.manage"],
      steps: [
        {
          text: "প্রজেক্টের পাতায় “Complete the project” চাপুন। ফ্যাক্টরির শেষ ডেলিভারি স্টকে তোলার সময়ও প্রজেক্ট শেষ করা যায়।",
        },
        {
          text: "কিছু খরচ এখনো স্টকে না গিয়ে থাকলে “Why the rest is written off”-এ কারণ লিখতে হবে। তারপর নিশ্চিত করুন।",
          image: {
            id: "production-complete-cancel-1",
            caption: "“Complete the project” জানালা ও “Why the rest is written off” ঘর",
          },
        },
        {
          text: "শেষ করার পর অর্ডারের চেয়ে যত পিস কম এসেছে তা wastage হিসেবে তালিকায় থাকে: “Pieces to make” ছকে প্রতিটি রং ও সাইজের ঘরে হলুদ রঙে “… short”, আর “Details”-এ “Short (wastage)”। এর জন্য আলাদা কোনো লস বুক হয় না; সেই পিসের খরচ পাওয়া পিসগুলোই বহন করে।",
          image: {
            id: "production-complete-cancel-2",
            caption: "শেষ হওয়া প্রজেক্টের “Pieces to make” ছকে কম আসা পিস",
          },
        },
        {
          text: "একই সঙ্গে প্রজেক্টের প্রতিটি পিসের খরচ সমান হয়ে যায়: স্টকে যাওয়া মোট খরচ ÷ পাওয়া পিস। যেমন ১,০০০ পিসের অর্ডারে ৯৭০ পিস এলে আর মোট খরচ ১,০০,০০০ হলে প্রতিটি পিসের খরচ ১০৩.০৯। এই খরচ নিজে থেকে ইনভেন্টরির গড় খরচে বসে, তাই পরের বিক্রির লাভ সঠিক দেখায়। “B-grade pieces cost less” বেছে থাকলে B-grade পিস তার ভাগ অনুযায়ী কম খরচ বহন করে।",
        },
        {
          text: "কাজ বন্ধ হয়ে গেলে “Cancel the project” চাপুন এবং একইভাবে কারণ লিখে নিশ্চিত করুন।",
        },
      ],
      tips: [
        "প্রজেক্টের কিছু পিস শেষ করার আগেই বিক্রি হয়ে গেলে, সেই পিসের খরচের পার্থক্য Cost of Goods Sold-এ যায়; স্টকে থাকা পিসের পার্থক্য তাদের গড় খরচে যোগ বা বিয়োগ হয়। হিসাব একবারই বুক হয়।",
        "শেষ ডেলিভারির খরচ “Type the cost per piece” দিয়ে হাতে লেখা হলে সেই খরচ বদলানো হয় না।",
        "প্রজেক্ট শেষ (Completed) হলে সরবরাহকারীদের সঙ্গে তার হিসাব নিজে থেকে মিলিয়ে রাখা হয়; পরের নির্দেশিকা দেখুন।",
        "কোনো ডেলিভারি খসড়া অবস্থায় থাকলে আগে সেটি স্টকে তুলুন বা বাতিল করুন, তারপর প্রজেক্ট শেষ করুন।",
        "যে প্রজেক্ট এখনো শুরুই হয়নি (Planned), সেটি শেষ করা যায় না; শুরু করুন বা বাতিল করুন।",
        "শেষ বা বাতিল হওয়া প্রজেক্ট “Projects” তালিকায় “Status” দিয়ে খুঁজে পাবেন।",
      ],
    },
    {
      slug: "production-supplier-settlement",
      title: "প্রজেক্ট শেষে সরবরাহকারীর হিসাব মেলানো (Settlement) যেভাবে কাজ করে",
      summary:
        "প্রজেক্টের পাতায় প্রত্যেক সরবরাহকারীর বিল, পরিশোধ ও বাকি দেখা; প্রজেক্ট শেষ হলে হিসাব মিলিয়ে প্রজেক্টের ব্যালান্স শূন্য করা আর বাকি টাকা সরবরাহকারীর মূল খাতায় রাখা।",
      keywords: [
        "settlement",
        "settled",
        "project balance",
        "supplier balance",
        "close project",
        "master ledger",
        "carried",
        "running ledger",
        "হিসাব মেলানো",
        "সেটেলমেন্ট",
        "প্রজেক্টের ব্যালান্স",
        "সরবরাহকারীর বাকি",
      ],
      routes: ["/production/projects"],
      who: "যাঁরা প্রোডাকশনের খরচ দেখতে পারেন: Production Manager, Accounts ও Super Admin।",
      anyOf: ["production.manage", "accounts.view"],
      steps: [
        {
          text: "প্রজেক্টের পাতায় খরচের নিচে “Suppliers” অংশে প্রত্যেক সরবরাহকারীর এই প্রজেক্টের বিল (“Billed”), পরিশোধ (“paid”) আর এখনো কত বাকি (“… due”) দেখা যায়। সব শোধ হলে “Paid” লেখা থাকে।",
          image: {
            id: "production-supplier-settlement-1",
            caption: "প্রজেক্টের “Suppliers” অংশ: প্রত্যেক সরবরাহকারীর বিল, পরিশোধ ও বাকি",
          },
        },
        {
          text: "প্রজেক্ট শেষ (Completed) করলেই প্রত্যেক “Fabric”, “FOB” ও “CM (Factory)” সরবরাহকারীর সঙ্গে হিসাব মেলানো হয়: তাঁর মোট বিল ও পরিশোধ মিলিয়ে একটি হিসাব (settlement) রাখা হয়, প্রজেক্টের ব্যালান্স শূন্য হয়, পাশে “Settled” লেখা থাকে।",
        },
        {
          text: "যা বাকি ছিল তা সরবরাহকারীর মূল খাতায় (master ledger) থেকে যায়: “Balance zero since …” লাইনে লেখা থাকে কত টাকা তাঁর খাতায় গেছে। হিসাবের খাতায় নতুন কোনো এন্ট্রি হয় না, কারণ প্রতিটি বিল আগেই তাঁর খাতায় আছে; তাই কিছুই দুবার গোনা হয় না।",
        },
        {
          text: "শুধু “Accessories” সরবরাহকারী একটানা খাতায় চলেন: তাঁর পাশে “Accessories: on their running ledger, not settled by project.” লেখা থাকে, প্রজেক্ট শেষ হলেও তাঁর বাকি দেখাতেই থাকে।",
        },
      ],
      tips: [
        "শেষ হওয়া প্রজেক্টের বাকি টাকা পরেও সেই প্রজেক্টের নামে দেওয়া যায়: Accounts > “Supplier payments” > “Pay a supplier”-এ “Apply to a project (optional)”।",
        "কোনো ডেলিভারি পূর্বাবস্থায় ফেরালে (undo) প্রজেক্ট আবার চালু হয়, আগের হিসাব আর খাটে না; আবার শেষ করলে নতুন করে মেলানো হয়।",
        "সরবরাহকারীর সব প্রজেক্টের হিসাব একসঙ্গে দেখতে তাঁর প্রোফাইলের ৩৬০° অংশ দেখুন।",
        "এই সুবিধা চালুর আগে শেষ হওয়া প্রজেক্টও শেষ হওয়ার দিন থেকে “Settled” ধরা হয়, ব্যালান্স শূন্য দেখায়। সেগুলোর আলাদা হিসাব রাখা নেই, তাই তাঁর বিলে আজ যা বাকি, সেটাই তাঁর খাতায় থাকা টাকা হিসেবে দেখায়।",
      ],
    },
    {
      slug: "production-fob",
      title: "FOB প্রজেক্টে নিজের অ্যাক্সেসরিজ ও QC খরচ যোগ করবেন যেভাবে",
      summary:
        "FOB সরবরাহকারী তৈরি পণ্য দিলেও নিজের স্টোরের অ্যাক্সেসরিজ দেওয়া আর QC বা পরিদর্শনের খরচ যোগ করা, যাতে পণ্যের মোট খরচ (landed cost) ঠিক থাকে।",
      keywords: [
        "fob",
        "fob goods",
        "qc",
        "inspection",
        "landed cost",
        "issue accessories",
        "finished goods",
        "এফওবি",
        "কিউসি",
        "পরিদর্শন",
        "অ্যাক্সেসরিজ",
        "মোট খরচ",
      ],
      routes: ["/production/projects"],
      who: "Production Manager ও Super Admin (খরচ যোগ ও কাঁচামাল দেওয়া); এখনই পরিশোধ করতে Accounts।",
      anyOf: ["production.manage", "accounts.payments.record"],
      steps: [
        {
          text: "FOB সরবরাহকারীকে ফ্যাক্টরি হিসেবে রেখে প্রজেক্ট খুলুন। তাঁর বিল “FOB Goods” খাতে লিখুন (প্রজেক্টের “Add a cost” বা “Bills” ট্যাব থেকে)।",
        },
        {
          text: "নিজের স্টোর থেকে বোতাম, লেবেল, প্যাকেট ইত্যাদি দিলে প্রজেক্টের পাতায় “Issue materials” চাপুন। দেওয়া কাঁচামালের খরচ নিজে থেকে প্রজেক্টে যোগ হয়।",
        },
        {
          text: "QC বা পরিদর্শনের খরচ “Add a cost” দিয়ে “QC & Inspection” খাতে যোগ করুন, পরিদর্শকের নাম সরবরাহকারী হিসেবে দিন বা এখনই পরিশোধ করুন।",
          image: {
            id: "production-fob-1",
            caption: "“Add a cost” জানালায় “QC & Inspection” খাত বাছাই",
          },
        },
        {
          text: "তৈরি পণ্য এলে স্বাভাবিকভাবে ডেলিভারি স্টকে তুলুন। FOB-এর বিল, নিজের অ্যাক্সেসরিজ আর QC মিলিয়ে যে মোট খরচ, তা-ই পিসপ্রতি খরচ হয়ে স্টকে যায়।",
        },
      ],
      tips: [
        "“FOB Goods” ও “QC & Inspection” খাত সব কোম্পানিতে নিজে থেকেই আছে; নাম বদলাতে বা বন্ধ করতে “Cost heads” ট্যাব ব্যবহার করুন।",
      ],
    },
    {
      slug: "production-find-projects",
      title: "প্রজেক্ট খুঁজবেন ও দেরির প্রজেক্ট দেখবেন যেভাবে",
      summary: "কোড, নাম, ফ্যাক্টরি বা ক্রেতা দিয়ে প্রজেক্ট খোঁজা, আর অবস্থা ও ধাপ দিয়ে ছাঁকা।",
      keywords: [
        "projects",
        "search project",
        "late projects",
        "filter",
        "status",
        "stage",
        "প্রজেক্ট খোঁজা",
        "দেরির কাজ",
        "তালিকা",
      ],
      routes: ["/production/projects"],
      who: "যাঁরা Production দেখতে পারেন।",
      steps: [
        {
          text: "“Production” > “Projects” ট্যাব খুলুন। খোঁজার ঘরে প্রজেক্ট, ফ্যাক্টরি বা ক্রেতার নাম লিখুন।",
          image: {
            id: "production-find-projects-1",
            caption: "“Projects” ট্যাবে খোঁজার ঘর, “Status” ও “Stage” বাছাই",
          },
        },
        {
          text: "“Status” থেকে “Late” বেছে নিলে শুধু দেরির প্রজেক্ট দেখাবে। “Stage” থেকে ধাপ বেছে নিন।",
        },
        {
          text: "তালিকায় “For”, “Stage”, “Target day”, “Pieces in stock” আর অনুমতি থাকলে “Cost a piece” দেখবেন। “Clear filters” দিয়ে আবার সব দেখুন।",
        },
      ],
    },
    {
      slug: "production-cost-heads",
      title: "খরচের খাত (Cost heads) সাজাবেন যেভাবে",
      summary:
        "বিল ও খরচ কোন খাতে যাবে (যেমন Embroidery, Washing), সেই খাত যোগ, নাম বদল ও আর্কাইভ করা।",
      keywords: [
        "cost heads",
        "cost head",
        "add a cost head",
        "rename",
        "archive",
        "making cost",
        "material",
        "ledger account",
        "chart of accounts",
        "work in progress",
        "খরচের খাত",
        "খাত",
        "হেড",
        "লেজার",
        "হিসাবের খাতা",
      ],
      routes: ["/production/cost-heads"],
      who: "যাঁদের প্রজেক্ট সামলানোর অনুমতি আছে, যেমন Production Manager ও Super Admin।",
      anyOf: ["production.manage"],
      steps: [
        {
          text: "“Production” > “Cost heads” ট্যাব খুলুন। খাতগুলো “Making costs”, “Materials” ও “Other” ভাগে থাকে।",
        },
        {
          text: "“Add a cost head” চাপুন, “Name” (যেমন Embroidery) ও “Kind” (“Making cost” বা “Material”) দিয়ে “Add it” চাপুন।",
          image: {
            id: "production-cost-heads-1",
            caption: "“Add a cost head” জানালা: “Name” ও “Kind”",
          },
        },
        {
          text: "নাম বদলাতে খাতের পাশে “Rename” চাপুন। আর না লাগলে “Archive”, আবার লাগলে “Restore”।",
        },
        {
          text: "প্রতিটি ভাগের “Ledger account:” লাইনে দেখা যায় খাতগুলোর খরচ Chart of Accounts-এর কোন অ্যাকাউন্টে যায়: 1350 · Work in Progress (Production)। নিচের “In the accounts” অংশে পুরো পথ লেখা: বকেয়া খরচ সরবরাহকারীর হিসাবে (2100 · Accounts Payable), এখনই পরিশোধ বেছে নেওয়া ক্যাশ বা ব্যাংক থেকে, আর ফ্যাক্টরি মাল দিলে খরচ পিসের সঙ্গে 1300 · Finished Goods Inventory-তে যায়।",
          image: {
            id: "production-cost-heads-2",
            caption: "“In the accounts” অংশ: খরচ কোন অ্যাকাউন্টে ওঠে",
          },
        },
      ],
      tips: [
        "নাম বদলালে আগের খরচগুলোও নতুন নামেই দেখাবে।",
        "প্রতিটি খরচ একবারই হিসাবে ওঠে: খাতের জন্য আলাদা জাবেদা লিখতে হয় না। Accounts-এর লোকেরা অ্যাকাউন্টের নাম চাপলে তার লেজার খোলে।",
      ],
    },
  ],
};
