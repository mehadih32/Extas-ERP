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
      title: "মাস্টার ব্যাচের কাপড় ও অ্যাক্সেসরিজ এক সাথে অর্ডার করবেন যেভাবে",
      summary:
        "ব্যাচের সব স্টাইলের কাঁচামাল যোগ হয়ে সরবরাহকারী অনুযায়ী ভাগ হয়; এক চাপে প্রতিটি সরবরাহকারীর জন্য একটি করে পারচেজ অর্ডার, দাম না জানলে মাল আসার সময় দেওয়া যায়, আর প্রিন্টে থাকে স্টাইল অনুযায়ী ভাগ ও কলার-কাফের ছক।",
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
        "আগে অর্ডার করা পরিমাণ বাদ দিয়েই “to order” দেখায়; বাতিল অর্ডার গোনা হয় না, আর আগে বন্ধ করা অর্ডারে যতটুকু এসেছে ততটুকুই গোনা হয়।",
        "অর্ডারের দাম শুধু যাঁরা কাঁচামালের দাম দেখতে পারেন তাঁরাই দেখেন; প্রিন্টেও তাই।",
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
