import type { HelpSection } from "../types";

/** HR & payroll: employees, attendance, leave, payroll and payslips, advances, holidays and rules. */
export const hrHelp: HelpSection = {
  id: "hr",
  title: "মানবসম্পদ ও বেতন (HR & payroll)",
  description:
    "কর্মীদের তথ্য, হাজিরা, ছুটি, মাসিক বেতন ও পে-স্লিপ, বেতনের অগ্রিম, আর ছুটির দিন ও অফিসের নিয়ম।",
  href: "/hr",
  articles: [
    {
      slug: "hr-overview",
      title: "HR-এর সারসংক্ষেপ দেখবেন যেভাবে",
      summary:
        "আজ কে উপস্থিত, দেরিতে, অনুপস্থিত বা ছুটিতে, কোন ছুটির সিদ্ধান্ত বাকি, আর বেতনের অবস্থা এক নজরে দেখা।",
      keywords: [
        "hr overview",
        "in today",
        "on leave today",
        "leave to decide",
        "headcount",
        "holidays",
        "এইচআর",
        "আজকের হাজিরা",
        "কর্মী সংখ্যা",
        "ছুটিতে",
      ],
      routes: ["/hr"],
      who: "যাঁরা HR & payroll দেখতে পারেন: Super Admin ও Accounts (আর HR-এর অনুমতি থাকা নিজস্ব ভূমিকা)।",
      steps: [
        {
          text: "মেনু থেকে “HR & payroll” খুলুন (ফোনে “HR”)। “Overview”-এর উপরে “Employees”, “In today”, “On leave today”, “Leave to decide” ও অনুমতি থাকলে “Advances owed”।",
          image: {
            id: "hr-overview-1",
            caption: "HR-এর “Overview”: উপরের সংখ্যা, আজকের অনুপস্থিতি ও বেতনের অবস্থা",
          },
        },
        {
          text: "“Leave to decide”-এ অপেক্ষায় থাকা ছুটির আবেদন, “Today”-তে আজ কে ছুটিতে বা অনুপস্থিত, “Coming holidays”-এ সামনের ছুটির দিন।",
        },
        {
          text: "HR সামলানোর অনুমতি থাকলে “Staff records” অংশে কর্মীদের বেতনের হিসাব বদলের আবেদন (অনুমোদনের অপেক্ষায়), কয়জনের রেকর্ডে তথ্য বাকি, আর কয়জন এখনো চাকরির শর্তাবলিতে রাজি হননি (“See who”) তা দেখাবে। অনুমোদনের অপেক্ষায় ওভারটাইম থাকলে “Approve overtime” লিংকও আসে।",
        },
        {
          text: "বেতন দেখার অনুমতি থাকলে “Payroll” অংশে গত মাস ও এ মাসের বেতন কোন অবস্থায় আছে (তৈরি হয়নি, অনুমোদন বাকি, পরিশোধ বাকি) দেখাবে।",
        },
        {
          text: "উপরের বোতাম থেকে সরাসরি “Mark today”, “Record leave”, “Add an employee” বা “Give an advance” করা যায়।",
        },
      ],
    },
    {
      slug: "hr-add-employee",
      title: "নতুন কর্মী যোগ করবেন যেভাবে",
      summary:
        "কর্মীর ব্যক্তিগত তথ্য, পদ, যোগদানের দিন, বেতন, ওভারটাইম হার ও বেতন কীভাবে দেওয়া হবে তা দিয়ে কর্মী যোগ করা।",
      keywords: [
        "add an employee",
        "new employee",
        "staff",
        "worker",
        "salary",
        "joining",
        "নতুন কর্মী",
        "কর্মচারী",
        "শ্রমিক",
        "যোগদান",
        "বেতন",
      ],
      routes: ["/hr/employees/new", "/hr/employees"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে: শুরুতে শুধু Super Admin, অথবা “HR Manager”-এর মতো নিজস্ব ভূমিকা।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Employees” ট্যাবে “Add an employee” চাপুন।",
          image: {
            id: "hr-add-employee-1",
            caption: "“Employees” ট্যাবে কর্মীর তালিকা ও “Add an employee” বোতাম",
          },
        },
        {
          text: "“The person” অংশে “Full name”, ফোন, WhatsApp, ইমেইল, “National ID (optional)”, জন্মতারিখ, রক্তের গ্রুপ, ঠিকানা, “Emergency contact (optional)” ও রেফারেন্স (“Reference person (optional)”, ফোন ও কীভাবে চেনেন) দিন। কোড ফাঁকা রাখলে পরের কোড (যেমন EMP-0012) নিজে থেকে বসবে।",
        },
        {
          text: "“The job” অংশে “Post (optional)” (যেমন Sewing operator), “Department (optional)” ও “Joined on” দিন। বেতন ও ছুটি এই দিন থেকে গোনা হয়। কাজের জায়গা যোগ করা থাকলে “Work place (optional)”-এ কর্মী কোথায় চেক-ইন করবেন তা বেছে নিন।",
        },
        {
          text: "“Pay” অংশে “Monthly salary” (যোগদানের দিন থেকে মোট বেতন), “Overtime pay per hour (optional)” (ফাঁকা রাখলে ওভারটাইম দেওয়া হয় না) আর “Salary paid by” (ক্যাশ, ব্যাংক বা ওয়ালেট, সঙ্গে ব্যাংক, “Branch (optional)” ও নম্বর) দিন।",
          image: {
            id: "hr-add-employee-2",
            caption: "“Pay” অংশ: মাসিক বেতন, ওভারটাইম হার ও “Salary paid by”",
          },
        },
        { text: "“Add the employee” চাপুন।" },
      ],
      tips: [
        "যাঁরা শুধু HR দেখতে পারেন কিন্তু বেতন দেখার অনুমতি নেই, তাঁরা বেতনের অঙ্ক দেখতে পান না।",
        "কর্মীকে অ্যাপে ঢোকার সুযোগ দিতে “কর্মীকে My HR login দেবেন যেভাবে” নির্দেশিকা দেখুন।",
      ],
    },
    {
      slug: "hr-employee-profile",
      title: "কর্মীর তথ্য, বেতন বা চাকরি ছাড়া রেকর্ড করবেন যেভাবে",
      summary:
        "কর্মীর তথ্য ও বেতন বদলানো, ছুটির বরাদ্দ ঠিক করা, অফিসের জিনিস (ল্যাপটপ, ফোন, সিম) দেখা, চাকরি ছাড়ার দিন লেখা, আবার ফিরিয়ে নেওয়া আর হিসাবের স্টেটমেন্ট দেখা।",
      keywords: [
        "employee",
        "change salary",
        "increment",
        "resign",
        "terminate",
        "last working day",
        "reinstate",
        "leave allowance",
        "বেতন বৃদ্ধি",
        "ইনক্রিমেন্ট",
        "চাকরি ছাড়া",
        "পদত্যাগ",
        "ছাঁটাই",
      ],
      routes: ["/hr/employees"],
      who: "দেখতে পারেন যাঁরা HR দেখেন। বদলাতে HR সামলানোর অনুমতি লাগে (শুরুতে Super Admin)।",
      steps: [
        {
          text: "“Employees” ট্যাবে নাম, কোড, ফোন বা পদ দিয়ে খুঁজে কর্মীর পাতায় যান। “Department” ও “Status” দিয়ে ছাঁকা যায়, চলে যাওয়া কর্মী দেখতে “People who left too”।",
        },
        {
          text: "পাতায় এ মাসের হাজিরা, বছরের ছুটি, আর অনুমতি থাকলে বেতন, বেতনের ইতিহাস, অগ্রিম ও পে-স্লিপ দেখবেন।",
          image: {
            id: "hr-employee-profile-1",
            caption: "কর্মীর পাতা: হাজিরা, ছুটি, বেতন ও কাজের বোতাম",
          },
        },
        {
          text: "তথ্য বদলাতে “Change details”। বেতন বদলাতে “Change salary” চাপুন, নতুন অঙ্ক, “From” (কবে থেকে) ও “Why (optional)” দিয়ে “Save the salary” চাপুন। ইতিহাস “Salary over time”-এ থাকে।",
        },
        {
          text: "কোনো ছুটির ধরনে বরাদ্দ বদলাতে ছুটির অংশে “Set” চাপুন এবং “Days allowed” দিন।",
        },
        {
          text: "কেউ চলে গেলে “Record leaving” চাপুন। “They resigned” বা “Their job was ended” বেছে “Last working day” দিন। ভুল হলে বা ফিরে এলে “Reinstate”। আজ বা আগের দিনে একবারে বিদায় দিতে “Deactivate employee” ব্যবহার করুন (পরের নির্দেশিকা দেখুন)।",
        },
        {
          text: "ডান পাশের “Company items”-এ কর্মীর কাছে থাকা অফিসের জিনিস দেখবেন। নতুন জিনিস দিতে “Give an item”, ফেরত নিতে জিনিসের পাশে “Take back”।",
        },
        {
          text: "“Statement”-এ কর্মীর অগ্রিমের দেনা (“Owes on advances”) আর বাকি বেতন (“Salary still to pay them”) সহ প্রতিটি লেনদেন দেখা যায়।",
        },
        {
          text: "HR পাতার ডান পাশে “Performance score” দেখেন: গত ৩০ দিনের হাজিরা, সময়মতো কাজ ও দাবির ভিত্তিতে ০ থেকে ১০ নম্বর, প্রতিটি অংশ, আর “What lost points”-এ কোন দিন বা কোন কাজে নম্বর কেটেছে। “Joined”-এর নিচে কোম্পানিতে কত দিন হলো লেখা থাকে।",
          image: {
            id: "hr-employee-profile-2",
            caption: "কর্মীর পাতায় “Performance score” বৃত্ত ও তার অংশগুলো",
          },
        },
      ],
      tips: [
        "ভুল করে যোগ করা কর্মী (যাঁর কোনো হাজিরা, ছুটি, বেতন বা অগ্রিম নেই) “Remove” দিয়ে মোছা যায়। এটি আর ফেরানো যায় না।",
      ],
    },
    {
      slug: "hr-deactivate",
      title: "কর্মীকে একবারে বিদায় দেবেন যেভাবে (Deactivate ও ছাড়পত্র)",
      summary:
        "চাকরি ছাড়ার দিন অফিসের জিনিস ফেরত হয়েছে কি না দেখা, পাওনা-দেনা মেলানো, শেষ কর্মদিবস লেখা, login বন্ধ করা আর অভিজ্ঞতা ও ছাড়পত্র (Experience & Clearance Certificate) PDF তৈরি।",
      keywords: [
        "deactivate",
        "clearance",
        "experience certificate",
        "exit",
        "offboarding",
        "release letter",
        "ছাড়পত্র",
        "অভিজ্ঞতার সনদ",
        "বিদায়",
        "চাকরি ছাড়া",
        "ক্লিয়ারেন্স",
      ],
      routes: ["/hr/employees"],
      who: "HR সামলানোর অনুমতি যাঁদের আছে (শুরুতে Super Admin)। নিজেকে নিজে deactivate করা যায় না।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "কর্মীর পাতায় “Deactivate employee” চাপুন। অ্যাপ আগে দেখে তাঁর কাছে অফিসের কোনো জিনিস (ল্যাপটপ, ফোন, সিম, আইডি কার্ড) রয়ে গেছে কি না।",
          image: {
            id: "hr-deactivate-1",
            caption: "“Deactivate employee” জানালা: ছাড়পত্রের যাচাই, পাওনা-দেনা ও শেষ কর্মদিবস",
          },
        },
        {
          text: "কিছু রয়ে গেলে “Take the company items back first” দেখাবে। “Go to the items” চেপে প্রতিটি জিনিস “Take back” দিয়ে ফেরত, নষ্ট বা হারানো হিসেবে লিখুন, তারপর আবার চাপুন।",
        },
        {
          text: "জানালায় বাকি বেতন, অগ্রিমের দেনা আর ফেরত পাওনা দাবি দেখাবে, আর login বন্ধ হবে কি না। “They resigned” বা “Their job was ended” বেছে “Last working day” (আজ বা আগের দিন) দিন, তারপর “Deactivate” চাপুন।",
        },
        {
          text: "অ্যাপ শেষ কর্মদিবস লেখে, Employee login বন্ধ করে এবং কিছুক্ষণের মধ্যে “Experience & Clearance Certificate” PDF বানিয়ে কর্মীর কাগজপত্রে রাখে। এটি লেটারহেডে, সম্পাদনা করা যায় না।",
          image: {
            id: "hr-deactivate-2",
            caption: "অভিজ্ঞতা ও ছাড়পত্র: চাকরির সময়, ফেরত দেওয়া জিনিস ও পাওনা-দেনা",
          },
        },
        {
          text: "পরে শেষ মাসের বেতন বা দাবি শোধ হলে কর্মীর পাতায় “Clearance certificate” চেপে “Make the certificate again” চাপুন। নতুন কপিতে সব পাওনা মিটে যাওয়া দেখাবে; আগের কপিও থাকে।",
        },
      ],
      tips: [
        "শেষ কর্মদিবস সামনে হলে আগে “Record leaving” দিয়ে দিনটি লিখুন, আর সেদিন “Deactivate employee” চাপুন।",
        "Employee ছাড়া অন্য ভূমিকার login (যেমন Accounts) শুধু তিনিই বন্ধ করতে পারেন যিনি ব্যবহারকারী সামলান (Settings > Users)।",
        "অগ্রিমের বাকি টাকা শেষ বেতন থেকে কেটে নেওয়া হয়।",
      ],
    },
    {
      slug: "hr-items",
      title: "কর্মীদের দেওয়া অফিসের জিনিস (ল্যাপটপ, ফোন, সিম) রাখবেন যেভাবে",
      summary:
        "কোন কর্মীর কাছে কোন ল্যাপটপ, ফোন, সিম, আইডি কার্ড, চাবি বা ইউনিফর্ম আছে তা লেখা, ফেরত নেওয়া (ভালো, নষ্ট বা হারানো) আর চলে যাওয়া কর্মীর কাছে কিছু রয়ে গেল কি না দেখা।",
      keywords: [
        "company items",
        "assets",
        "laptop",
        "phone",
        "sim card",
        "id card",
        "take back",
        "অফিসের জিনিস",
        "ল্যাপটপ",
        "সিম কার্ড",
        "আইডি কার্ড",
        "ফেরত",
      ],
      routes: ["/hr/items"],
      who: "দেখতে পারেন যাঁরা HR দেখেন। জিনিস দেওয়া ও ফেরত নেওয়া HR সামলানোর অনুমতি যাঁদের আছে (শুরুতে Super Admin)।",
      anyOf: ["hr.view", "hr.manage", "hr.payroll"],
      steps: [
        {
          text: "“HR & payroll” > “Items” ট্যাব খুলুন। “With staff”-এ যা এখন কর্মীদের কাছে, “Back”-এ যা ফেরত এসেছে। নাম, ট্যাগ বা কর্মীর নাম লিখে “Search” চাপুন।",
          image: {
            id: "hr-items-1",
            caption: "“Company items” পাতা: কার কাছে কী আছে, কবে থেকে",
          },
        },
        {
          text: "কাউকে কিছু দিলে “Give an item” চাপুন। “Given to”, “What it is”, “Kind”, “Tag or serial (optional)”, “Value (optional)” ও “Handed over on” দিয়ে “Save” চাপুন। কর্মী অ্যাপে খবর পান এবং My HR-এ দেখেন।",
          image: {
            id: "hr-items-2",
            caption: "“Give a company item” জানালা: কাকে, কী, ট্যাগ ও তারিখ",
          },
        },
        {
          text: "জিনিস ফেরত এলে তার পাশে “Take back” চাপুন। “How it came back”-এ “Returned”, “Returned damaged” বা “Lost” বেছে তারিখ দিন; নষ্ট বা হারানো হলে “What happened” লিখুন।",
        },
        {
          text: "ভুল করে ফেরত লিখলে “Undo” চাপুন, জিনিসটি আবার কর্মীর কাছে দেখাবে। একদম ভুল করে লেখা জিনিস “Remove” দিয়ে মুছুন।",
        },
      ],
      tips: [
        "কারও কাছে জিনিস থাকলে তাঁকে “Deactivate employee” করা যায় না। চলে যাওয়া কর্মীর কাছে কিছু থাকলে পাতার ওপরে লাল লেখায় দেখায়, আর সেই জিনিসের পাশে লাল “Left” ও চলে যাওয়ার তারিখ থাকে।",
        "কর্মীর পাতায় “Company items” অংশেও একই কাজ করা যায়।",
      ],
    },
    {
      slug: "hr-give-login",
      title: "কর্মীকে My HR login দেবেন যেভাবে",
      summary:
        "কর্মী যাতে ফোন থেকে নিজের হাজিরা, ছুটি, পে-স্লিপ ও কাজ দেখতে পারেন, তার জন্য অ্যাপে ঢোকার অ্যাকাউন্ট দেওয়া।",
      keywords: [
        "give a login",
        "my hr",
        "employee login",
        "portal",
        "remove the login",
        "লগইন দেওয়া",
        "কর্মীর অ্যাকাউন্ট",
        "মাই এইচআর",
        "পোর্টাল",
      ],
      routes: ["/hr/employees"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে।",
      anyOf: ["hr.manage"],
      steps: [
        { text: "কর্মীর পাতায় “Give a login” চাপুন।" },
        {
          text: "“Email they sign in with” ও দরকার হলে “Phone (optional)” দিয়ে “Give the login” চাপুন।",
          image: {
            id: "hr-give-login-1",
            caption: "“Give a login” জানালা: সাইন-ইন ইমেইল ও ফোন",
          },
        },
        {
          text: "একটি অস্থায়ী পাসওয়ার্ড একবারই দেখাবে। কপি করে কর্মীকে দিন। তিনি প্রথমবার ঢুকে নিজের পাসওয়ার্ড ঠিক করবেন।",
        },
        {
          text: "লগইন বন্ধ করতে “Remove the login” চাপুন। কর্মীর রেকর্ড থেকে যাবে।",
        },
      ],
    },
    {
      slug: "hr-attendance",
      title: "দৈনিক হাজিরা দেবেন যেভাবে",
      summary:
        "দিনের রেজিস্টারে কেউ দেরিতে, অর্ধদিবস বা অনুপস্থিত হলে চিহ্ন দেওয়া, প্রবেশ-প্রস্থানের সময় ও ওভারটাইম লেখা।",
      keywords: [
        "attendance",
        "register",
        "mark today",
        "late",
        "absent",
        "half day",
        "overtime",
        "check in",
        "হাজিরা",
        "উপস্থিতি",
        "অনুপস্থিত",
        "দেরি",
        "ওভারটাইম",
      ],
      routes: ["/hr/attendance", "/hr/attendance/month"],
      who: "দেখতে পারেন যাঁরা HR দেখেন। হাজিরা দিতে HR সামলানোর অনুমতি লাগে।",
      steps: [
        {
          text: "“HR & payroll” > “Attendance” ট্যাব খুলুন (বা Overview-এর “Mark today”)। “Today” বা অন্য দিন বেছে নিন।",
        },
        {
          text: "সবার নামের পাশে চিহ্নের ঘর থাকে। কিছু না দিলে উপস্থিত ধরা হয় (“No mark (present)”)। শুধু যাঁরা “Late”, “Half day” বা “Absent”, তাঁদের চিহ্ন দিন।",
          image: {
            id: "hr-attendance-1",
            caption: "দিনের রেজিস্টার: প্রত্যেকের চিহ্ন, “In”, “Out”, ওভারটাইম ও নোট",
          },
        },
        {
          text: "দরকার হলে “In” ও “Out” সময়, “Overtime (minutes)” আর “Add a note” দিয়ে নোট লিখুন। ছুটিতে থাকা কর্মী ও ছুটির দিন আলাদা দেখানো হয়।",
        },
        {
          text: "কর্মী ফোন থেকে লোকেশনসহ চেক-ইন করলে নামের নিচে লেখা থাকে কোথা থেকে করেছেন, যেমন “In at …”। কাজের জায়গা থেকে দূরে হলে লাল “Location mismatch”, আর লোকেশন না থাকলে “No location” দেখাবে। HR “(map)” চেপে ঠিক জায়গাটি Google Maps-এ দেখতে পারেন।",
          image: {
            id: "hr-attendance-2",
            caption: "রেজিস্টারে চেক-ইনের জায়গা, “Location mismatch” ও “No location” চিহ্ন",
          },
        },
        { text: "সবশেষে একবার “Save the register” চাপুন।" },
        {
          text: "মাসের হিসাব দেখতে “The month in figures” চাপুন। প্রত্যেকের কাজের দিন, উপস্থিত, দেরি, অনুপস্থিত, ছুটি ও ওভারটাইম, যা বেতনে ব্যবহার হয়।",
        },
      ],
      tips: [
        "বেতন অনুমোদিত হয়ে গেলে সেই মাসের হাজিরা আর বদলানো যায় না।",
        "কর্মীরা নিজে চেক-ইন করবেন কি না, আর লোকেশন লাগবে কি না, তা “Holidays & rules”-এ ঠিক করা হয়।",
      ],
    },
    {
      slug: "hr-gps-attendance",
      title: "লোকেশনসহ হাজিরা (GPS) চালু করবেন ও কাজের জায়গা যোগ করবেন যেভাবে",
      summary:
        "চেক-ইনের সময় ফোনের লোকেশন চাওয়া, চেক-আউট পর্যন্ত লোকেশন পাঠানো, আর অফিস-কারখানা-দোকানের জায়গা ও সীমা (radius) ঠিক করা।",
      keywords: [
        "gps attendance",
        "location",
        "work places",
        "geofence",
        "radius",
        "location mismatch",
        "use my location",
        "লোকেশন",
        "জিপিএস",
        "কাজের জায়গা",
        "অফিসের জায়গা",
        "লোকেশন মিলছে না",
      ],
      routes: ["/hr/settings"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Holidays & rules” ট্যাবে “Change the rules” চাপুন। “Staff check in and out themselves” আর “Ask for location at check-in and while checked in” দুটিতেই টিক দিয়ে “Save the rules” চাপুন।",
          image: {
            id: "hr-gps-attendance-1",
            caption: "“Ask for location at check-in and while checked in” নিয়ম",
          },
        },
        {
          text: "একই পাতার “Work places” অংশে “Add a work place” চাপুন। “Name” (যেমন Head office বা Factory) আর ঠিকানা দিন।",
        },
        {
          text: "জায়গাটিতে দাঁড়িয়ে ফোন থেকে “Use my location” চাপুন, “Latitude” ও “Longitude” নিজে থেকে বসবে। অথবা Google Maps-এ জায়গাটি চেপে ধরে ওপরের সংখ্যা দুটি কপি করে “Latitude” ঘরে পেস্ট করুন, দুটি ঘরই ভরে যাবে।",
          image: {
            id: "hr-gps-attendance-2",
            caption: "“Add a work place”: নাম, “Use my location” ও “Radius in metres”",
          },
        },
        {
          text: "“Radius in metres”-এ লিখুন জায়গা থেকে কত মিটার পর্যন্ত এখানেই ধরা হবে (বেশিরভাগ ভবনে 150)। “Add the work place” চাপুন। বদলাতে “Change”, বাদ দিতে “Remove”।",
        },
        {
          text: "কোনো কর্মী নির্দিষ্ট জায়গায় চেক-ইন করবেন বলে ঠিক করতে কর্মীর “Change details” পাতায় “Work place (optional)” বেছে নিন। না দিলে সবচেয়ে কাছের জায়গার সঙ্গে মেলানো হয় (“No fixed place (nearest)”)।",
        },
      ],
      tips: [
        "চালু থাকলে লোকেশন ছাড়া চেক-ইন করা যায় না। চেক-আউট লোকেশন ছাড়াও করা যায়, যাতে কেউ আটকে না যান।",
        "চেক-ইন থেকে চেক-আউট পর্যন্ত ফোন প্রতি আধা মিনিটে লোকেশন নেয় আর প্রতি মিনিটে পাঠায়। মাঠের কর্মীদের জন্য Extas ERP-এর Android অ্যাপ দিন, তাতে স্ক্রিন বন্ধ বা অ্যাপ বন্ধ থাকলেও লোকেশন যায়।",
        "লোকেশনের হিসাব ৯০ দিন রাখা হয়, তারপর নিজে থেকে মুছে যায়। চেক-ইন ও চেক-আউটের জায়গা হাজিরার সঙ্গে থেকে যায়।",
      ],
    },
    {
      slug: "hr-staff-map",
      title: "কে কোথায় আছেন, লাইভ ম্যাপে দেখবেন যেভাবে",
      summary:
        "আজ চেক-ইন করা কর্মীরা কোথা থেকে চেক-ইন করেছেন, ফোন শেষবার কোথায় ছিল, কার সিগন্যাল নেই, আর কারও সারাদিনের পথ।",
      keywords: [
        "staff map",
        "live map",
        "tracking",
        "no signal",
        "route",
        "where is",
        "field staff",
        "লাইভ ম্যাপ",
        "কর্মী কোথায়",
        "সিগন্যাল নেই",
        "মাঠকর্মী",
        "যাতায়াতের পথ",
      ],
      routes: ["/hr/map"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Staff map” ট্যাব খুলুন। পাতাটি প্রতি ২০ সেকেন্ডে নিজে থেকে হালনাগাদ হয়।",
          image: {
            id: "hr-staff-map-1",
            caption: "“Staff map”: ম্যাপে সবার শেষ অবস্থান ও পাশে তালিকা",
          },
        },
        {
          text: "ওপরে সংখ্যা: “On duty” (চেক-ইন করা), “No signal” (১০ মিনিট কোনো লোকেশন আসেনি), “Away at check-in” (কাজের জায়গা থেকে দূরে চেক-ইন) আর “Checked out”।",
        },
        {
          text: "ম্যাপে সবুজ বিন্দু মানে কাজে আছেন, লাল মানে সিগন্যাল নেই, ধূসর মানে চলে গেছেন। বেগুনি বৃত্তগুলো কাজের জায়গা।",
        },
        {
          text: "তালিকায় প্রত্যেকের চেক-ইনের সময় ও জায়গা, “Location mismatch” থাকলে তা, “Last seen” সময়, ফোনের ব্যাটারি আর “Open in Google Maps” লিংক। লাল “No signal since …” মানে ফোন বন্ধ, নেটওয়ার্ক নেই বা লোকেশন বন্ধ।",
        },
        {
          text: "কারও সারাদিনের পথ দেখতে “Show the route” চাপুন (বা ম্যাপে তাঁর বিন্দু)। নীল রেখায় পথ, মোট দূরত্ব, আর “Open the route in Google Maps”। সবাইকে আবার দেখতে “Show everyone”।",
          image: {
            id: "hr-staff-map-2",
            caption: "একজনের পথ: নীল রেখা, দূরত্ব ও “Open the route in Google Maps”",
          },
        },
      ],
      tips: [
        "শুধু যাঁরা নিজে ফোন থেকে চেক-ইন করেছেন তাঁরাই এখানে আসেন। HR-এর দেওয়া হাজিরা ম্যাপে আসে না।",
        "ব্রাউজারে My HR খোলা থাকলেই শুধু লোকেশন যায়। সারাদিন লোকেশন পেতে মাঠকর্মীদের Android অ্যাপ ব্যবহার করতে বলুন।",
      ],
    },
    {
      slug: "hr-overtime",
      title: "ওভারটাইম অনুমোদন করবেন যেভাবে (শ্যাডো ওভারটাইম)",
      summary:
        "কর্মী দিনের শেষ সময়ের পরে চেক-আউট করলে বা ছুটির দিনে কাজ করলে অ্যাপ নিজেই ওভারটাইম ধরে রাখে। কর্মী তা দেখেন না; HR অনুমোদন দিলে তবেই বেতনে যায়।",
      keywords: [
        "overtime",
        "shadow overtime",
        "approve overtime",
        "extra hours",
        "ot",
        "ওভারটাইম",
        "অতিরিক্ত সময়",
        "ওভারটাইম অনুমোদন",
        "শ্যাডো ওভারটাইম",
      ],
      routes: ["/hr/overtime"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "কর্মী নিজের ফোন থেকে চেক-আউট করলে অ্যাপ দেখে তিনি দিনের শেষ সময়ের (“Working day ends at”) পরে কতক্ষণ ছিলেন। সাপ্তাহিক বা সরকারি ছুটির দিনে পুরো কাজের সময়টাই ওভারটাইম। ১৫ মিনিটের ধাপে গোনা হয়, আর খুব অল্প সময় থাকলে ধরা হয় না।",
        },
        {
          text: "“HR & payroll” > “Overtime” ট্যাব খুলুন। ওপরে “Waiting” (অনুমোদনের অপেক্ষায়), “Need a look” (যেগুলো ভালো করে দেখা দরকার), “Approved” (অনুমোদিত ঘণ্টা) আর “Approved pay” (বেতনে যাবে এমন টাকা)। মাস বদলাতে ওপরের তীর চিহ্ন।",
          image: {
            id: "hr-overtime-1",
            caption: "“Overtime” ট্যাব: মাসের হিসাব ও প্রত্যেকের ওভারটাইম",
          },
        },
        {
          text: "প্রতিটি সারিতে চেক-ইন ও চেক-আউটের সময়, কখন থেকে গোনা হয়েছে, কত পাওয়া গেছে আর কর্মীর ঘণ্টাপ্রতি রেটে কত টাকা হয়। লাল চিহ্ন: “Left before checking out” (লোকেশন বলছে চেক-আউটের আগেই কাজের জায়গা ছেড়েছেন), “Checked out away” (দূর থেকে চেক-আউট), “No location at check-out” আর “Long day” (৪ ঘণ্টা বা বেশি)।",
        },
        {
          text: "ঠিক থাকলে “Approve …” চাপুন। লোকেশন ট্রেইল কম সময় দেখালে দ্বিতীয় বোতামে সেই প্রস্তাবিত সময় অনুমোদন করা যায়, কারণটি নিজে থেকে লেখা হয়।",
          image: {
            id: "hr-overtime-2",
            caption: "লোকেশন অনুযায়ী প্রস্তাবিত সময়সহ একটি ওভারটাইম সারি",
          },
        },
        {
          text: "ঘণ্টা কমাতে বা বাড়াতে “Change hours” চাপুন। “Hours to pay”-তে যেমন 1.5 বা 1:30 লিখুন, আর পাওয়া সময়ের চেয়ে আলাদা হলে “Reason” লিখে “Approve these hours” চাপুন। দিতে না চাইলে “Reject” চাপুন, কারণ লিখুন।",
        },
        {
          text: "লাল চিহ্ন ছাড়া সবগুলো একসঙ্গে দিতে “Approve all as found” চাপুন। চিহ্নিতগুলো একটি একটি করে দেখে সিদ্ধান্ত নিন।",
        },
      ],
      tips: [
        "কর্মী My HR-এ ওভারটাইমের ঘণ্টা দেখেন না। বেতন অনুমোদনের পর পেস্লিপে শুধু অনুমোদিত ওভারটাইমের টাকা দেখান।",
        "অনুমোদিত ঘণ্টা দিনের হাজিরায় বসে, তাই বেতনের খসড়া আগে বানানো থাকলে “Work it out again” চাপুন।",
        "মাসের বেতন অনুমোদনের পর সেই মাসের ওভারটাইম আর বদলানো যায় না। নিজের ওভারটাইম নিজে অনুমোদন করা যায় না।",
      ],
    },
    {
      slug: "hr-claims",
      title: "কর্মীদের যাতায়াত ভাতা ও লোকাল কেনাকাটার দাবি দেখবেন ও অনুমোদন করবেন যেভাবে",
      summary:
        "কর্মী My HR থেকে যাতায়াতের ভাড়া বা প্রোডাকশনের জন্য নিজে কেনা মালের দাম ফেরত চান। অ্যাপ GPS হাজিরা ও স্বাভাবিক ভাড়ার সঙ্গে মিলিয়ে সন্দেহজনক দাবি চিহ্নিত করে; Accounts অনুমোদন দিলে খাতায় ওঠে, পরে টাকা ফেরত দেওয়া হয়।",
      keywords: [
        "claims",
        "conveyance",
        "local material",
        "pay back",
        "route",
        "fare",
        "যাতায়াত ভাতা",
        "কনভেয়েন্স",
        "দাবি",
        "ভাড়া",
        "লোকাল কেনাকাটা",
        "সুতা",
        "টাকা ফেরত",
      ],
      routes: ["/hr/claims"],
      who: "HR দেখতে পারেন। অনুমোদন ও টাকা ফেরত দেন শুধু Accounts ও Super Admin।",
      anyOf: ["hr.manage", "expenses.manage", "accounts.payments.record"],
      steps: [
        {
          text: "“HR & payroll” > “Claims” ট্যাব খুলুন। ওপরে মাসের “Waiting” (সিদ্ধান্তের অপেক্ষায়), “Need a look” (চিহ্নিত দাবি), “Approved” ও “Paid back”। মাস বদলাতে ওপরের তীর চিহ্ন, আর নিচে অবস্থা ও ধরন (“Conveyance” বা “Local material”) দিয়ে ছাঁকুন।",
          image: {
            id: "hr-claims-1",
            caption: "“Claims” ট্যাব: মাসের হিসাব, কর্মীদের পাওনা ও দাবির তালিকা",
          },
        },
        {
          text: "যাতায়াতের প্রতিটি দাবি সেদিনের হাজিরা ও GPS পথের সঙ্গে মেলানো হয়। লাল চিহ্নের মানে: “Not on duty” (সেদিন ডিউটিতে ছিলেন না), “No GPS trail” বা “No travel” (পথে কোনো চলাচল নেই), “Route not on the trail” (লেখা জায়গায় GPS কখনো যায়নি), “Price unusually high” (স্বাভাবিক ভাড়ার দেড় গুণের বেশি), “Claimed already” (একই দাবি আগেও) আর “No receipt”। নিচে এক লাইনে কারণটি লেখা থাকে।",
          image: {
            id: "hr-claims-2",
            caption: "চিহ্নিত একটি দাবি: লাল চিহ্ন, কারণ ও GPS পথের হিসাব",
          },
        },
        {
          text: "পথটি নিজে দেখতে “See the route on Google Maps” চাপুন। Google Maps যুক্ত থাকলে রাস্তার দূরত্বও দেখায়, আর ভাড়া সেই দূরত্বে কিলোমিটারপ্রতি স্বাভাবিক ভাড়ার সঙ্গে মেলানো হয়।",
        },
        {
          text: "ঠিক থাকলে “Approve …” চাপুন। কম টাকা দিতে “Change and approve” চাপুন, “Amount to approve” ও “Reason” লিখুন; লোকাল কেনাকাটায় “Cost head on the project” বেছে নিন। দিতে না চাইলে “Reject” চাপুন, কারণ লিখুন। কর্মী কারণটি দেখতে পান। হাজিরা ঠিক করার পর “Check again” চাপলে আবার মেলানো হয়।",
          image: {
            id: "hr-claims-3",
            caption: "“Change and approve” জানালা: অনুমোদনের টাকা, কারণ ও প্রজেক্টের খরচের খাত",
          },
        },
        {
          text: "লাল চিহ্ন ছাড়া মাসের সব দাবি একসঙ্গে দিতে “Approve all with nothing to check” চাপুন। চিহ্নিতগুলো একটি একটি করে দেখুন।",
        },
        {
          text: "অনুমোদিত টাকা কর্মীর পাওনা হয়ে “Owed to staff” তালিকায় থাকে। কাউকে টাকা দিতে তাঁর পাশে “Pay back” চাপুন, কোন অ্যাকাউন্ট থেকে দিলেন আর “Paid on” তারিখ দিয়ে “Record the payment” চাপুন। তাঁর সব পাওনা দাবি একসঙ্গে শোধ হয়।",
        },
      ],
      tips: [
        "প্রোডাকশন প্রজেক্টের জন্য কেনা মাল (যেমন সুতা) অনুমোদন হলেই সেই প্রজেক্টের খরচে যোগ হয়, আর কর্মীর পাওনায় ওঠে।",
        "কিলোমিটারপ্রতি স্বাভাবিক ভাড়া “Holidays & rules”-এ “Usual conveyance fare per km”-এ ঠিক করুন। একই পথের আগের অনুমোদিত দাবির সঙ্গেও মেলানো হয়।",
        "নিজের দাবি নিজে অনুমোদন বা শোধ করা যায় না। কর্মী চিহ্নগুলো দেখেন না, শুধু দাবির অবস্থা দেখেন।",
        "আলাদা করে ফেরত না দেওয়া অনুমোদিত দাবি মাসের বেতনের সঙ্গে চলে যায়। বেতন অনুমোদন হলে সেগুলো “Owed to staff” থেকে সরে যায়, আর বেতন পুরো দেওয়া হলে “Paid back” হয়। বেতনে থাকা দাবির খরচ বাতিল করতে আগে সেই মাসের বেতন “Reopen” করতে হয়।",
      ],
    },
    {
      slug: "hr-notices",
      title: "সব কর্মীর জন্য নোটিশ দেবেন ও কে পড়েছেন দেখবেন যেভাবে",
      summary:
        "নোটিশ বোর্ডে সবার জন্য নোটিশ দেওয়া (অফিস বন্ধ, নতুন নিয়ম, বোনাসের তারিখ), ওপরে পিন করা বা শেষ দিন ঠিক করা, আর কে পড়েছেন ও কে পড়েননি দেখা।",
      keywords: [
        "notices",
        "notice board",
        "post a notice",
        "announcement",
        "read receipt",
        "নোটিশ",
        "নোটিশ বোর্ড",
        "ঘোষণা",
        "কে পড়েছে",
      ],
      routes: ["/hr/notices"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে (শুরুতে Super Admin)।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Notices” ট্যাবে “Post a notice” চাপুন। “Title” ও “Notice” লিখুন। ওপরে রাখতে “Keep it at the top” টিক দিন, আর নির্দিষ্ট দিন পর্যন্ত দেখাতে “Show until (optional)” দিন। তারপর “Post the notice”।",
          image: {
            id: "hr-notices-1",
            caption: "“Post a notice” জানালা: শিরোনাম, নোটিশ, শেষ দিন ও পিন",
          },
        },
        {
          text: "login থাকা প্রত্যেক কর্মী ইনবক্সে নোটিশটি পান (ফোনে নোটিফিকেশন চালু হলে ফোনেও)। যাঁদের login নেই তাঁদের সংখ্যা ওপরে লেখা থাকে; তাঁদের অন্যভাবে জানান।",
        },
        {
          text: "প্রতিটি নোটিশের নিচে “Read by … of … staff”। নাম ও সময় দেখতে “Who has read it” খুলুন; ডান পাশে “Not read yet” তালিকা।",
          image: {
            id: "hr-notices-2",
            caption: "কে পড়েছেন ও কে এখনো পড়েননি",
          },
        },
        {
          text: "লেখা বদলাতে “Change”, সরিয়ে নিতে “Take down” চাপুন। সরানো নোটিশ “Ended or taken down”-এ থাকে, কে পড়েছিলেন সহ; আবার দেখাতে “Put back up”।",
        },
      ],
      tips: [
        "শেষ দিন পেরোলে নোটিশ নিজে থেকে কর্মীদের পাতা থেকে সরে যায়। আবার দেখাতে “Change” চেপে “Show until (optional)” বদলান।",
        "নোটিশ বদলালে কাউকে আবার জানানো হয় না; কর্মীরা “Changed” ও সময় দেখেন।",
      ],
    },
    {
      slug: "hr-leave",
      title: "ছুটি রেকর্ড ও অনুমোদন করবেন যেভাবে",
      summary:
        "কর্মীর ছুটি লেখা (সঙ্গে সঙ্গে অনুমোদিত বা অপেক্ষায়), ডাক্তারের কাগজ রাখা, আর আবেদন অনুমোদন, প্রত্যাখ্যান বা বাতিল করা।",
      keywords: [
        "leave",
        "record leave",
        "approve leave",
        "reject",
        "sick leave",
        "casual leave",
        "half day",
        "ছুটি",
        "ছুটির আবেদন",
        "অসুস্থতার ছুটি",
        "নৈমিত্তিক ছুটি",
        "ছুটি অনুমোদন",
      ],
      routes: ["/hr/leave/new", "/hr/leave"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে। নিজের ছুটি নিজে অনুমোদন করা যায় না (মালিক ছাড়া)।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Leave” ট্যাবে “Record leave” চাপুন।",
          image: {
            id: "hr-leave-1",
            caption: "“Record leave” ফর্ম: কর্মী, ছুটির ধরন, তারিখ ও কাগজ",
          },
        },
        {
          text: "“Employee”, “Leave type”, “First day” ও “Last day” দিন। অর্ধদিবস হলে “Half a day only” টিক দিন।",
        },
        {
          text: "“Reason (optional)” আর “Doctor's note or other paper (optional)”-এ কাগজের ছবি দিন। এখনই অনুমোদন দিতে “Approve it now” টিক রাখুন। “Record the leave” চাপুন।",
        },
        {
          text: "অপেক্ষায় থাকা আবেদন খুলে “Approve” (চাইলে নোটসহ) বা “Reject” (“Why”-তে কারণ) চাপুন। অনুমোদিত ছুটি বাতিল করতে “Cancel the leave”।",
          image: {
            id: "hr-leave-2",
            caption: "ছুটির আবেদনের পাতা: বরাদ্দ, নেওয়া, বাকি এবং “Approve” ও “Reject”",
          },
        },
      ],
      tips: [
        "আবেদনের পাতায় সেই ধরনের ছুটি কত বরাদ্দ (“Allowed”), কত নেওয়া (“Taken”) ও কত বাকি (“Left”) দেখায়।",
        "ছুটির মধ্যে সাপ্তাহিক ছুটি ও সরকারি ছুটি গোনা হয় না।",
        "কর্মীরা নিজেরাই My HR থেকে ছুটির আবেদন পাঠাতে পারেন।",
      ],
    },
    {
      slug: "hr-payroll-prepare",
      title: "মাসিক বেতন (Payroll) তৈরি করবেন যেভাবে",
      summary:
        "হাজিরা, ছুটি ও অগ্রিম থেকে মাসের বেতনের খসড়া বানানো, প্রত্যেকের ভাতা, বোনাস, কর্তন ও ওভারটাইম মিলিয়ে নেওয়া।",
      keywords: [
        "payroll",
        "prepare a payroll",
        "salary sheet",
        "bonus",
        "deductions",
        "overtime",
        "allowance",
        "বেতন",
        "বেতনের শিট",
        "স্যালারি",
        "বোনাস",
        "কর্তন",
        "ভাতা",
        "claims with salary",
        "দাবি বেতনের সঙ্গে",
      ],
      routes: ["/hr/payroll"],
      who: "যাঁদের বেতন তৈরির অনুমতি আছে: Super Admin ও Accounts।",
      anyOf: ["hr.payroll"],
      steps: [
        {
          text: "“HR & payroll” > “Payroll” ট্যাবে “Prepare a payroll” চাপুন। “Month” বেছে “Prepare” চাপুন।",
          image: {
            id: "hr-payroll-prepare-1",
            caption: "“Payroll” ট্যাবে মাসের তালিকা ও “Prepare a payroll”",
          },
        },
        {
          text: "খসড়ায় প্রত্যেকের “Days”, “Salary”, “Overtime, bonus, claims”, “Deductions” ও “Take home” দেখবেন। হিসাব আসে হাজিরা, ছুটি, অগ্রিম ও কর্মীর দাবি থেকে।",
          image: {
            id: "hr-payroll-prepare-2",
            caption: "বেতনের খসড়া: প্রত্যেক কর্মীর সারি ও মোট",
          },
        },
        {
          text: "হাতে পাওয়া বেতনের হিসাব: মূল বেতন + অনুমোদিত ওভারটাইম + দাবির টাকা − (অনুপস্থিতি + অগ্রিমের কিস্তি) = “Take home”। ভাতা, বোনাস, কর ও অন্য কর্তন থাকলে সেগুলোও যোগ-বিয়োগ হয়।",
        },
        {
          text: "মাসের শেষ দিন পর্যন্ত Accounts-এর অনুমোদিত, এখনো ফেরত না দেওয়া দাবি (যাতায়াত, লোকাল কেনাকাটা) নিজে থেকেই বেতনে যোগ হয়; সারিতে “claims” লেখা অঙ্কটি সেটাই। বেতন অনুমোদন হলে দাবিগুলো সেই বেতনের সঙ্গে বাঁধা পড়ে, তাই আলাদা করে আর ফেরত দিতে হয় না।",
        },
        {
          text: "কারও লাইন বদলাতে “Change” চাপুন। “Allowances”, “Bonus”, “Tax deducted (TDS)”, “Other deductions”, “Overtime hours”, “Advance taken back” ও “Note on the payslip (optional)” ঠিক করে “Save the line” চাপুন।",
        },
        {
          text: "সবার জন্য বোনাস দিতে “Add a bonus” চাপুন। “A share of each monthly salary” (শতাংশ) বা “The same amount for everyone” বেছে “Add the bonus” চাপুন।",
        },
        {
          text: "হাজিরা বা ছুটি বদলালে “Work it out again” চাপুন। খসড়া দরকার না হলে “Delete the draft”।",
        },
        {
          text: "মাসের কোনো ওভারটাইম HR-এর অনুমোদনের অপেক্ষায় থাকলে খসড়ার ওপরে তা লেখা থাকে। শুধু অনুমোদিত ওভারটাইমই বেতনে যায়; HR অনুমোদন দিলে “Work it out again” চাপুন। HR “See the overtime” চেপে সেগুলো খুলতে পারেন।",
        },
      ],
      tips: [
        "খসড়া তৈরির পর অন্য একজন (Super Admin) অনুমোদন দেন। পরের নির্দেশিকা দেখুন।",
        "বেতনের তালিকা বা মাসের পাতা খুললে টাকার অঙ্ক *** দেখায়, যাতে পাশের কেউ না দেখে। দেখতে ওপরের “Show amounts” চাপুন, আবার লুকাতে “Hide amounts”।",
      ],
    },
    {
      slug: "hr-payroll-approve-pay",
      title: "বেতন অনুমোদন ও পরিশোধ করবেন যেভাবে",
      summary:
        "দ্বিতীয় একজনের অনুমোদনে বেতন হিসাবের খাতায় তোলা, তারপর টিক দেওয়া কর্মীদের ক্যাশ, ব্যাংক বা ওয়ালেট থেকে পুরো বা আংশিক বেতন দেওয়া, দরকারে সরাসরি বিকাশ/নগদ/রকেটে পাঠানো।",
      keywords: [
        "approve payroll",
        "pay salaries",
        "salary payment",
        "reopen",
        "void",
        "বেতন অনুমোদন",
        "বেতন দেওয়া",
        "বেতন পরিশোধ",
        "স্যালারি পেমেন্ট",
        "part payment",
        "wallet payout",
        "bkash",
        "nagad",
        "আংশিক বেতন",
        "বিকাশে বেতন",
      ],
      routes: ["/hr/payroll"],
      who: "অনুমোদন: যাঁদের বেতন অনুমোদনের অনুমতি আছে (শুরুতে শুধু Super Admin)। পরিশোধ: Accounts ও Super Admin।",
      anyOf: ["hr.payroll.approve", "accounts.payments.record"],
      steps: [
        {
          text: "“Payroll” ট্যাবে “To approve” লেখা মাসটি খুলুন, হিসাব মিলিয়ে “Approve” চাপুন। বেতন হিসাবের খাতায় যাবে এবং সেই মাসের হাজিরা ও ছুটি আটকে যাবে।",
        },
        {
          text: "এরপর Accounts “Pay salaries” চাপবেন। “Paid now”-এ যাঁদের দিচ্ছেন তাঁদের টিক দিন; প্রত্যেকের পাশে বাকি টাকা লেখা থাকে। কোন ক্যাশ, ব্যাংক বা ওয়ালেট থেকে দেবেন আর “Paid on” তারিখ দিয়ে “Record the payment” চাপুন।",
          image: {
            id: "hr-payroll-approve-pay-1",
            caption: "“Pay salaries” জানালা: কর্মীদের টিকবক্স, প্রত্যেকের টাকা, অ্যাকাউন্ট ও তারিখ",
          },
        },
        {
          text: "এখন বেতনের একটা অংশ দিতে চাইলে সেই কর্মীর পাশের ঘরে কম টাকা লিখুন। বাকিটা পরে আবার “Pay salaries” থেকে দেবেন। সারিতে “Part paid” আর কত বাকি তা দেখায়; সবার বেতন পুরো শোধ হলে মাসটি “Paid” হয়।",
        },
        {
          text: "বিকাশ/নগদ যুক্ত থাকলে জানালায় “Send it to their wallets” দেখাবে। “How”-এ বিকাশ, নগদ বা রকেট বেছে এটি টিক দিলে অ্যাপ প্রত্যেকের ওয়ালেট নম্বরে টাকা পাঠায়। ওয়ালেট নম্বর না থাকলে আগে কর্মীর পাতায় যোগ করুন।",
        },
        {
          text: "“Salary payments”-এ প্রতিটি পরিশোধ থাকে, আর উপরে “Still to pay” দেখায় কত বাকি। ওয়ালেটে পাঠানো টাকার পাশে “Sent to wallet” বা “Wallet payout failed” লেখা থাকে; ব্যর্থ হলে “Try again” চাপুন। ভুল পরিশোধ “Void” করুন।",
        },
        {
          text: "অনুমোদিত বেতনে ভুল থাকলে আগে সব পরিশোধ বাতিল (Void) করুন, তারপর “Reopen” চাপুন। খসড়া আবার বদলানো যাবে।",
        },
      ],
      tips: [
        "যিনি বেতন তৈরি করেছেন, তাঁর বাইরে অন্য একজন অনুমোদন দেন, যাতে ভুল ধরা পড়ে।",
        "ওয়ালেটে আগেই চলে যাওয়া টাকা “Void” করলে ফেরত আসে না; সেটি কর্মীর কাছ থেকে নিজে চেয়ে নিন। ব্যর্থ পাঠানো অ্যাপ নিজে আবার চেষ্টা করে না, যাতে টাকা দুবার না যায়।",
        "ওয়ালেটে টাকা পাঠানো এখন পরীক্ষামূলক (test mode): কোনো টাকা সত্যি যায় না। আসল বিকাশ/নগদ যুক্ত হলে একই বোতামে কাজ করবে।",
      ],
    },
    {
      slug: "hr-payslip",
      title: "পে-স্লিপ ছাপবেন যেভাবে",
      summary: "কর্মীর মাসের আয়, কর্তন ও হাতে পাওয়া বেতনের পে-স্লিপ লেটারহেডে ছাপা।",
      keywords: [
        "payslip",
        "pay slip",
        "salary slip",
        "print",
        "pdf",
        "পে-স্লিপ",
        "বেতনের রসিদ",
        "স্যালারি স্লিপ",
        "ছাপা",
      ],
      routes: ["/hr/payroll"],
      who: "যাঁরা বেতন দেখতে পারেন: Super Admin ও Accounts। কর্মীরা নিজেরটা My HR থেকে ছাপেন।",
      anyOf: ["hr.manage", "hr.payroll", "accounts.view"],
      steps: [
        {
          text: "“Payroll” ট্যাবে মাস খুলে কর্মীর সারিতে চাপুন, বা কর্মীর পাতার “Payslips” থেকে মাস বেছে নিন।",
        },
        {
          text: "পে-স্লিপে “Earnings”, “Deductions” ও “Take-home pay” দেখাবে। খসড়া হলে উপরে লেখা থাকে যে অঙ্ক বদলাতে পারে।",
          image: {
            id: "hr-payslip-1",
            caption: "পে-স্লিপ: আয়, কর্তন ও হাতে পাওয়া বেতন, উপরে “PDF” ও “Print”",
          },
        },
        {
          text: "লেটারহেডে ছাপতে “PDF” চাপুন, অথবা ব্রাউজার দিয়ে ছাপতে “Print the payslip”।",
        },
        {
          text: "বেতন কয়েক ভাগে দেওয়া হলে পে-স্লিপের নিচে প্রতিটি ভাগ (তারিখ, কীভাবে, ভাউচার) আর কত বাকি লেখা থাকে। দাবির টাকা বেতনের সঙ্গে গেলে “Earnings”-এ দাবির নম্বরসহ আলাদা লাইন থাকে।",
        },
      ],
      tips: ["পে-স্লিপ ইমেইল বা WhatsApp-এ পাঠানো এখনো চালু হয়নি।"],
    },
    {
      slug: "hr-advances",
      title: "বেতনের অগ্রিম দেবেন ও কেটে নেবেন যেভাবে",
      summary:
        "কর্মীকে বেতনের আগে টাকা দেওয়া, একবারে বা মাসে মাসে বেতন থেকে কেটে নেওয়া, নগদ ফেরত নেওয়া আর পুরোনো অগ্রিম তোলা।",
      keywords: [
        "advance",
        "salary advance",
        "give an advance",
        "loan to employee",
        "money returned",
        "bring an advance forward",
        "অগ্রিম",
        "বেতনের অগ্রিম",
        "অ্যাডভান্স",
        "ধার",
        "কেটে নেওয়া",
      ],
      routes: ["/hr/advances/new", "/hr/advances"],
      who: "অগ্রিম দেন Accounts ও Super Admin। নগদ ফেরত নিতে টাকা গ্রহণের অনুমতি, পুরোনো অগ্রিম তুলতে হিসাব সামলানোর অনুমতি লাগে।",
      anyOf: ["accounts.payments.record", "accounts.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Advances” ট্যাবে “Give an advance” চাপুন (কর্মীর পাতা থেকেও যাওয়া যায়)।",
          image: {
            id: "hr-advances-1",
            caption: "“Give an advance” ফর্ম: কর্মী, পরিমাণ, অ্যাকাউন্ট ও কাটার নিয়ম",
          },
        },
        {
          text: "“Money paid out now” বেছে “Employee”, পরিমাণ, কোন অ্যাকাউন্ট থেকে, “Paid on” ও “What for (optional)” দিন। Extas ERP-এর আগে দেওয়া অগ্রিম হলে “Owed from before Extas ERP” বেছে নিন।",
        },
        {
          text: "কীভাবে কাটা হবে: “All at once” (একবারে) বা “So much a month” (মাসে কত)। “Starting with the payroll for”-এ কোন মাসের বেতন থেকে শুরু হবে দিন।",
        },
        { text: "“Pay the advance” (বা “Bring it forward”) চাপুন।" },
        {
          text: "অগ্রিমের পাতায় “Given”, “Taken back” ও “Still owed” দেখবেন। কাটার নিয়ম বদলাতে “Change how it is taken back”, নগদ ফেরত পেলে “Money returned” (“Returned on”, “Received into”), ভুল হলে “Void”।",
        },
      ],
      tips: [
        "বেতন তৈরির সময় অগ্রিম নিজে থেকেই “Advance taken back” লাইনে কাটা হয়।",
        "খরচের দাবি অনুমোদনের সময়ও কর্মীর অগ্রিম থেকে আগে কাটা যায়।",
      ],
    },
    {
      slug: "hr-holidays-rules",
      title: "ছুটির দিন, অফিসের সময় ও ছুটির ধরন ঠিক করবেন যেভাবে",
      summary:
        "সাপ্তাহিক ছুটি, অফিস শুরুর সময়, দেরির ছাড়, কয়টি দেরিতে এক দিনের বেতন কাটা, বছরের ছুটি আর ছুটির ধরন।",
      keywords: [
        "holidays",
        "rules",
        "weekly days off",
        "office starts",
        "grace",
        "late rule",
        "leave types",
        "self check-in",
        "সরকারি ছুটি",
        "সাপ্তাহিক ছুটি",
        "অফিস সময়",
        "দেরির নিয়ম",
        "ছুটির ধরন",
      ],
      routes: ["/hr/settings"],
      who: "দেখতে পারেন যাঁরা HR দেখেন। বদলাতে HR সামলানোর অনুমতি লাগে।",
      steps: [
        {
          text: "“HR & payroll” > “Holidays & rules” ট্যাব খুলুন।",
          image: {
            id: "hr-holidays-rules-1",
            caption: "“Holidays & rules” ট্যাব: কাজের সপ্তাহ, ছুটির তালিকা ও ছুটির ধরন",
          },
        },
        {
          text: "“Change the rules” চাপুন। “Weekly days off” (যেমন শুক্রবার), “Office starts at”, “Working day ends at” (এর পরে থাকা ওভারটাইম), “Minutes of grace” (কত মিনিট পর্যন্ত দেরি ধরা হবে না) ও “Lates that cost a day's salary” (কয়টি দেরিতে এক দিনের বেতন কাটা) দিন।",
        },
        {
          text: "কর্মীরা ফোন থেকে নিজে চেক-ইন করবেন চাইলে “Staff check in and out themselves” টিক দিন। চেক-আউট থেকে ওভারটাইম ধরতে “Find overtime from check-outs” টিক দিন, আর “Overtime counts after this many minutes”-এ লিখুন কত মিনিট থাকলে তবেই ওভারটাইম। যাতায়াতের দাবি মেলাতে “Usual conveyance fare per km”-এ কিলোমিটারপ্রতি স্বাভাবিক ভাড়া দিন (0 দিলে এই মিল বন্ধ)। “Save the rules” চাপুন।",
        },
        {
          text: "সরকারি বা কোম্পানির ছুটি যোগ করতে “Add holidays” চাপুন, “Day” ও “Name” দিন। একসঙ্গে কয়েক দিন দিতে “Another day”।",
        },
        {
          text: "ছুটির ধরন যোগ করতে “Add a leave type” চাপুন। নাম, “Days a year”, বেতনসহ কি না (“Paid leave”), আর মাঝবছরে যোগ দিলে আনুপাতিক বরাদ্দ (“Share out by the months worked”) ঠিক করুন। পুরোনো ধরন “Retire” করুন।",
        },
      ],
      tips: [
        "সাপ্তাহিক ছুটি বদলালে অনুমোদন হয়নি এমন মাসগুলোর ছুটির দিন আবার গোনা হয়।",
        "লোকেশনসহ হাজিরা ও “Work places” নিয়ে আলাদা নির্দেশিকা আছে: “লোকেশনসহ হাজিরা (GPS) চালু করবেন”।",
        "চেক-আউট থেকে পাওয়া ওভারটাইম “Overtime” ট্যাবে HR-এর অনুমোদনের অপেক্ষায় থাকে।",
      ],
    },
    {
      slug: "hr-data-vault",
      title: "কর্মীর ডেটা ভল্ট: অসম্পূর্ণ তথ্য, কাগজপত্র ও বেতনের হিসাব বদলের অনুমোদন",
      summary:
        "কার রেকর্ডে NID, রক্তের গ্রুপ, রেফারেন্স বা ব্যাংক/ওয়ালেটের তথ্য নেই তা দেখা, NID-ছবি-সনদ রাখা, আর কর্মীর ব্যাংক বা বিকাশ নম্বর বদলের আবেদন অনুমোদন করা।",
      keywords: [
        "data vault",
        "details missing",
        "staff records",
        "nid",
        "reference person",
        "pay details",
        "bank account",
        "bkash number",
        "add a paper",
        "approve the change",
        "ডেটা ভল্ট",
        "কাগজপত্র",
        "জাতীয় পরিচয়পত্র",
        "রেফারেন্স",
        "ব্যাংক হিসাব বদল",
        "বিকাশ নম্বর বদল",
      ],
      routes: ["/hr/employees", "/hr"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে: শুরুতে শুধু Super Admin, অথবা “HR Manager”-এর মতো নিজস্ব ভূমিকা।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Overview”-এর “Staff records” অংশে দেখবেন কার বেতনের হিসাব বদলের আবেদন অপেক্ষায় আছে, আর কয়জনের রেকর্ডে তথ্য বাকি। “Details missing” চাপলে শুধু তাঁদের তালিকা খুলবে।",
          image: {
            id: "hr-data-vault-1",
            caption:
              "“Overview”-এর “Staff records” অংশ: অনুমোদনের অপেক্ষায় থাকা আবেদন ও অসম্পূর্ণ রেকর্ড",
          },
        },
        {
          text: "“Employees” ট্যাবে “Details missing” টিক দিলেও একই তালিকা পাবেন। যাঁর রেকর্ড অসম্পূর্ণ, তাঁর নামের পাশে “Details missing” লেখা থাকে।",
        },
        {
          text: "কর্মীর পাতায় ডান দিকে “Data vault” অংশ। উপরে চারটি জিনিস: “National ID”, “Blood group”, “Reference person” ও “Bank or wallet details”। যা নেই তার নিচে লাল করে “Missing” লেখা থাকে, আর কোণে চারটির কয়টি পূরণ হয়েছে (সব থাকলে “Complete”)।",
          image: {
            id: "hr-data-vault-2",
            caption: "কর্মীর পাতার “Data vault”: কী আছে, কী নেই, আর কাগজপত্র",
          },
        },
        {
          text: "বাকি তথ্য নিজে দিতে “Change details” চাপুন। “Reference person (optional)”, “Reference phone (optional)” ও “How they know them (optional)” এখানে, আর ব্যাংকে বেতন হলে “Branch (optional)”। কর্মী নিজেও My HR থেকে দিতে পারেন।",
        },
        {
          text: "NID কার্ডের ছবি, কর্মীর ছবি, সনদ বা নিয়োগপত্র রাখতে “Papers”-এর নিচে “Add a paper” চাপুন। “What it is” বেছে নিন, চাইলে “Name (optional)” দিন, “Photo or PDF”-এ ফাইল বা ফোনের ক্যামেরার ছবি দিন, তারপর “Add the paper”। নাম চাপলে নতুন ট্যাবে খোলে; ভুল হলে পাশের মুছে ফেলার বোতাম।",
        },
        {
          text: "কর্মী My HR থেকে ব্যাংক বা বিকাশ/নগদ নম্বর বদলের আবেদন করলে পাতায় “Pay change to approve” আর “Data vault”-এ “Pay details change waiting” দেখাবে: “Now” (এখন যেখানে বেতন যায়) আর “Asked for” (নতুন)। নম্বরটি কর্মীর নিজের কি না যাচাই করে “Approve the change” চাপুন, না হলে “Turn down” চেপে “Why”-তে কারণ লিখুন।",
          image: {
            id: "hr-data-vault-3",
            caption:
              "“Pay details change waiting”: আগের ও নতুন হিসাব, “Approve the change” ও “Turn down”",
          },
        },
      ],
      tips: [
        "অনুমোদনের পর থেকেই নতুন হিসাবে বেতন যায়; আগে অনুমোদিত বেতন বদলায় না। কর্মী ইনবক্সে সিদ্ধান্ত ও কারণ জানতে পারেন।",
        "নিজের বেতনের হিসাব বদলের আবেদন নিজে অনুমোদন করা যায় না, আর “Change details”-এ নিজের ব্যাংক বা ওয়ালেট বদলানো যায় না; অন্য কেউ (বা Super Admin) করবেন।",
        "ভল্টের কাগজপত্র শুধু HR আর সেই কর্মী খুলতে পারেন। প্রতিটি যোগ, মোছা ও সিদ্ধান্ত কার্যকলাপের লগে থাকে।",
        "কর্মী চাকরির শর্তাবলিতে রাজি হলে স্বাক্ষরিত কপি (“Signed terms of employment”) অ্যাপ নিজেই কাগজপত্রে রাখে; এটি কেউ মুছতে পারেন না।",
      ],
    },
    {
      slug: "hr-terms",
      title: "চাকরির শর্তাবলি লিখবেন, প্রকাশ করবেন ও কে রাজি হয়েছেন দেখবেন যেভাবে",
      summary:
        "গোপনীয়তা, চুরিতে শূন্য সহনশীলতা, বেতন কর্তন ও চাকরি ছাড়ার নিয়মসহ শর্তাবলি লেখা ও প্রকাশ করা; লগইন থাকা প্রত্যেক কর্মী অ্যাপ ব্যবহারের আগে পুরোটা পড়ে সই বা SMS কোড দিয়ে রাজি হন, আর স্বাক্ষরিত PDF তাঁর কাগজপত্রে থাকে।",
      keywords: [
        "terms of employment",
        "terms",
        "agreement",
        "signature",
        "sms code",
        "publish",
        "who has agreed",
        "signed copy",
        "শর্তাবলি",
        "চাকরির শর্ত",
        "সই",
        "স্বাক্ষরিত কপি",
        "নিয়োগের নিয়ম",
      ],
      routes: ["/hr/terms"],
      who: "HR-এর যেকোনো অনুমতি থাকলে পড়া ও কে রাজি হয়েছেন দেখা যায়; লেখা ও প্রকাশ শুধু HR সামলানোর অনুমতি থাকলে (Super Admin বা “HR Manager”-এর মতো নিজস্ব ভূমিকা)।",
      anyOf: ["hr.view", "hr.manage", "hr.payroll"],
      steps: [
        {
          text: "“HR & payroll” > “Terms” ট্যাব খুলুন। প্রথমবার “No terms yet” লেখা থাকবে; “Start from the starter text” চাপলে বাংলা ও ইংরেজিতে চারটি অংশসহ একটি খসড়া তৈরি হয়: গোপনীয়তা, চুরিতে শূন্য সহনশীলতা, বেতন থেকে কর্তন ও চাকরি ছাড়ার নিয়ম।",
          image: {
            id: "hr-terms-1",
            caption: "“Terms” ট্যাব: “No terms yet” ও “Start from the starter text”",
          },
        },
        {
          text: "খসড়ায় “Title”, “Opening note (optional)” আর প্রতিটি অংশের “Heading” ও “Text” নিজের মতো বদলান। অনুচ্ছেদের মাঝে একটি ফাঁকা লাইন রাখুন। নতুন অংশ যোগ করতে “Add a section”, ক্রম বদলাতে উপর-নিচের তীর, মুছতে ময়লার ঝুড়ি। কাজ রেখে দিতে “Save the draft”।",
          image: {
            id: "hr-terms-2",
            caption: "শর্তাবলির খসড়া: শিরোনাম, অংশগুলো, “Save the draft” ও “Publish”",
          },
        },
        {
          text: "কর্মীরা খসড়া দেখতে পান না। প্রকাশের আগে একজন আইনজীবীকে দিয়ে লেখাটি দেখিয়ে নিন। তারপর “Publish” চাপুন। প্রথম সংস্করণে লগইন থাকা সবাইকে রাজি হতে হয়, আর অ্যাপে জানানো হয়।",
        },
        {
          text: "প্রকাশের পর কর্মী অ্যাপ খুললেই আগে শর্তাবলির পাতা আসে। পুরোটা নিচ পর্যন্ত পড়লে তবেই সই করা যায়; আঙুল দিয়ে সই করেন, অথবা SMS চালু থাকলে ফোনে পাঠানো কোড দেন। রাজি না হওয়া পর্যন্ত অ্যাপের অন্য কিছু খোলে না।",
        },
        {
          text: "ডান দিকের “Who has agreed” তালিকায় প্রত্যেক কর্মীর পাশে “Agreed”, “To agree” বা “No login” লেখা থাকে; রাজি হলে কোন সংস্করণে, কবে ও কীভাবে। “Signed copy” চাপলে স্বাক্ষরিত PDF খোলে।",
          image: {
            id: "hr-terms-3",
            caption: "“Who has agreed”: কে রাজি হয়েছেন, কে বাকি, আর “Signed copy”",
          },
        },
        {
          text: "শর্ত বদলাতে “Start version …” বোতাম চাপুন (যেমন Start version 2), লেখা বদলে “Publish” চাপুন। ছোটখাটো বানান ঠিক করলে “Everyone agrees again” থেকে টিক তুলে দিন, তখন শুধু যাঁরা কখনো রাজি হননি তাঁদের জিজ্ঞেস করা হয়; আসল পরিবর্তনে টিক রাখুন, সবাই আবার পড়ে রাজি হবেন। আগের লেখা “Earlier versions”-এ থাকে।",
        },
      ],
      tips: [
        "স্বাক্ষরিত PDF-এ কর্মীর নাম, কোড, NID, সময়, IP ঠিকানা, ডিভাইস, সই আর লেখার “আঙুলের ছাপ” (SHA-256) থাকে, আর ফাইলটি এডিট করা যায় না। এটি কর্মীর কাগজপত্রে থাকে।",
        "PDF তৈরি হয় পেছনে, কয়েক সেকেন্ডে। কোনো কারণে না হলে তালিকায় লাল লেখা ও “Make it again” বোতাম আসে।",
        "প্রকাশিত সংস্করণ আর বদলানো যায় না; যেকোনো বদল নতুন সংস্করণ হয়। মালিক বা অন্য প্রধানদেরও লগইনে কর্মীর রেকর্ড যুক্ত থাকলে রাজি হতে হয়।",
      ],
    },
    {
      slug: "hr-outside-services",
      title:
        "বাইরের সেবা (SMS, ফোন নোটিফিকেশন, বিকাশ/নগদ, Google Maps) কোন অবস্থায় আছে দেখবেন যেভাবে",
      summary:
        "SMS কোড, ফোনে নোটিফিকেশন, ওয়ালেটে বেতন পাঠানো আর ম্যাপ চালু আছে, পরীক্ষা মোডে আছে, নাকি বন্ধ তা দেখা।",
      keywords: [
        "outside services",
        "integrations",
        "sms",
        "otp",
        "push notifications",
        "bkash payout",
        "nagad",
        "google maps",
        "বাইরের সেবা",
        "এসএমএস",
        "নোটিফিকেশন",
        "ম্যাপ",
      ],
      routes: ["/hr/settings"],
      who: "যাঁদের HR সামলানোর অনুমতি আছে।",
      anyOf: ["hr.manage"],
      steps: [
        {
          text: "“HR & payroll” > “Holidays & rules” ট্যাবের নিচে “Outside services” অংশ খুলুন।",
          image: {
            id: "hr-outside-services-1",
            caption: "“Outside services”: SMS, ফোন নোটিফিকেশন, বিকাশ/নগদ ও Google Maps-এর অবস্থা",
          },
        },
        {
          text: "প্রতিটির পাশে অবস্থা: “Off” (বন্ধ), “Test mode” (কিছু পাঠানো হয় না, শুধু সার্ভারের লগে লেখা থাকে) বা “Connected” (চালু)। বন্ধ থাকলে ততদিন কী হয় তাও লেখা থাকে, যেমন SMS না থাকলে কর্মীরা আঙুলে আঁকা সই দেন।",
        },
        {
          text: "চালু করতে সার্ভারের সেটিংসে এর চাবিগুলো (“Server settings”-এ লেখা নাম) বসাতে হয়। এটি আপনার সার্ভার দেখাশোনা করেন যিনি, তিনি করবেন (deploy/README.md-এর “Outside services”)। এই পাতা থেকে কিছু বদলানো যায় না।",
        },
      ],
      tips: [
        "“Setting to fix” লেখা থাকলে সেটিং দেওয়া আছে কিন্তু ভুল; লেখাটি সার্ভার দেখাশোনাকারীকে দেখান।",
        "এসব ছাড়াও পুরো অ্যাপ চলে; চালু হলে কোনো কিছু নতুন করে শিখতে হয় না।",
      ],
    },
  ],
};
