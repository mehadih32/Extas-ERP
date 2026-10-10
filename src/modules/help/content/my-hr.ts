import type { HelpSection } from "../types";

/** My HR: an employee's own check-in, tasks, attendance, leave, payslips and advances. */
export const myHrHelp: HelpSection = {
  id: "my-hr",
  title: "আমার এইচআর (My HR)",
  description:
    "প্রতিটি কর্মীর নিজের পাতা: চেক-ইন ও চেক-আউট, নিজের কাজ, হাজিরা, ছুটির আবেদন, পে-স্লিপ আর অগ্রিমের হিসাব।",
  href: "/me",
  articles: [
    {
      slug: "my-hr-check-in",
      title: "ফোন থেকে চেক-ইন ও চেক-আউট করবেন যেভাবে",
      summary: "অফিসে এসে ও যাওয়ার সময় নিজের হাজিরা নিজে দেওয়া, আর এ মাসের হিসাব দেখা।",
      keywords: [
        "check in",
        "check out",
        "attendance",
        "today",
        "my hr",
        "চেক ইন",
        "চেক আউট",
        "হাজিরা দেওয়া",
        "অফিসে আসা",
        "আমার হাজিরা",
      ],
      routes: ["/me", "/me/attendance"],
      who: "যাঁদের My HR login আছে, যদি HR নিজে চেক-ইনের নিয়ম চালু করে থাকেন।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "মেনু থেকে “My HR” খুলুন (HR & payroll দেখতে পারেন এমন কেউ হলে অ্যাকাউন্ট মেনু থেকে “My HR”)। “Today” ট্যাব খুলবে।",
          image: {
            id: "my-hr-check-in-1",
            caption: "My HR-এর “Today” ট্যাবে “Check in” বোতাম",
          },
        },
        { text: "অফিসে পৌঁছে “Check in” চাপুন। যাওয়ার সময় একই জায়গায় “Check out” চাপুন।" },
        {
          text: "নিচে এ মাসের কাজের দিন, উপস্থিত, দেরি, অনুপস্থিত, ছুটি ও ওভারটাইম দেখবেন। প্রতিদিনের হিসাব দেখতে “Day by day” বা “Attendance” ট্যাব।",
        },
      ],
      tips: [
        "“HR marks your attendance” লেখা থাকলে আপনার হাজিরা HR দেন, নিজে চেক-ইন করতে হবে না।",
        "কোনো দিনের হিসাব ভুল হলে HR-কে বলুন, তাঁরা ঠিক করে দেবেন।",
      ],
    },
    {
      slug: "my-hr-tasks",
      title: "আমাকে দেওয়া কাজ (Tasks) দেখবেন ও শেষ করবেন যেভাবে",
      summary: "ম্যানেজারের দেওয়া কাজ দেখা, শুরু করা, শেষ হলে জানানো বা আবার খোলা।",
      keywords: [
        "my tasks",
        "tasks",
        "start",
        "mark as done",
        "reopen",
        "to do",
        "কাজ",
        "আমার কাজ",
        "টাস্ক",
        "কাজ শেষ",
      ],
      routes: ["/me/tasks"],
      who: "যাঁদের My HR login আছে।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “Tasks” ট্যাব খুলুন। যে কাজ আগে শেষ করতে হবে সেটি উপরে থাকে।",
          image: {
            id: "my-hr-tasks-1",
            caption: "“Tasks” ট্যাবে কাজের কার্ড: শিরোনাম, শেষ তারিখ ও বোতাম",
          },
        },
        { text: "“Which tasks” দিয়ে বাকি কাজ বা সব কাজ বেছে নিন।" },
        {
          text: "কাজ শুরু করলে “Start”, শেষ হলে “Mark as done” চাপুন। ভুলে শেষ চাপলে “Reopen”।",
        },
      ],
      tips: ["আপনি কাজের অবস্থা বদলালে যিনি কাজ দিয়েছেন তিনি ইনবক্সে জানতে পারেন।"],
    },
    {
      slug: "my-hr-leave",
      title: "নিজের ছুটির আবেদন করবেন যেভাবে",
      summary:
        "কত ছুটি বাকি দেখা, কাগজসহ ছুটির আবেদন পাঠানো, আর HR সিদ্ধান্ত নেওয়ার আগে আবেদন ফিরিয়ে নেওয়া।",
      keywords: [
        "ask for leave",
        "leave request",
        "my leave",
        "withdraw",
        "leave left",
        "ছুটির আবেদন",
        "ছুটি চাই",
        "বাকি ছুটি",
        "অসুস্থ",
        "ছুটি নেওয়া",
      ],
      routes: ["/me/leave"],
      who: "যাঁদের My HR login আছে।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “Leave” ট্যাব খুলুন। “Left this year”-এ প্রতিটি ধরনের কত ছুটি বাকি দেখবেন।",
        },
        {
          text: "“Ask for leave” চাপুন। “Leave type”, “First day” ও “Last day” দিন। অর্ধদিবস হলে “Half a day only” টিক দিন।",
          image: {
            id: "my-hr-leave-1",
            caption: "“Ask for leave” জানালা: ছুটির ধরন, তারিখ, কারণ ও কাগজ",
          },
        },
        {
          text: "“Reason (optional)” লিখুন এবং দরকার হলে “Doctor's note or other paper (optional)”-এ কাগজের ছবি দিন। “Send the request” চাপুন।",
        },
        {
          text: "“Requests”-এ আবেদনের অবস্থা দেখবেন। HR সিদ্ধান্ত নেওয়ার আগে মত বদলালে “Withdraw” চাপুন।",
        },
      ],
      tips: ["আবেদনের মধ্যে পড়া সাপ্তাহিক ও সরকারি ছুটি গোনা হয় না।"],
    },
    {
      slug: "my-hr-payslips",
      title: "নিজের পে-স্লিপ দেখবেন ও ছাপবেন যেভাবে",
      summary: "প্রতিটি অনুমোদিত মাসের পে-স্লিপ দেখা, বেতন দেওয়া হয়েছে কি না জানা, আর PDF ছাপা।",
      keywords: [
        "my payslips",
        "payslip",
        "salary slip",
        "take home",
        "pdf",
        "পে-স্লিপ",
        "আমার বেতন",
        "বেতনের কাগজ",
        "স্যালারি",
      ],
      routes: ["/me/payslips"],
      who: "যাঁদের My HR login আছে, শুধু নিজের পে-স্লিপ।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “Payslips” ট্যাব খুলুন। প্রতিটি মাসের “Take home” ও “Paid” বা “To be paid” দেখবেন।",
          image: {
            id: "my-hr-payslips-1",
            caption: "“Payslips” ট্যাবে মাসের তালিকা",
          },
        },
        { text: "মাসে চাপলে পে-স্লিপ খুলবে।" },
        {
          text: "লেটারহেডে ছাপতে “PDF” চাপুন, ব্রাউজার দিয়ে ছাপতে “Print the payslip”।",
        },
      ],
      tips: ["মাসের বেতন অনুমোদন হওয়ার পরেই পে-স্লিপ দেখা যায়।"],
    },
    {
      slug: "my-hr-advances",
      title: "নিজের অগ্রিমের হিসাব দেখবেন যেভাবে",
      summary: "বেতনের আগে নেওয়া টাকা কত বাকি আছে এবং কীভাবে বেতন থেকে কাটা হচ্ছে তা দেখা।",
      keywords: [
        "my advances",
        "advance",
        "still owed",
        "salary advance",
        "অগ্রিম",
        "আমার অগ্রিম",
        "কত বাকি",
        "কাটা",
      ],
      routes: ["/me/advances"],
      who: "যাঁদের My HR login আছে।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “Advances” ট্যাব খুলুন। প্রতিটি অগ্রিমের “Still owed” (কত বাকি) দেখবেন।",
        },
        {
          text: "প্রতি মাসে বেতন থেকে কত কাটা হয়েছে তা “Paid back” তালিকায় থাকে।",
        },
      ],
      tips: ["অগ্রিম নিতে HR বা Accounts-এর সঙ্গে কথা বলুন।"],
    },
    {
      slug: "my-hr-details",
      title: "নিজের তথ্য ও বেতনের সারাংশ দেখবেন যেভাবে",
      summary: "নিজের কোড, পদ, যোগদানের দিন, যোগাযোগ, বেতন ও বেতন কীভাবে দেওয়া হয় তা দেখা।",
      keywords: [
        "my details",
        "profile",
        "employee code",
        "monthly salary",
        "আমার তথ্য",
        "প্রোফাইল",
        "কর্মী কোড",
        "বেতন",
      ],
      routes: ["/me"],
      who: "যাঁদের My HR login আছে।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “Today” ট্যাবের নিচে “Pay” অংশে মাসিক বেতন ও “Paid by”, আর “My details”-এ নাম, কোড, পদ, যোগদানের দিন ও যোগাযোগ দেখবেন।",
          image: {
            id: "my-hr-details-1",
            caption: "“Today” ট্যাবের “Pay” ও “My details” অংশ",
          },
        },
        { text: "কোনো তথ্য ভুল থাকলে HR-কে বলুন। নিজে বদলানো যায় না।" },
      ],
    },
  ],
};
