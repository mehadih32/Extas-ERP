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
          text: "HR লোকেশনসহ হাজিরা চালু করলে “Check in” চাপার পর ফোন লোকেশন খোঁজে (“Finding your location”)। প্রথমবার ফোন অনুমতি চাইলে “Allow” দিন। চেক-ইনের পর দেখাবে কোথা থেকে করলেন, যেমন Checked in at 09:02 at Head office।",
          image: {
            id: "my-hr-check-in-2",
            caption: "লোকেশনসহ চেক-ইন: “Finding your location” ও চেক-ইনের জায়গা",
          },
        },
        {
          text: "চেক-ইনের পর চেক-আউট পর্যন্ত আপনার লোকেশন HR দেখতে পান। এর মধ্যে ফোনের লোকেশন বন্ধ করলে অ্যাপ আটকে যায় (“Turn on your location”)। লোকেশন চালু করে “Try again” চাপুন, অথবা কাজ শেষ হলে “Check out now”।",
          image: {
            id: "my-hr-check-in-3",
            caption: "লোকেশন বন্ধ থাকলে “Turn on your location” পাতা",
          },
        },
        {
          text: "রাতের শিফটে গতকাল চেক-ইন করে থাকলে আজ “You are still checked in from yesterday” লেখা দেখবেন। আগে “Check out” চাপুন, তারপর দরকার হলে “Check in for today”।",
        },
        {
          text: "নিচে এ মাসের কাজের দিন, উপস্থিত, দেরি, অনুপস্থিত, ছুটি ও ওভারটাইম দেখবেন। প্রতিদিনের হিসাব দেখতে “Day by day” বা “Attendance” ট্যাব।",
        },
      ],
      tips: [
        "“HR marks your attendance” লেখা থাকলে আপনার হাজিরা HR দেন, নিজে চেক-ইন করতে হবে না।",
        "কাজের জায়গা থেকে দূরে চেক-ইন করলে হাজিরা হয়, কিন্তু HR “Location mismatch” দেখেন।",
        "মাঠে ঘুরে কাজ করলে Extas ERP-এর Android অ্যাপ ব্যবহার করুন: ফোন পকেটে রাখলেও লোকেশন যায়।",
        "কোনো দিনের হিসাব ভুল হলে HR-কে বলুন, তাঁরা ঠিক করে দেবেন।",
      ],
    },
    {
      slug: "my-hr-dashboard",
      title: "আমার সময়, পারফরম্যান্স স্কোর ও নোটিশ দেখবেন যেভাবে (My HR ড্যাশবোর্ড)",
      summary:
        "My HR-এর “Today” পাতায় দেখবেন কোম্পানিতে কত দিন হলো (চলমান ঘড়ি), গত ৩০ দিনের ০ থেকে ১০ পারফরম্যান্স স্কোর আর কেন নম্বর কমেছে, এবং HR-এর নতুন নোটিশ।",
      keywords: [
        "dashboard",
        "performance score",
        "score",
        "tenure",
        "anniversary",
        "notice board",
        "ড্যাশবোর্ড",
        "স্কোর",
        "পারফরম্যান্স",
        "চাকরির সময়",
        "নম্বর কেন কমল",
      ],
      routes: ["/me"],
      who: "যাঁদের My HR login আছে। স্কোর শুধু আপনি আর HR দেখেন।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” খুলুন। “My time here” অংশে (ফোনে “Today”-র ঠিক নিচে) দেখবেন কোম্পানিতে কত বছর, মাস ও দিন হলো, আর ঘড়িটি সেকেন্ডে সেকেন্ডে চলে। নিচে যোগদানের দিন ও পরের বর্ষপূর্তির দিন লেখা থাকে।",
          image: {
            id: "my-hr-dashboard-1",
            caption: "My HR-এর “My time here” ঘড়ি ও “My score” বৃত্ত",
          },
        },
        {
          text: "“My score” বৃত্তে গত ৩০ দিনের নম্বর (১০-এর মধ্যে)। ৮ বা বেশি হলে সবুজ (“Doing well”), ৫ থেকে ৭.৯ হলুদ (“Room to grow”), ৫-এর নিচে লাল (“Needs attention”)। কেউ হাতে নম্বর দেয় না; অ্যাপ নিচের নিয়মে হিসাব করে।",
        },
        {
          text: "নম্বরের তিন অংশ: “Attendance” (অর্ধেক নম্বর; সময়মতো এলে পুরো, দেরি বা অর্ধদিবসে অর্ধেক, অনুপস্থিতিতে শূন্য), “Tasks on time” (৩০%; শেষ তারিখের মধ্যে কাজ শেষ করলে পুরো, দেরিতে অর্ধেক, তারিখ পেরিয়ে খোলা থাকলে শূন্য) আর “Clean claims” (২০%; দাবি যেমন চেয়েছেন তেমন অনুমোদন হলে পুরো, কমে অনুমোদন হলে অর্ধেক, বাতিল হলে শূন্য)।",
        },
        {
          text: "কোন দিন, কোন কাজ বা কোন দাবিতে কত নম্বর কাটা গেছে দেখতে “What lost points” চাপুন। যেমন Late on 9 Oct 2026 পাশে −0.23।",
          image: {
            id: "my-hr-dashboard-2",
            caption: "“What lost points” খোলা: দেরির দিন, দেরিতে শেষ কাজ ও কমে অনুমোদিত দাবি",
          },
        },
        {
          text: "“Notice board”-এ (কম্পিউটারে ডান পাশে) HR-এর সর্বশেষ নোটিশ, নতুনগুলোতে “New” লেখা। সব নোটিশ পড়তে “All notices” (বা নতুন থাকলে “… new”) চাপুন।",
        },
      ],
      tips: [
        "অনুমোদিত ছুটি, সরকারি ছুটি ও সাপ্তাহিক ছুটির দিন কখনো গোনা হয় না। যে অংশে গোনার কিছু নেই (যেমন কোনো দাবি করেননি), সেটি বাদ যায় আর বাকি অংশগুলো তার নম্বর ভাগ করে নেয়।",
        "কোনো দিনের হাজিরা ভুল থাকলে HR-কে বলুন; ঠিক করলে স্কোরও সঙ্গে সঙ্গে বদলায়।",
      ],
    },
    {
      slug: "my-hr-phone-app",
      title: "ফোনে Extas ERP অ্যাপ বসাবেন যেভাবে (Android অ্যাপ ও হোম স্ক্রিন)",
      summary:
        "Android অ্যাপ ইনস্টল করা, যাতে চেক-ইনের পর স্ক্রিন বন্ধ থাকলেও লোকেশন যায়, অথবা ব্রাউজার থেকে হোম স্ক্রিনে যোগ করা।",
      keywords: [
        "android app",
        "install",
        "apk",
        "home screen",
        "background location",
        "sharing your location",
        "অ্যাপ",
        "অ্যাপ ইনস্টল",
        "হোম স্ক্রিন",
        "লোকেশন শেয়ার",
      ],
      routes: ["/me"],
      who: "যাঁদের My HR login আছে। মাঠকর্মীদের জন্য Android অ্যাপ দরকার, যদি HR লোকেশনসহ হাজিরা চালু করে থাকেন।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "HR থেকে Extas ERP-এর APK ফাইলটি (WhatsApp বা লিংকে) নিন ও ফোনে খুলুন। ফোন “অজানা উৎস” থেকে ইনস্টলের অনুমতি চাইলে দিন, তারপর ইনস্টল করুন।",
        },
        {
          text: "অ্যাপ খুলে নিজের ইমেইল ও পাসওয়ার্ড দিয়ে ঢুকুন। এটি একই Extas ERP, শুধু ফোনের অ্যাপ হিসেবে।",
        },
        {
          text: "My HR-এ “Check in” চাপুন। ফোন লোকেশনের অনুমতি চাইলে “অ্যাপ ব্যবহারের সময়” বা “Allow” দিন, নোটিফিকেশনের অনুমতিও দিন। ব্যাটারি বাঁচানোর জন্য বন্ধ না করার অনুমতি চাইলে “Allow” দিন।",
          image: {
            id: "my-hr-phone-app-1",
            caption: "চেক-ইনের পর নোটিফিকেশন বারে লোকেশন শেয়ারের নোটিশ",
          },
        },
        {
          text: "চেক-ইনের পর নোটিফিকেশন বারে Sharing your location লেখা থাকবে। এখন ফোন পকেটে রাখতে, স্ক্রিন বন্ধ করতে বা অ্যাপ বন্ধ করতে পারেন; চেক-আউট না করা পর্যন্ত লোকেশন যাবে। নেটওয়ার্ক না থাকলে ফোন লোকেশন জমিয়ে রাখে, নেটওয়ার্ক এলে পাঠায়।",
        },
        {
          text: "দিন শেষে অ্যাপ খুলে “Check out” চাপুন। লোকেশন পাঠানো নিজে থেকে বন্ধ হবে, নোটিফিকেশনও চলে যাবে।",
        },
        {
          text: "অ্যাপ ছাড়া ব্রাউজারেও চলে: Android-এ Chrome-এ “Install” চাপুন, iPhone-এ Share বোতাম চেপে “Add to Home Screen”। তবে ব্রাউজারে শুধু পাতা খোলা থাকলেই লোকেশন যায়।",
          image: {
            id: "my-hr-phone-app-2",
            caption: "“Install Extas ERP” প্রস্তাব, “Install” ও “Not now”",
          },
        },
      ],
      tips: [
        "নোটিফিকেশনে Turn on your location এলে ফোনের লোকেশন চালু করুন; আপনি এখনও চেক-ইন অবস্থায় আছেন।",
        "নোটিফিকেশনে Location sharing stopped এলে অ্যাপ খুলে আবার সাইন ইন করুন।",
        "কিছু ফোন (যেমন Xiaomi, Oppo, Vivo) ব্যাটারি বাঁচাতে অ্যাপ বন্ধ করে দেয়। ফোনের সেটিংসে Extas ERP-এর ব্যাটারি No restrictions (বা Unrestricted) করে দিন।",
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
        {
          text: "নতুন কাজে “New” লেখা থাকে। পাতাটি খুললেই যিনি কাজ দিয়েছেন তিনি দেখেন আপনি কাজটি দেখেছেন (✓✓ ও সময়)।",
        },
      ],
      tips: [
        "আপনি কাজের অবস্থা বদলালে যিনি কাজ দিয়েছেন তিনি ইনবক্সে জানতে পারেন।",
        "শেষ তারিখের মধ্যে কাজ শেষ করলে আপনার পারফরম্যান্স স্কোরের “Tasks on time” অংশ পুরো থাকে।",
      ],
    },
    {
      slug: "my-hr-notices",
      title: "HR-এর নোটিশ (Notice board) পড়বেন যেভাবে",
      summary:
        "অফিস বন্ধ, নতুন নিয়ম বা বোনাসের তারিখের মতো সবার জন্য HR-এর নোটিশ My HR-এর “Notices” ট্যাবে পড়া।",
      keywords: [
        "notices",
        "notice board",
        "announcement",
        "pinned",
        "নোটিশ",
        "নোটিশ বোর্ড",
        "ঘোষণা",
        "অফিসের খবর",
      ],
      routes: ["/me/notices"],
      who: "যাঁদের My HR login আছে।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “Notices” ট্যাব খুলুন। ওপরে “Pinned” নোটিশ, তারপর নতুন থেকে পুরোনো। যেটি আপনি আগে পড়েননি তাতে “New” লেখা।",
          image: {
            id: "my-hr-notices-1",
            caption: "“Notices” ট্যাব: পিন করা ও নতুন নোটিশ",
          },
        },
        {
          text: "নোটিশের নিচে কে কবে পোস্ট করেছেন লেখা থাকে। HR পরে বদলালে “Changed” ও সময় দেখাবে, আর শেষ দিন থাকলে “Shown until”।",
        },
        {
          text: "পাতা খুললেই নোটিশগুলো পড়া হয়েছে বলে ধরা হয়; HR দেখেন কে কখন পড়েছেন।",
        },
      ],
      tips: [
        "নতুন নোটিশ এলে ইনবক্সে জানানো হয়; ফোনে নোটিফিকেশন চালু হলে ফোনেও আসবে।",
        "My HR-এর “Today” পাতার “Notice board”-এও সর্বশেষ তিনটি নোটিশ দেখা যায়।",
      ],
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
      slug: "my-hr-claims",
      title: "যাতায়াতের ভাড়া বা কেনাকাটার টাকা ফেরত চাইবেন যেভাবে",
      summary:
        "কাজের জন্য নিজের পকেট থেকে দেওয়া রিকশা-সিএনজি ভাড়া, বা প্রোডাকশনের জন্য কেনা সুতা-বোতামের দাম ফেরত চাওয়া, আর দাবি কোথায় আছে তা দেখা।",
      keywords: [
        "my claims",
        "new claim",
        "conveyance",
        "fare",
        "local material",
        "যাতায়াত ভাতা",
        "ভাড়া ফেরত",
        "দাবি",
        "রিকশা ভাড়া",
        "সুতা কেনা",
      ],
      routes: ["/me/claims"],
      who: "যাঁদের My HR login আছে।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “Claims” ট্যাব খুলুন। ওপরে “To be paid to you” (অনুমোদিত, এখনো পাননি) আর “Waiting for Accounts” দেখবেন।",
          image: {
            id: "my-hr-claims-1",
            caption: "“Claims” ট্যাব: পাওনা টাকা ও নিজের দাবির তালিকা",
          },
        },
        {
          text: "“New claim” চাপুন। “What is it for?”-এ যাতায়াত হলে “Conveyance” বেছে “Day”, “Fare”, “From”, “To” ও “What the trip was for” লিখুন। আগে যাওয়া জায়গার নাম লিখতে শুরু করলেই নিচে চলে আসে।",
          image: {
            id: "my-hr-claims-2",
            caption: "“Claim money back” জানালা: যাতায়াতের দিন, ভাড়া ও কোথা থেকে কোথায়",
          },
        },
        {
          text: "প্রোডাকশনের জন্য কিছু কিনে থাকলে “Local material” বেছে “Production project”, “What you bought”, “How much (optional)”, “Shop (optional)” ও “Price paid” দিন।",
        },
        {
          text: "রসিদ বা মেমোর ছবি “Receipt or memo photo”-তে দিন (যাতায়াতে ঐচ্ছিক), তারপর “Send the claim” চাপুন। Accounts-এর কাছে খবর যায়।",
        },
        {
          text: "প্রতিটি দাবির পাশে অবস্থা থাকে: “Waiting for Accounts”, “Approved, to be paid”, “Paid back” বা “Not approved” (কারণসহ)। সিদ্ধান্তের আগে ভুল দাবি তুলে নিতে “Withdraw” চাপুন।",
        },
      ],
      tips: [
        "চেক-ইন করা দিনের যাতায়াতই দাবি করুন। Accounts দাবিটি সেদিনের হাজিরা ও লোকেশনের সঙ্গে মিলিয়ে দেখে।",
        "অনুমোদিত টাকা Accounts আলাদা করে ফেরত দেয়। টাকা পেলে দাবিটি “Paid back” দেখায়।",
      ],
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
        {
          text: "কোনো তথ্য বাকি বা পুরোনো হলে “Update my details” চাপুন (“আমার তথ্য, রেফারেন্স ও কাগজপত্র দেবেন যেভাবে” নির্দেশিকা দেখুন)। নাম, কোড, পদ ও ফোন নম্বর HR বদলান।",
        },
      ],
    },
    {
      slug: "my-hr-my-details",
      title: "আমার তথ্য, রেফারেন্স ও কাগজপত্র দেবেন যেভাবে, আর বেতনের হিসাব বদলের আবেদন",
      summary:
        "নিজের NID, জন্মতারিখ, রক্তের গ্রুপ, যোগাযোগ ও রেফারেন্স দেওয়া, NID কার্ড ও ছবি যোগ করা, আর ব্যাংক বা বিকাশ/নগদ নম্বর বদলের জন্য HR-এর কাছে আবেদন।",
      keywords: [
        "my details",
        "update my details",
        "reference person",
        "national id",
        "blood group",
        "add a paper",
        "ask for a change",
        "bkash number",
        "bank account",
        "আমার তথ্য",
        "রেফারেন্স",
        "এনআইডি",
        "রক্তের গ্রুপ",
        "বিকাশ নম্বর বদল",
        "ব্যাংক হিসাব",
      ],
      routes: ["/me/profile"],
      who: "যাঁদের My HR login আছে।",
      anyOf: ["portal.self"],
      steps: [
        {
          text: "“My HR” > “My details” ট্যাব খুলুন। “Today” ট্যাবে “HR still needs your …” লেখা থাকলে “Fill in my details” চাপলেও এখানে আসবেন। ডান দিকে “My record”-এ দেখবেন কোনটি বাকি।",
          image: {
            id: "my-hr-my-details-1",
            caption:
              "“My details” ট্যাব: নিজের তথ্যের ফর্ম, “My record”, “How I am paid” ও “My papers”",
          },
        },
        {
          text: "“Who I am” অংশে “National ID number”, “Date of birth” ও “Blood group” দিন। এগুলো একবারই দেওয়া যায়; পরে বদলাতে হলে HR-কে বলুন (তখন “On file. Ask HR to change it.” লেখা থাকে)।",
        },
        {
          text: "“How to reach me”-তে WhatsApp, ইমেইল, ঠিকানা ও জরুরি যোগাযোগ, আর “Reference person”-এ এমন একজনের নাম ও ফোন দিন যিনি আপনাকে চেনেন (আগের মালিক, শিক্ষক বা এলাকার পরিচিত কেউ)। “Save my details” চাপুন।",
        },
        {
          text: "বেতন অন্য ব্যাংক হিসাবে বা বিকাশ/নগদ/রকেট নম্বরে নিতে “How I am paid”-এ “Ask for a change” চাপুন। “Pay me by” বেছে ব্যাংক ও হিসাব নম্বর, বা ওয়ালেট নম্বর দিন, তারপর “Send to HR”।",
          image: {
            id: "my-hr-my-details-2",
            caption: "“Change how I am paid”: “Pay me by”, নম্বর ও “Send to HR”",
          },
        },
        {
          text: "HR অনুমোদন না করা পর্যন্ত বেতন আগের হিসাবেই যায়, আর “Waiting for HR” লেখা থাকে। মত বদলালে “Withdraw the change”। HR অনুমোদন করলে “Approved”, না করলে “Not approved” ও HR-এর কারণ দেখাবে; ইনবক্সেও জানানো হয়।",
        },
        {
          text: "NID কার্ডের ছবি (দুই পাশ), নিজের ছবি বা সনদ রাখতে “My papers”-এ “Add a paper” চাপুন, “What it is” বেছে ফোনের ক্যামেরায় ছবি তুলুন বা PDF দিন, তারপর “Add the paper”।",
        },
      ],
      tips: [
        "আপনার কাগজপত্র শুধু আপনি আর HR দেখতে পারেন। নিজের যোগ করা কাগজ নিজে মুছতে পারেন।",
        "অন্য কারও নম্বরে বেতন নেওয়ার আবেদন HR বাতিল করতে পারেন; নিজের নামের হিসাব বা নম্বর দিন।",
        "চাকরির শর্তাবলির স্বাক্ষরিত কপি (“Signed terms of employment”) অ্যাপ নিজেই “My papers”-এ রাখে; এটি মোছা যায় না। শর্তাবলি আবার পড়তে নিচের “Read the terms of employment” চাপুন।",
      ],
    },
    {
      slug: "my-hr-terms",
      title: "চাকরির শর্তাবলি পড়ে রাজি হবেন যেভাবে (সই বা SMS কোড)",
      summary:
        "অ্যাপ খুললে প্রথমে চাকরির শর্তাবলির পাতা আসে: পুরোটা নিচ পর্যন্ত পড়ে আঙুলে সই করে বা SMS কোড দিয়ে রাজি হলে তবেই অ্যাপ খোলে; স্বাক্ষরিত কপি আপনার কাগজপত্রে থাকে।",
      keywords: [
        "terms of employment",
        "i agree",
        "signature",
        "sign by hand",
        "sms code",
        "signed copy",
        "শর্তাবলি",
        "রাজি",
        "সই",
        "কোড",
      ],
      routes: ["/terms"],
      who: "যাঁদের লগইনের সঙ্গে কর্মীর রেকর্ড যুক্ত, কোম্পানি শর্তাবলি প্রকাশ করার পর।",
      steps: [
        {
          text: "কোম্পানি শর্তাবলি প্রকাশ করলে বা বদলালে অ্যাপ খুলতেই “Terms of employment” পাতা আসে। রাজি না হওয়া পর্যন্ত অ্যাপের অন্য কিছু খোলে না।",
          image: {
            id: "my-hr-terms-1",
            caption: "“Terms of employment” পাতা: উপরে সংস্করণ, নিচে পুরো লেখা",
          },
        },
        {
          text: "পুরোটা মন দিয়ে পড়ুন। নিচের “Read to the end to agree.” লেখা থাকা পর্যন্ত সই করা যায় না; “Keep reading” চাপলে পাতা নিচে নামে। শেষ পর্যন্ত পৌঁছালে সইয়ের ঘর খোলে।",
        },
        {
          text: "“My signature”-এর ঘরে আঙুল দিয়ে নিজের সই করুন। ভুল হলে “Clear the signature” চেপে আবার করুন। তারপর “I agree” চাপুন।",
          image: {
            id: "my-hr-terms-2",
            caption: "“Agree to the terms”: সইয়ের ঘর ও “I agree”",
          },
        },
        {
          text: "SMS চালু থাকলে “How I agree”-তে “Code by SMS to …” বেছে নিতে পারেন। “Send me a code” চাপুন, ফোনে আসা ৬ সংখ্যার কোড “Code from the SMS”-এ লিখে “I agree” চাপুন। কোড ১০ মিনিট কাজ করে; না এলে এক মিনিট পর “Send another code”।",
        },
        {
          text: "রাজি হলে অ্যাপ খুলে যায়। কয়েক সেকেন্ডের মধ্যে স্বাক্ষরিত কপি (PDF) “My HR” > “My details” > “My papers”-এ আসে, আর ইনবক্সে জানানো হয়।",
        },
      ],
      tips: [
        "স্বাক্ষরিত কপিতে আপনার নাম, কোড, NID, সময়, IP ঠিকানা ও ডিভাইস লেখা থাকে। এটি শুধু আপনি আর HR দেখতে পারেন।",
        "শর্তাবলি বদলালে নতুন সংস্করণে আবার রাজি হতে বলা হতে পারে। অন্য কেউ আপনার ফোনে লগইন করে থাকলে “Not you? Sign out” চাপুন।",
      ],
    },
  ],
};
