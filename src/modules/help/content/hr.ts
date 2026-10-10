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
          text: "“The person” অংশে “Full name”, ফোন, WhatsApp, ইমেইল, “National ID (optional)”, জন্মতারিখ, রক্তের গ্রুপ, ঠিকানা ও “Emergency contact (optional)” দিন। কোড ফাঁকা রাখলে পরের কোড (যেমন EMP-0012) নিজে থেকে বসবে।",
        },
        {
          text: "“The job” অংশে “Post (optional)” (যেমন Sewing operator), “Department (optional)” ও “Joined on” দিন। বেতন ও ছুটি এই দিন থেকে গোনা হয়।",
        },
        {
          text: "“Pay” অংশে “Monthly salary” (যোগদানের দিন থেকে মোট বেতন), “Overtime pay per hour (optional)” (ফাঁকা রাখলে ওভারটাইম দেওয়া হয় না) আর “Salary paid by” (ক্যাশ, ব্যাংক বা ওয়ালেট, সঙ্গে নম্বর) দিন।",
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
        "কর্মীর তথ্য ও বেতন বদলানো, ছুটির বরাদ্দ ঠিক করা, চাকরি ছাড়ার দিন লেখা, আবার ফিরিয়ে নেওয়া আর হিসাবের স্টেটমেন্ট দেখা।",
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
          text: "কেউ চলে গেলে “Record leaving” চাপুন। “They resigned” বা “Their job was ended” বেছে “Last working day” দিন। ভুল হলে বা ফিরে এলে “Reinstate”।",
        },
        {
          text: "“Statement”-এ কর্মীর অগ্রিমের দেনা (“Owes on advances”) আর বাকি বেতন (“Salary still to pay them”) সহ প্রতিটি লেনদেন দেখা যায়।",
        },
      ],
      tips: [
        "ভুল করে যোগ করা কর্মী (যাঁর কোনো হাজিরা, ছুটি, বেতন বা অগ্রিম নেই) “Remove” দিয়ে মোছা যায়। এটি আর ফেরানো যায় না।",
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
        { text: "সবশেষে একবার “Save the register” চাপুন।" },
        {
          text: "মাসের হিসাব দেখতে “The month in figures” চাপুন। প্রত্যেকের কাজের দিন, উপস্থিত, দেরি, অনুপস্থিত, ছুটি ও ওভারটাইম, যা বেতনে ব্যবহার হয়।",
        },
      ],
      tips: [
        "বেতন অনুমোদিত হয়ে গেলে সেই মাসের হাজিরা আর বদলানো যায় না।",
        "কর্মীরা নিজে চেক-ইন করবেন কি না তা “Holidays & rules”-এ ঠিক করা হয়।",
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
          text: "খসড়ায় প্রত্যেকের “Days”, “Salary”, “Overtime, bonus”, “Gross”, “Deductions” ও “Take home” দেখবেন। হিসাব আসে হাজিরা, ছুটি ও অগ্রিম থেকে।",
          image: {
            id: "hr-payroll-prepare-2",
            caption: "বেতনের খসড়া: প্রত্যেক কর্মীর সারি ও মোট",
          },
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
      ],
      tips: ["খসড়া তৈরির পর অন্য একজন (Super Admin) অনুমোদন দেন। পরের নির্দেশিকা দেখুন।"],
    },
    {
      slug: "hr-payroll-approve-pay",
      title: "বেতন অনুমোদন ও পরিশোধ করবেন যেভাবে",
      summary:
        "দ্বিতীয় একজনের অনুমোদনে বেতন হিসাবের খাতায় তোলা, তারপর টিক দেওয়া কর্মীদের ক্যাশ, ব্যাংক বা ওয়ালেট থেকে বেতন দেওয়া।",
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
      ],
      routes: ["/hr/payroll"],
      who: "অনুমোদন: যাঁদের বেতন অনুমোদনের অনুমতি আছে (শুরুতে শুধু Super Admin)। পরিশোধ: Accounts ও Super Admin।",
      anyOf: ["hr.payroll.approve", "accounts.payments.record"],
      steps: [
        {
          text: "“Payroll” ট্যাবে “To approve” লেখা মাসটি খুলুন, হিসাব মিলিয়ে “Approve” চাপুন। বেতন হিসাবের খাতায় যাবে এবং সেই মাসের হাজিরা ও ছুটি আটকে যাবে।",
        },
        {
          text: "এরপর Accounts “Pay salaries” চাপবেন। কোন ক্যাশ, ব্যাংক বা ওয়ালেট থেকে দেবেন, “Paid on” তারিখ দিন এবং যাঁদের দিচ্ছেন তাঁদের টিক দিন। “Record the payment” চাপুন।",
          image: {
            id: "hr-payroll-approve-pay-1",
            caption: "“Pay salaries” জানালা: অ্যাকাউন্ট, তারিখ ও কর্মীদের টিকবক্স",
          },
        },
        {
          text: "“Salary payments”-এ প্রতিটি পরিশোধ থাকে, আর উপরে “Still to pay” দেখায় কত বাকি। ভুল পরিশোধ “Void” করুন।",
        },
        {
          text: "অনুমোদিত বেতনে ভুল থাকলে আগে সব পরিশোধ বাতিল (Void) করুন, তারপর “Reopen” চাপুন। খসড়া আবার বদলানো যাবে।",
        },
      ],
      tips: ["যিনি বেতন তৈরি করেছেন, তাঁর বাইরে অন্য একজন অনুমোদন দেন, যাতে ভুল ধরা পড়ে।"],
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
          text: "“Change the rules” চাপুন। “Weekly days off” (যেমন শুক্রবার), “Office starts at”, “Minutes of grace” (কত মিনিট পর্যন্ত দেরি ধরা হবে না) ও “Lates that cost a day's salary” (কয়টি দেরিতে এক দিনের বেতন কাটা) দিন।",
        },
        {
          text: "কর্মীরা ফোন থেকে নিজে চেক-ইন করবেন চাইলে “Staff check in and out themselves” টিক দিন। “Save the rules” চাপুন।",
        },
        {
          text: "সরকারি বা কোম্পানির ছুটি যোগ করতে “Add holidays” চাপুন, “Day” ও “Name” দিন। একসঙ্গে কয়েক দিন দিতে “Another day”।",
        },
        {
          text: "ছুটির ধরন যোগ করতে “Add a leave type” চাপুন। নাম, “Days a year”, বেতনসহ কি না (“Paid leave”), আর মাঝবছরে যোগ দিলে আনুপাতিক বরাদ্দ (“Share out by the months worked”) ঠিক করুন। পুরোনো ধরন “Retire” করুন।",
        },
      ],
      tips: ["সাপ্তাহিক ছুটি বদলালে অনুমোদন হয়নি এমন মাসগুলোর ছুটির দিন আবার গোনা হয়।"],
    },
  ],
};
