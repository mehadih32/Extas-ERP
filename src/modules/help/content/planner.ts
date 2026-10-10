import type { HelpSection } from "../types";

/** The Planner: what is coming up, the notepad, tasks for staff, reminders and automatic reminders. */
export const plannerHelp: HelpSection = {
  id: "planner",
  title: "পরিকল্পনা (Planner)",
  description:
    "সামনে কী আছে, নিজের নোটপ্যাড ও কাজের পরিকল্পনা, কর্মীদের কাজ দেওয়া, রিমাইন্ডার আর অ্যাপের নিজে থেকে পাঠানো রিমাইন্ডারের নিয়ম।",
  href: "/planner",
  articles: [
    {
      slug: "planner-coming-up",
      title: "সামনে কী আছে (Coming up) দেখবেন যেভাবে",
      summary:
        "আগামী ৭, ১৪ বা ৩০ দিনের উৎপাদনের শেষ তারিখ, মাল আসা, শিপমেন্ট, লাইসেন্স নবায়ন, কাজ ও রিমাইন্ডার, আর যা দেরি হয়ে গেছে।",
      keywords: [
        "coming up",
        "agenda",
        "overdue",
        "deadline",
        "calendar",
        "this week",
        "সামনে কী",
        "এজেন্ডা",
        "শেষ তারিখ",
        "দেরি",
        "ক্যালেন্ডার",
      ],
      routes: ["/planner"],
      who: "যাঁদের Planner খোলা: সবাই যাঁদের নোটপ্যাডের অনুমতি আছে। প্রত্যেকে নিজের ভূমিকায় খোলা জিনিসই দেখেন।",
      steps: [
        {
          text: "মেনু থেকে “Planner” খুলুন। “Coming up” ট্যাবে প্রথমে দেরি হয়ে যাওয়া জিনিস, তারপর দিন অনুযায়ী সামনের সব কিছু।",
          image: {
            id: "planner-coming-up-1",
            caption: "“Coming up” ট্যাব: দেরির তালিকা ও দিনভিত্তিক তালিকা",
          },
        },
        {
          text: "“How far ahead”-এ ৭, ১৪ বা ৩০ দিন বেছে নিন।",
        },
        {
          text: "যেকোনো সারিতে চাপলে তার রেকর্ড খুলবে, যেমন প্রোডাকশন প্রজেক্ট, পারচেজ অর্ডার, লাইসেন্স বা কাজ।",
        },
      ],
      tips: ["ম্যানেজাররা সবার কাজ দেখেন, অন্যরা শুধু নিজের কাজ ও রিমাইন্ডার।"],
    },
    {
      slug: "planner-notepad",
      title: "নিজের নোটপ্যাড ও তিন দিনের কাজের পরিকল্পনা লিখবেন যেভাবে",
      summary:
        "প্রতিদিনের রুটিন (সকালে টিক মুছে যায়), আজ ও পরের দুই দিনের কাজের তালিকা আর সাধারণ নোট, যা শুধু আপনি দেখেন।",
      keywords: [
        "notepad",
        "daily routine",
        "next 3 days",
        "work plan",
        "general notes",
        "to do",
        "pin",
        "নোটপ্যাড",
        "নোট",
        "দৈনিক রুটিন",
        "কাজের তালিকা",
        "পরিকল্পনা",
      ],
      routes: ["/planner/notepad"],
      who: "যাঁদের নোটপ্যাডের অনুমতি আছে (সাধারণত সবাই)। অন্য কেউ আপনার নোট দেখতে পান না।",
      anyOf: ["notepad.use"],
      steps: [
        {
          text: "“Planner” > “Notepad” ট্যাব খুলুন। তিনটি পাতা: “Daily routine”, “Next 3 days” ও “General notes”।",
          image: {
            id: "planner-notepad-1",
            caption: "“Notepad” ট্যাব: তিনটি পাতা ও লেখার ঘর",
          },
        },
        {
          text: "“Daily routine”-এ প্রতিদিনের কাজ লিখুন (যেমন সকালে স্টক দেখা)। কাজ হলে টিক দিন। পরদিন সকালে টিক নিজে থেকে মুছে যায়।",
        },
        {
          text: "“Next 3 days”-এ কাজ লিখে দিন বেছে নিন (আজ, কাল বা পরশু)। শেষ না হওয়া কাজ পরের দিনে চলে যায় (“Carried over”)।",
        },
        {
          text: "“General notes”-এ “Write a note” দিয়ে নোট লিখুন। জরুরি নোট “Pin to the top” করুন। খোঁজার ঘরে নোট খুঁজুন।",
        },
        {
          text: "প্রতিটি জিনিসের মেনুতে “Change”, “Move up”, “Move down” ও “Delete” পাবেন।",
        },
      ],
    },
    {
      slug: "planner-tasks",
      title: "কর্মীদের কাজ (Task) দেবেন ও খোঁজ রাখবেন যেভাবে",
      summary:
        "কর্মীকে শেষ তারিখ, অগ্রাধিকার ও প্রজেক্টসহ কাজ দেওয়া, তার অবস্থা দেখা, আর বদলানো, বাতিল বা মোছা।",
      keywords: [
        "task",
        "give a task",
        "assign",
        "due day",
        "priority",
        "staff work",
        "কাজ দেওয়া",
        "টাস্ক",
        "দায়িত্ব",
        "অগ্রাধিকার",
        "কাজের খোঁজ",
      ],
      routes: ["/planner/tasks"],
      who: "যাঁদের রিমাইন্ডার সামলানোর অনুমতি আছে: Super Admin, Production Manager ও Sales Executive।",
      anyOf: ["reminders.manage"],
      steps: [
        {
          text: "“Planner” > “Tasks” ট্যাবে “Give a task” চাপুন।",
          image: {
            id: "planner-tasks-1",
            caption: "“Give a task” ফর্ম: কাজ, কাকে, শেষ তারিখ, অগ্রাধিকার ও প্রজেক্ট",
          },
        },
        {
          text: "“What needs doing” (যেমন Factory visit at Gazipur), “Given to (optional)” (কর্মী), “Due day (optional)”, “Time (optional)” ও “Priority” দিন।",
        },
        {
          text: "কোনো প্রোডাকশন প্রজেক্টের কাজ হলে “Production project (optional)” বেছে নিন। “Details (optional)” লিখে “Give the task” চাপুন।",
        },
        {
          text: "তালিকায় খোঁজা যায় এবং খোলা, দেরির, শেষ, বাতিল, একজন কর্মীর বা “Only tasks I gave” দিয়ে ছাঁকা যায়।",
        },
        {
          text: "কাজের পাতায় “Start”, “Mark as done”, “Reopen”, “Change”, “Cancel the task” ও “Delete” পাবেন। নিচে কাজটি নিয়ে পাঠানো রিমাইন্ডার থাকে।",
        },
      ],
      tips: [
        "কর্মী নিজের কাজ My HR-এর “Tasks” ট্যাবে দেখেন।",
        "যে কর্মীর অ্যাপে login নেই, তাঁকে WhatsApp চালু হলে জানানো হবে; এখনো তা চালু হয়নি।",
        "কাজ মুছলে তার রিমাইন্ডারও মুছে যায়। রেকর্ড রাখতে চাইলে বাতিল করুন।",
      ],
    },
    {
      slug: "planner-reminders",
      title: "রিমাইন্ডার সেট করবেন যেভাবে",
      summary:
        "নির্দিষ্ট দিন ও সময়ে নিজেকে বা অন্যদের মনে করিয়ে দেওয়া, দরকারে নিয়মিত পুনরাবৃত্তি, আর কাজ হলে “Dealt with” করা।",
      keywords: [
        "reminder",
        "add a reminder",
        "repeat",
        "dealt with",
        "alarm",
        "follow up",
        "রিমাইন্ডার",
        "মনে করানো",
        "স্মরণ",
        "অ্যালার্ম",
        "ফলো আপ",
      ],
      routes: ["/planner/reminders"],
      who: "সবাই নিজের জন্য রিমাইন্ডার দিতে পারেন। অন্যদের জন্য দিতে রিমাইন্ডার সামলানোর অনুমতি লাগে (Super Admin, Production Manager, Sales Executive)।",
      anyOf: ["notepad.use", "reminders.manage"],
      steps: [
        {
          text: "“Planner” > “Reminders” ট্যাবে “Add a reminder” চাপুন।",
          image: {
            id: "planner-reminders-1",
            caption: "“Add a reminder” ফর্ম: কী, দিন, সময়, পুনরাবৃত্তি ও কারা শুনবেন",
          },
        },
        {
          text: "“Remind about”-এ লিখুন কী মনে করাতে হবে (যেমন Call Rahim Traders about the advance), চাইলে “Note (optional)”।",
        },
        {
          text: "“Day” ও “Time” দিন। নিয়মিত হলে “Repeats”-এ “Every day”, “Every week” ইত্যাদি বেছে নিন এবং দরকারে “Last day (optional)” দিন।",
        },
        {
          text: "অনুমতি থাকলে “Who hears about it”-এ অন্যদের নাম যোগ করুন। “Add the reminder” চাপুন।",
        },
        {
          text: "সময় হলে রিমাইন্ডার ইনবক্সে আসে। কাজ সেরে রিমাইন্ডারের পাতায় বা ইনবক্সে “Dealt with” চাপুন।",
        },
      ],
      tips: [
        "যিনি সেট করেছেন, তিনি পাঠানোর আগ পর্যন্ত “Change”, “Cancel the reminder” বা “Delete” করতে পারেন।",
        "রিমাইন্ডার এখন শুধু অ্যাপে যায়। WhatsApp ও ইমেইল পরে আসবে।",
      ],
    },
    {
      slug: "planner-automatic",
      title: "অ্যাপের নিজে থেকে পাঠানো রিমাইন্ডার (Automatic reminders) ঠিক করবেন যেভাবে",
      summary:
        "উৎপাদনের শেষ তারিখ, মাল আসা, শিপমেন্ট, লাইসেন্স নবায়ন ও কাজের তারিখ নিয়ে কত দিন আগে, কখন ও কাকে মনে করানো হবে।",
      keywords: [
        "automatic reminders",
        "alerts",
        "days before",
        "notification settings",
        "deadline alert",
        "স্বয়ংক্রিয় রিমাইন্ডার",
        "অটো রিমাইন্ডার",
        "সতর্কতা",
        "কত দিন আগে",
      ],
      routes: ["/planner/automatic"],
      who: "দেখতে পারেন ম্যানেজাররা (Production Manager, Sales Executive)। বদলাতে কোম্পানির সেটিংসের অনুমতি লাগে (Super Admin)।",
      anyOf: ["reminders.manage", "company.settings"],
      steps: [
        {
          text: "“Planner” > “Automatic reminders” ট্যাব খুলুন। প্রতিটি বিষয়ের পাশে কখন ও কারা শুনবেন লেখা থাকে।",
          image: {
            id: "planner-automatic-1",
            caption: "“Automatic reminders” ট্যাবে বিষয় অনুযায়ী নিয়মের তালিকা",
          },
        },
        {
          text: "বদলাতে “Change” চাপুন। “Send these reminders” টিক দিয়ে চালু বা বন্ধ করুন।",
        },
        {
          text: "“Days before the date” (কত দিন আগে), “Once passed, again every (days)” (দেরি হলে কত দিন পরপর আবার), “Time they go out” (কখন) ও “Also tell (optional)” (আর কাকে) দিন। “Save” চাপুন।",
        },
      ],
      tips: ["প্রতিটি লাইসেন্সের প্রথম সতর্কতা লাইসেন্সের নিজের রেকর্ডে ঠিক করা হয়।"],
    },
  ],
};
