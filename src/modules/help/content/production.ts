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
        "কয়টি প্রজেক্ট চলছে, কোনগুলো দেরিতে, কোন ধাপে কয়টি আছে আর খোলা প্রজেক্টে কত টাকা আটকে আছে তা এক নজরে দেখা।",
      keywords: [
        "production overview",
        "late",
        "due this week",
        "on hold",
        "open projects",
        "at each stage",
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
          text: "“At each stage” অংশে দেখবেন কোন ধাপে (কাপড় সংগ্রহ, কাটিং, সেলাই, ওয়াশ ও QC, ফিনিশিং) কয়টি প্রজেক্ট আছে। খরচ দেখার অনুমতি থাকলে “Money in open projects”-এ খোলা প্রজেক্টের মোট খরচ দেখাবে।",
        },
        {
          text: "“Open projects” অংশে প্রতিটি প্রজেক্টের কার্ড থাকে, দেরির প্রজেক্ট আগে। কার্ডে ফ্যাক্টরি, ধাপ, লক্ষ্যের তুলনায় কত দিন গেছে, আর বানানোর পিসের তুলনায় কত পিস স্টকে এসেছে লেখা থাকে।",
          image: {
            id: "production-overview-2",
            caption: "প্রজেক্টের কার্ড: সময়ের দাগ (হলুদ বা লাল) ও স্টকে আসা পিস",
          },
        },
        { text: "যেকোনো কার্ডে চাপলে সেই প্রজেক্টের পাতা খুলবে।" },
      ],
      tips: [
        "সময় শেষ হতে কাছাকাছি হলে দাগ হলুদ হয়, আর দেরি হলে লাল রং ও লাল কিনারা দেখায়।",
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
          text: "এখনই কাজ শুরু হলে “In production now”, পরে শুরু হলে “Planned for later” বেছে নিন। তারপর “Create the project” চাপুন।",
        },
      ],
      tips: [
        "প্রজেক্টের কোড নিজে থেকে দেওয়া হয়।",
        "পরে কিছু বদলাতে প্রজেক্টের পাতায় “Edit” চাপুন।",
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
        "ফ্যাক্টরির ডেলিভারির পিস রং ও সাইজ অনুযায়ী A-grade ও B-grade আলাদা করে গুনে গুদামে তোলা।",
      keywords: [
        "receive goods",
        "factory delivery",
        "delivery",
        "intake",
        "a-grade",
        "b-grade",
        "packing list",
        "stock in",
        "মাল গ্রহণ",
        "ডেলিভারি",
        "স্টকে তোলা",
        "বি গ্রেড",
        "মাল এসেছে",
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
          text: "“Pieces received” অংশে স্টাইল বেছে নিন। রং × সাইজের ছকে প্রতিটি ঘরে কত পিস এসেছে লিখুন, “A-grade” ও “B-grade” আলাদা করে। একই ডেলিভারিতে আরেকটি স্টাইল থাকলে “Add a style” চাপুন।",
          image: {
            id: "production-receive-goods-2",
            caption: "রং × সাইজের ছকে A-grade ও B-grade পিসের ঘর",
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
      ],
      tips: [
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
        "খরচ",
        "খরচ যোগ",
        "পিসপ্রতি খরচ",
        "মজুরি",
        "কস্টিং",
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
          text: "অনুমতি থাকলে “How it is paid”-এ “Due to the supplier” বা “Paid now” বেছে নিন। Production Manager-এর বিল সবসময় বকেয়া হিসেবে যায়, Accounts পরে দেন।",
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
          text: "পরে টাকা দিতে বিলের পাতায় “Pay the supplier” চাপুন। “Paid by”, “Reference (optional)”, “Paid on” দিয়ে “Record the payment” চাপুন। ভুল বিল “Void the bill” দিয়ে বাতিল করুন।",
        },
      ],
      tips: [
        "খাত (cost head) না থাকলে আগে “Cost heads” ট্যাবে যোগ করুন।",
        "একজন সরবরাহকারীর সব বিল একসঙ্গে পরিশোধ করতে Accounts-এর “Supplier payments” ব্যবহার করুন।",
      ],
    },
    {
      slug: "production-complete-cancel",
      title: "প্রজেক্ট শেষ বা বাতিল করবেন যেভাবে",
      summary:
        "সব মাল আসার পর প্রজেক্ট শেষ করা, অথবা কাজ বন্ধ হলে বাতিল করা, আর বাকি খরচের কী হবে তা ঠিক করা।",
      keywords: [
        "complete the project",
        "cancel the project",
        "close project",
        "finish",
        "write off",
        "প্রজেক্ট শেষ",
        "প্রজেক্ট বাতিল",
        "সমাপ্ত",
        "বন্ধ",
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
          text: "কাজ বন্ধ হয়ে গেলে “Cancel the project” চাপুন এবং একইভাবে কারণ লিখে নিশ্চিত করুন।",
        },
      ],
      tips: [
        "কোনো ডেলিভারি খসড়া অবস্থায় থাকলে আগে সেটি স্টকে তুলুন বা বাতিল করুন, তারপর প্রজেক্ট শেষ করুন।",
        "যে প্রজেক্ট এখনো শুরুই হয়নি (Planned), সেটি শেষ করা যায় না; শুরু করুন বা বাতিল করুন।",
        "শেষ বা বাতিল হওয়া প্রজেক্ট “Projects” তালিকায় “Status” দিয়ে খুঁজে পাবেন।",
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
        "খরচের খাত",
        "খাত",
        "হেড",
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
      ],
      tips: ["নাম বদলালে আগের খরচগুলোও নতুন নামেই দেখাবে।"],
    },
  ],
};
