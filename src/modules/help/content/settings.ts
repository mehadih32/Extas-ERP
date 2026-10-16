import { GUIDE_ERRORS, GUIDE_PARTS } from "@/modules/backups/restore-guide";

import type { HelpSection, HelpStep } from "../types";

/**
 * The restore guide's steps (the same words as its PDF, in Bengali): each
 * step's number, title and action, and what to watch for.
 */
const newServerSteps: HelpStep[] = GUIDE_PARTS.flatMap((part) =>
  part.steps.map((step) => ({
    text: `${step.id}. ${step.title.bn}: ${step.text.bn}${step.tip ? ` খেয়াল রাখুন: ${step.tip.bn}` : ""}`,
  })),
);

/** The restore command's errors and notes, one tip each. */
const newServerErrors = GUIDE_ERRORS.map(
  (error) => `${error.code}: ${error.meaning.bn} যা করবেন: ${error.todo.bn}`,
);

/** Settings: the team, roles and permissions, and the company's details and rules. */
export const settingsHelp: HelpSection = {
  id: "settings",
  title: "সেটিংস (Settings)",
  description:
    "কর্মীদের অ্যাকাউন্ট, ভূমিকা ও অনুমতি, আর কোম্পানির তথ্য, লেটারহেড ও ব্যবসার নিয়ম। সাধারণত শুধু Super Admin এখানে কাজ করেন।",
  href: "/settings",
  articles: [
    {
      slug: "settings-add-person",
      title: "নতুন কর্মীকে অ্যাপে যোগ করবেন যেভাবে",
      summary:
        "কারও ইমেইল, নাম ও ভূমিকা দিয়ে অ্যাকাউন্ট খোলা এবং অস্থায়ী পাসওয়ার্ড তাঁকে বুঝিয়ে দেওয়া।",
      keywords: [
        "team",
        "add a person",
        "new user",
        "member",
        "invite",
        "temporary password",
        "কর্মী যোগ",
        "নতুন ব্যবহারকারী",
        "অ্যাকাউন্ট খোলা",
        "ইউজার",
        "টিম",
      ],
      routes: ["/settings/team"],
      who: "যাঁদের দল সামলানোর অনুমতি (company.members.manage) আছে, সাধারণত Super Admin।",
      steps: [
        {
          text: "মেনু থেকে “Settings” খুলুন, তারপর “Team” ট্যাবে যান।",
          image: {
            id: "settings-add-person-1",
            caption: "“Team” ট্যাব: সবার তালিকা, খোঁজার ঘর ও “Add a person” বোতাম",
          },
        },
        { text: "“Add a person” বোতামে চাপুন।" },
        {
          text: "“Full name”, “Email”, দরকার হলে “Phone (optional)” লিখুন এবং “Role” থেকে তাঁর ভূমিকা বেছে নিন (যেমন Sales Executive)।",
          image: {
            id: "settings-add-person-2",
            caption: "“Add a person” জানালা: “Full name”, “Email”, “Phone (optional)” ও “Role”",
          },
        },
        {
          text: "রোল সামলানোর অনুমতি থাকলে বোতামে লেখা থাকবে “Next: permissions”। চাপলে “Full disclosure permission matrix” খোলে: সব অনুমতি বিভাগ অনুযায়ী গাছের মতো সাজানো, বেছে নেওয়া ভূমিকার গুলো টিক দেওয়া। পুরো বিভাগ দিতে বা সরাতে তার বক্সে চাপুন, কিছু অংশ বাছতে তীর চেপে বিভাগটি খুলুন। যা তিনি দেখবেন না তার টিক তুলে দিন, বাড়তি কিছু দিতে টিক দিন। “Back” চাপলে আগের ঘরগুলোতে ফেরা যায়।",
          image: {
            id: "settings-add-person-4",
            caption: "নতুন কর্মীর “Full disclosure permission matrix”: বিভাগ অনুযায়ী অনুমতির গাছ",
          },
        },
        {
          text: "“Add to the team” চাপুন। “Added to the team” জানালায় একটি “Temporary password” দেখাবে। এটি শুধু একবারই দেখা যায়।",
          image: {
            id: "settings-add-person-3",
            caption:
              "“Added to the team” জানালায় অস্থায়ী পাসওয়ার্ড ও “Copy sign-in details” বোতাম",
          },
        },
        {
          text: "“Copy sign-in details” চাপুন এবং ইমেইল ও পাসওয়ার্ড নিরাপদে নতুন কর্মীকে দিন। তারপর “Done” চাপুন।",
        },
        {
          text: "নতুন কর্মী প্রথমবার সাইন ইন করলে নিজের পাসওয়ার্ড ঠিক করে নেবেন।",
        },
      ],
      tips: [
        "অস্থায়ী পাসওয়ার্ড ইমেইল বা WhatsApp-এ নিজে থেকে পাঠানো এখনো চালু হয়নি। আপাতত নিজে হাতে দিন।",
        "একই ইমেইল দিয়ে একজন মানুষ একাধিক কোম্পানিতে কাজ করতে পারেন।",
        "যে Super Admin নন, তিনি কাউকে Super Admin ভূমিকা দিতে পারেন না।",
      ],
    },
    {
      slug: "settings-manage-member",
      title: "কর্মীর ভূমিকা বদলাবেন, পাসওয়ার্ড রিসেট বা বন্ধ করবেন যেভাবে",
      summary:
        "কারও ভূমিকা বদলানো, পাসওয়ার্ড ভুলে গেলে নতুন অস্থায়ী পাসওয়ার্ড দেওয়া, আর চাকরি ছাড়লে অ্যাকাউন্ট বন্ধ বা আবার চালু করা।",
      keywords: [
        "change role",
        "reset password",
        "deactivate",
        "reactivate",
        "forgot password",
        "ভূমিকা বদল",
        "পাসওয়ার্ড রিসেট",
        "অ্যাকাউন্ট বন্ধ",
        "নিষ্ক্রিয়",
        "আবার চালু",
      ],
      routes: ["/settings/team"],
      who: "যাঁদের দল সামলানোর অনুমতি আছে, সাধারণত Super Admin।",
      steps: [
        {
          text: "“Settings” > “Team” ট্যাব খুলুন। খোঁজার ঘরে নাম, ইমেইল, ফোন বা ভূমিকা লিখে মানুষটিকে খুঁজুন।",
        },
        {
          text: "তাঁর সারির ডান পাশে তিন-বিন্দুর বোতামে চাপুন। মেনুতে “Change role”, “Edit permissions”, “Reset password” ও “Deactivate” পাবেন।",
          image: {
            id: "settings-manage-member-1",
            caption:
              "কর্মীর সারিতে তিন-বিন্দুর মেনু খোলা: “Change role”, “Reset password”, “Deactivate”",
          },
        },
        {
          text: "ভূমিকা বদলাতে “Change role” চাপুন। “Role” থেকে নতুন ভূমিকা বেছে নিন; নিচে সেই ভূমিকার সব অনুমতি টিক দেওয়া দেখাবে। দরকার হলে বদলে “Save role and permissions” চাপুন। নতুন ভূমিকা সবসময় নিজের অনুমতিগুলো দিয়েই শুরু হয়।",
        },
        {
          text: "কেউ পাসওয়ার্ড ভুলে গেলে “Reset password” চাপুন এবং নিশ্চিত করুন। তিনি সব জায়গা থেকে সাইন আউট হবেন এবং নতুন অস্থায়ী পাসওয়ার্ড দেখাবে, যা তাঁকে দিতে হবে।",
        },
        {
          text: "কেউ চাকরি ছাড়লে “Deactivate” চাপুন এবং নিশ্চিত করুন। তিনি সঙ্গে সঙ্গে আর ঢুকতে পারবেন না, তবে তাঁর সব রেকর্ড থেকে যাবে।",
        },
        {
          text: "বন্ধ অ্যাকাউন্ট দেখতে উপরে “Deactivated” বাছুন। আবার চালু করতে তাঁর মেনু থেকে “Reactivate” চাপুন।",
        },
      ],
      tips: [
        "নিজেকে বন্ধ বা রিসেট করা যায় না। নিজের পাসওয়ার্ড অ্যাকাউন্ট মেনুর “Change password” থেকে বদলান।",
        "কোম্পানিতে সবসময় অন্তত একজন সক্রিয় Super Admin থাকতে হয়, তাই শেষ Super Admin-কে বন্ধ করা যায় না।",
        "মেনুতে শুধু সেই কাজগুলোই দেখায় যা আপনি ওই মানুষটির জন্য করতে পারেন।",
      ],
    },
    {
      slug: "settings-member-permissions",
      title: "একজন কর্মীর অনুমতি আলাদা করে ঠিক করবেন যেভাবে (Permission matrix)",
      summary:
        "ভূমিকার বাইরে একজনকে বাড়তি কিছু দেওয়া বা কিছু লুকিয়ে রাখা: সব অনুমতি বিভাগ > উপবিভাগ > কাজ হিসেবে টিক বক্সসহ এক জানালায়।",
      keywords: [
        "permission matrix",
        "edit permissions",
        "permissions",
        "hide",
        "access",
        "অনুমতি",
        "লুকানো",
        "টিক",
        "পারমিশন",
      ],
      routes: ["/settings/team"],
      who: "যাঁদের দল ও ভূমিকা দুটোই সামলানোর অনুমতি (company.members.manage ও company.roles.manage) আছে, সাধারণত Super Admin।",
      steps: [
        {
          text: "“Settings” > “Team” খুলুন। কর্মীর ভূমিকার নামের পাশের ⚙ চাপুন (তিন-বিন্দুর মেনুতে “Edit permissions”-ও আছে)।",
          image: {
            id: "settings-member-permissions-1",
            caption: "ভূমিকার পাশে ⚙ আর পরিবর্তন থাকলে “+2 −1” চিহ্ন",
          },
        },
        {
          text: "“Full disclosure permission matrix” জানালায় অ্যাপের সব অনুমতি গাছের মতো সাজানো: প্রধান বিভাগ (যেমন “Production”), তার ভেতরে উপবিভাগ (যেমন “Bookings”), তার ভেতরে আরও ছোট ভাগ (যেমন “Add bookings”), আর একেবারে ভেতরে আলাদা কাজ (যেমন “Ready stock (market purchase)”)। টিক দেওয়া মানে তিনি সেটি দেখতে ও করতে পারবেন; টিক না থাকলে সেই অংশ তাঁর কাছ থেকে লুকানো থাকবে।",
          image: {
            id: "settings-member-permissions-2",
            caption: "অনুমতির গাছ: বিভাগ, উপবিভাগ ও কাজ, “Added” ও “Taken away” চিহ্ন",
          },
        },
        {
          text: "পুরো বিভাগ দিতে বিভাগের নামে বা তার বক্সে চাপুন: ভেতরের সব একসাথে টিক হয়, আবার চাপলে সব উঠে যায়। শুধু কিছু অংশ দিতে নামের বাঁ পাশের তীর চেপে বিভাগটি খুলুন, তারপর দরকারি উপবিভাগ বা কাজে টিক দিন। বক্সে টিক মানে সবটা দেওয়া, ড্যাশ (–) মানে কিছু অংশ দেওয়া, ফাঁকা মানে কিছুই না; ডান পাশে লেখা থাকে কতটির মধ্যে কতটি দেওয়া।",
        },
        {
          text: "খুঁজতে উপরের ঘরে লিখুন (যেমন booking, payroll): মিলে যাওয়া কাজগুলো তাদের বিভাগসহ খোলা অবস্থায় দেখায়। সব বিভাগ একবারে খুলতে “Open all”, বন্ধ করতে “Close all”, ভূমিকায় ফিরতে “As the role gives” চাপুন। ভূমিকার বাইরে দেওয়া অনুমতিতে “Added”, আর ভূমিকা থেকে সরানোটিতে “Taken away” লেখা থাকে; বন্ধ বিভাগের নামের নিচেও কয়টি বদলেছে লেখা থাকে।",
        },
        {
          text: "শেষে “Save permissions” চাপুন। পরের ক্লিক থেকেই তিনি শুধু টিক দেওয়া জিনিসগুলো দেখবেন; মেনু থেকেও বাকিগুলো সরে যাবে।",
        },
      ],
      tips: [
        "Super Admin সবসময় সব অনুমতি পান; তাঁদের বক্স বদলানো যায় না।",
        "নিজের অনুমতি নিজে বদলানো যায় না, অন্য একজন অ্যাডমিনকে বলুন।",
        "ভূমিকা বদলালে আগের আলাদা পরিবর্তনগুলো মুছে নতুন ভূমিকার অনুমতি দিয়ে শুরু হয়।",
        "শুধু দল সামলানোর অনুমতি থাকলে জানালাটি দেখা যায়, কিন্তু বক্স বদলানো যায় না।",
      ],
    },
    {
      slug: "settings-new-role",
      title: "নতুন ভূমিকা (Role) তৈরি করবেন যেভাবে",
      summary: "যেমন “HR Manager” বা “Store Keeper”, নিজের মতো অনুমতি বেছে নতুন ভূমিকা বানানো।",
      keywords: [
        "role",
        "new role",
        "permission",
        "rbac",
        "access",
        "custom role",
        "ভূমিকা",
        "অনুমতি",
        "নতুন রোল",
        "রোল",
        "প্রবেশাধিকার",
      ],
      routes: ["/settings/roles", "/settings/roles/new"],
      who: "যাঁদের ভূমিকা সামলানোর অনুমতি (company.roles.manage) আছে, সাধারণত Super Admin।",
      steps: [
        {
          text: "“Settings” > “Roles” ট্যাবে যান। এখানে আগে থেকে থাকা (“Built-in”) ও নিজেদের বানানো (“Custom”) সব ভূমিকা দেখবেন।",
          image: {
            id: "settings-new-role-1",
            caption: "“Roles” ট্যাবে ভূমিকার কার্ডগুলো ও “New role” বোতাম",
          },
        },
        { text: "“New role” বোতামে চাপুন।" },
        {
          text: "“Name”-এ ভূমিকার নাম লিখুন, চাইলে “What it is for (optional)”-এ কাজের বর্ণনা।",
        },
        {
          text: "অন্য কোনো ভূমিকার অনুমতি দিয়ে শুরু করতে “Start from” থেকে সেটি বেছে নিন, ফাঁকা থেকে শুরু করতে “No permissions”।",
        },
        {
          text: "নিচের অনুমতির গাছে বিভাগ অনুযায়ী (যেমন “Sales”, “Accounts”, “HR and payroll”) টিক দিন বা টিক তুলে দিন। পুরো বিভাগ দিতে বিভাগের বক্সে টিক দিন; শুধু কিছু দিতে নামের বাঁ পাশের তীর চেপে খুলুন, তারপর ভেতরের উপবিভাগ বা কাজগুলো বেছে নিন। যেমন “Production” > “Bookings” > “Add bookings” > “Ready stock (market purchase)”।",
          image: {
            id: "settings-new-role-2",
            caption: "বিভাগ অনুযায়ী অনুমতির গাছ, “Money” চিহ্ন ও “Open all”",
          },
        },
        {
          text: "“Create role” চাপুন। তারপর “Team” ট্যাব থেকে কর্মীদের এই ভূমিকা দিন।",
        },
      ],
      tips: [
        "“Money” চিহ্নিত অনুমতি (টাকা গ্রহণ বা পরিশোধ রেকর্ড) Accounts ছাড়া অন্য ভূমিকায় দিলে সতর্কবার্তা আসবে। নিয়ম হলো শুধু Accounts ও Super Admin টাকার হিসাব রেকর্ড করেন।",
        "একজন কর্মীর একটি কোম্পানিতে একটিই ভূমিকা থাকে।",
      ],
    },
    {
      slug: "settings-edit-role",
      title: "ভূমিকার অনুমতি বদলাবেন বা ভূমিকা মুছবেন যেভাবে",
      summary: "কোনো ভূমিকার অনুমতি বাড়ানো-কমানো, আর অব্যবহৃত ভূমিকা মুছে ফেলা।",
      keywords: [
        "edit role",
        "change permissions",
        "delete role",
        "built-in role",
        "super admin",
        "অনুমতি বদল",
        "ভূমিকা মুছুন",
        "রোল এডিট",
      ],
      routes: ["/settings/roles"],
      who: "যাঁদের ভূমিকা সামলানোর অনুমতি আছে। যাঁদের শুধু দল সামলানোর অনুমতি আছে, তাঁরা ভূমিকা শুধু দেখতে পারেন।",
      steps: [
        {
          text: "“Settings” > “Roles” ট্যাবে ভূমিকার কার্ডে চাপুন। কার্ডে লেখা থাকে কতজন এই ভূমিকায় আছেন (“People”) এবং কয়টি অনুমতি (“Permissions”)।",
        },
        {
          text: "অনুমতির টিক বদলান। নিচের বারে লেখা থাকে মোট কয়টি অনুমতি বাছা হয়েছে। “Save changes” চাপলে এই ভূমিকার সবার জন্য সঙ্গে সঙ্গে বদলে যাবে।",
          image: {
            id: "settings-edit-role-1",
            caption: "ভূমিকার পাতায় অনুমতির তালিকা ও নিচের “Save changes” বোতাম",
          },
        },
        {
          text: "নিজেদের বানানো কোনো ভূমিকা আর না লাগলে “Delete” চাপুন এবং “Delete role” দিয়ে নিশ্চিত করুন।",
        },
      ],
      tips: [
        "আগে থেকে থাকা (Built-in) ভূমিকার নাম বদলানো বা মোছা যায় না। Super Admin-এর সবসময় সব অনুমতি থাকে।",
        "কেউ এই ভূমিকায় থাকলে সেটি মোছা যায় না। আগে তাঁদের অন্য ভূমিকা দিন।",
      ],
    },
    {
      slug: "settings-company-details",
      title: "কোম্পানির তথ্য ও লেটারহেড ঠিক করবেন যেভাবে",
      summary:
        "কোম্পানির নাম, ঠিকানা, ফোন, লোগো, রং ও ফুটার, যা প্রতিটি কোটেশন, ইনভয়েস ও স্টেটমেন্টে ছাপা হয়।",
      keywords: [
        "company",
        "company details",
        "letterhead",
        "logo",
        "address",
        "footer",
        "colour",
        "কোম্পানির তথ্য",
        "লোগো",
        "লেটারহেড",
        "ঠিকানা",
        "প্যাড",
      ],
      routes: ["/settings/company"],
      who: "যাঁদের কোম্পানির সেটিংস বদলানোর অনুমতি (company.settings) আছে, সাধারণত Super Admin।",
      anyOf: ["company.settings"],
      steps: [
        {
          text: "“Settings” > “Company” ট্যাব খুলুন।",
          image: {
            id: "settings-company-details-1",
            caption: "“Company” ট্যাবে “Company details” ও “Letterhead” অংশ",
          },
        },
        {
          text: "“Company details” অংশে “Name”, “Legal name (optional)”, “Phone”, “Email”, “Website” ও “Address” লিখুন, তারপর “Save” চাপুন।",
        },
        {
          text: "“Letterhead” অংশে লোগো দিতে “Upload logo” চাপুন (বদলাতে “Replace logo”, সরাতে “Remove”)।",
        },
        {
          text: "“Main colour” ও “Accent colour” বেছে নিন এবং “Footer”-এ পাতার নিচে ছাপার লেখা দিন। “Save” চাপুন।",
          image: {
            id: "settings-company-details-2",
            caption: "“Letterhead” অংশ: লোগো, “Main colour”, “Accent colour” ও “Footer”",
          },
        },
        {
          text: "একই অংশে “Tagline”: বুকিং বুক ও বুকিংয়ের PDF-এর হেডারে কোম্পানির নামের নিচে ছাপা হয় (খালি রাখলে “Manufacturing | Sourcing | Export”)। “Booking books print”-এ বেছে নিন PDF শুরুতে “Landscape” না “Portrait” হবে। প্রত্যেকে ডাউনলোডের সময় নিজে বদলাতে পারেন, আর তাঁর শেষ বাছাই মনে থাকে। “Save” চাপুন।",
        },
      ],
      tips: [
        "লোগো বদলালে আগে তৈরি করা PDF-এ পুরোনো লোগোই থাকবে, নতুন PDF-এ নতুন লোগো আসবে।",
        "কোম্পানির নিজস্ব ডিজাইনের কোটেশন বা ইনভয়েস চাইলে Reports & documents-এর “Templates” ট্যাব দেখুন।",
      ],
    },
    {
      slug: "settings-business-rules",
      title: "ব্যবসার নিয়ম, মুদ্রা ও অর্থবছর ঠিক করবেন যেভাবে",
      summary:
        "কম স্টকের সীমা, অর্ডারে অগ্রিমের হার, ক্রেতা কবে নিষ্ক্রিয় ধরা হবে, মুদ্রা, সময় অঞ্চল ও অর্থবছরের শুরু।",
      keywords: [
        "business rules",
        "low stock alert",
        "advance",
        "dormant",
        "currency",
        "time zone",
        "financial year",
        "অগ্রিম",
        "অর্থবছর",
        "মুদ্রা",
        "কম স্টক",
        "নিষ্ক্রিয় ক্রেতা",
      ],
      routes: ["/settings/company"],
      who: "যাঁদের কোম্পানির সেটিংস বদলানোর অনুমতি আছে, সাধারণত Super Admin।",
      anyOf: ["company.settings"],
      steps: [
        { text: "“Settings” > “Company” ট্যাব খুলে নিচে “Business rules” অংশে যান।" },
        {
          text: "“Low stock alert at”: কোনো SKU কত পিসের নিচে নামলে কম স্টক ধরা হবে। “Advance on orders (%)”: প্রোফর্মায় সাধারণত কত শতাংশ অগ্রিম চাওয়া হবে। “Buyer counts as dormant after (months)”: কত মাস কেনাকাটা না করলে ক্রেতা নিষ্ক্রিয় ধরা হবে।",
          image: {
            id: "settings-business-rules-1",
            caption: "“Business rules” অংশের তিনটি ঘর",
          },
        },
        {
          text: "“Money and time” অংশে “Currency”, “Time zone” ও “Financial year starts in” (অর্থবছর কোন মাসে শুরু) বেছে নিন।",
        },
        { text: "প্রতিটি অংশের “Save” বোতামে চাপুন। “Saved” লেখা এলে সংরক্ষণ হয়েছে।" },
      ],
      tips: [
        "মুদ্রা বদলালে আগে রেকর্ড করা টাকার অঙ্ক বদলায় না। সময় অঞ্চল বদলালে রিপোর্টের দিনের সীমা সরে যায়, তাই সাবধানে বদলান।",
      ],
    },
    {
      slug: "backups-google-setup",
      title: "ব্যাকআপের জন্য Google-এর এককালীন সেটআপ যেভাবে করবেন",
      summary:
        "Google Cloud-এ একবার একটি ক্লায়েন্ট বানানো, যাতে ERP শুধু নিজের বানানো ব্যাকআপ ফাইলগুলো আপনার Google Drive-এ রাখতে পারে।",
      keywords: [
        "google setup",
        "google cloud",
        "client id",
        "client secret",
        "drive.file",
        "in production",
        "tv client",
        "গুগল সেটআপ",
        "গুগল ড্রাইভ",
        "ক্লায়েন্ট",
      ],
      routes: ["/settings/backups"],
      who: "শুধু প্ল্যাটফর্মের মালিক (সব কোম্পানির মালিক Super Admin)।",
      steps: [
        {
          text: "কম্পিউটারে console.cloud.google.com খুলে যে Google অ্যাকাউন্টে ব্যাকআপ রাখবেন সেটি দিয়ে ঢুকুন। উপরের প্রজেক্ট তালিকা থেকে নতুন প্রজেক্ট বানান, নাম দিন Extas ERP Backups।",
        },
        {
          text: "বাম মেনুর APIs and Services > Library-তে গিয়ে Google Drive API খুঁজে Enable চাপুন।",
        },
        {
          text: "APIs and Services > OAuth consent screen খুলুন। User type: External, অ্যাপের নাম Extas ERP, আপনার ইমেইল দিন। Scopes-এ শুধু একটি স্কোপ যোগ করুন: drive.file (অ্যাপ নিজে যে ফাইল বানায় শুধু সেগুলো)। এর বেশি কোনো স্কোপ দেবেন না।",
        },
        {
          text: "একই পাতায় Publishing status-এ Publish app চেপে অ্যাপটিকে In production করুন। Testing অবস্থায় থাকলে Google 7 দিন পর সংযোগ কেটে দেয় এবং ব্যাকআপ Drive-এ যাওয়া বন্ধ হয়ে যায়।",
        },
        {
          text: "APIs and Services > Credentials > Create credentials > OAuth client ID চাপুন। Application type হিসেবে “TVs and Limited Input devices” বেছে নিন, নাম দিন Extas ERP, তারপর Create চাপুন।",
        },
        {
          text: "যে Client ID ও Client secret দেখাবে তা কপি করুন। ERP-তে “Settings” > “Backups” খুলে “Google Drive” অংশে “Client ID” ও “Client secret” ঘরে বসিয়ে “Save the Google client” চাপুন।",
          image: {
            id: "backups-google-setup-1",
            caption:
              "“Google Drive” অংশে “Client ID”, “Client secret” ও “Save the Google client” বোতাম",
          },
        },
      ],
      tips: [
        "অ্যাপ যাচাই (verification) চাইলে চিন্তা করবেন না: drive.file স্কোপের জন্য Google সাধারণত যাচাই চায় না। প্রথমবার সাইন ইনে সতর্কবার্তা এলে Advanced > Go to Extas ERP চেপে এগোন।",
        "এই একই ক্লায়েন্ট নতুন সার্ভারেও কাজে লাগে: “Download the restore guide” দিয়ে নামানো রিস্টোর গাইডে এর Client ID ও Client secret লেখা থাকে, নতুন সার্ভার সেগুলো জিজ্ঞেস করে। তাই ক্লায়েন্টটি মুছবেন না।",
        "Client secret কাউকে পাঠাবেন না; এটি ERP-তে তালা দিয়ে রাখা হয় এবং আর পুরোটা দেখানো হয় না।",
      ],
    },
    {
      slug: "backups-drive-key",
      title: "ব্যাকআপ চালু করা: রিকভারি কী, সময়সূচি ও Google Drive যেভাবে",
      summary:
        "নিজের রিকভারি কী ঠিক করা, Google Drive যুক্ত করা, কখন ব্যাকআপ হবে আর কতগুলো রাখা হবে ঠিক করা, আর উপরের বড় লাইনটি দেখে বোঝা ব্যাকআপ নিরাপদ কি না।",
      keywords: [
        "backup",
        "backups",
        "google drive",
        "recovery key",
        "back up now",
        "schedule",
        "keep",
        "2-step verification",
        "ব্যাকআপ",
        "রিকভারি কী",
        "গুগল ড্রাইভ",
        "সময়সূচি",
      ],
      routes: ["/settings/backups"],
      who: "শুধু প্ল্যাটফর্মের মালিক (সব কোম্পানির মালিক Super Admin)।",
      steps: [
        {
          text: "“Settings” > “Backups” খুলুন। সবার উপরে বড় করে লেখা থাকে ব্যাকআপ কেমন আছে, যেমন Last backup 2 hours ago, safe in Google Drive। তার নিচের লাইন বলে, সার্ভার এখনই হারালে সবচেয়ে বেশি কত ঘণ্টার কাজ হারাবেন। সবুজ মানে ঠিক আছে, হলুদ মানে দেখুন, লাল মানে এখনই কিছু করতে হবে।",
          image: {
            id: "backups-drive-key-1",
            caption:
              "“Backups” অংশ: বড় অবস্থা-লাইন, হারানোর হিসাব, “Back up now” ও “Download the restore guide”",
          },
        },
        {
          text: "“Recovery key” অংশে “Set your recovery key” চাপুন। “New recovery key” ঘরে নিজের পছন্দের একটি শব্দ, বাক্য বা নকশা লিখুন (কমপক্ষে 8 অক্ষর), যা বহু বছর মনে থাকবে। নিচে লেখা ইঙ্গিত বলে কী কতটা শক্ত। “Type it again” ঘরে আবার একই কী লিখুন, তারপর “PIN” দিয়ে “Save the key” চাপুন।",
          image: {
            id: "backups-drive-key-2",
            caption:
              "“Set your recovery key” জানালা: দুবার কী লেখা, “Keep my recovery key in Google Drive” ও PIN",
          },
        },
        {
          text: "একই জানালায় “Keep my recovery key in Google Drive” টিক দেওয়া থাকে। চালু থাকলে আপনার কী Google Drive-এর ব্যাকআপ ফোল্ডারে রিস্টোর গাইডের ভেতরে থাকে, তাই নতুন সার্ভারে রিস্টোরের সময় কী নিজে থেকেই বসে যায়, টাইপ করতে হয় না। সেক্ষেত্রে ওই Google অ্যাকাউন্টে 2-Step Verification অবশ্যই চালু রাখুন।",
        },
        {
          text: "“Google Drive” অংশে “Connect Google Drive” চাপুন। একটি কোড দেখাবে। ফোনে google.com/device খুলে কোডটি লিখুন, তারপর নিজের Google অ্যাকাউন্ট বেছে অনুমতি দিন। পাতাটি নিজেই বুঝে নেয়। কী ঠিক করার সময় Drive যুক্ত না থাকলে, পরে “Put my key in Google Drive” চেপে কী একবার লিখে দিন।",
          image: {
            id: "backups-drive-key-3",
            caption: "ফোনে দেওয়ার জন্য Google সাইন-ইন কোড",
          },
        },
        {
          text: "“When to back up” অংশে “How often” থেকে বেছে নিন: “Every few hours” (যেমন প্রতি 6 ঘণ্টায়, “Starting at” 01:00 থেকে), “Every day, or every few days” (দিনে এক বা একাধিক সময়, “Add a time” দিয়ে সময় যোগ করুন), “On chosen weekdays” (সপ্তাহের বাছাই করা দিনে) বা “On chosen dates” (নির্দিষ্ট তারিখ ও সময়ে)। শুরুতে দিনে দুবার: রাত 02:00 ও দুপুর 14:00 (ঢাকার সময়)।",
          image: {
            id: "backups-drive-key-4",
            caption:
              "“When to back up” অংশ: “How often”, সময়, “Keep on this server” ও “Keep in Google Drive for (days)”",
          },
        },
        {
          text: "“Keep on this server” ঘরে বাছুন সার্ভারে সবচেয়ে নতুন কয়টি ব্যাকআপ থাকবে (3 থেকে 7, শুরুতে 4)। “Keep in Google Drive for (days)” ঘরে লিখুন Drive-এ প্রতিটি ব্যাকআপ কত দিন থাকবে (শুরুতে 90), অথবা “Keep for ever” টিক দিন। সবচেয়ে নতুন ব্যাকআপটি কখনো মোছা হয় না। শেষে “Save” চাপুন।",
        },
        {
          text: "এখনই একটি ব্যাকআপ নিতে “Back up now” চাপুন। কয়েক মিনিট পর উপরের লাইন সবুজ হয় এবং “Backups in Google Drive” তালিকায় তারিখ, আকার ও “Checked” দেখায়। “Checked” মানে Google-এর কপি সার্ভারের কপির সঙ্গে বাইট ধরে মিলিয়ে দেখা হয়েছে।",
        },
      ],
      tips: [
        "প্রতিটি ব্যাকআপে সব থাকে: পুরো ডাটাবেস, আপলোড ও তৈরি করা সব ফাইল, সার্ভারের সব সেটিংস (তালা দেওয়া), আর ঠিক সেই সংস্করণের কোড। সঙ্গে একটি তালিকা থাকে: প্রতিটি টেবিলে কতগুলো রেকর্ড আর প্রতিটি ফাইলের চেকসাম, যাতে রিস্টোরের পর মিলিয়ে দেখা যায় সব ফিরেছে কি না।",
        "রিকভারি কী ERP কখনো নিজে বানায় না, কোথাও রাখেও না। কী বদলাতে “Change the recovery key” চাপুন: “Current recovery key” ঘরে পুরনো কী, তারপর নতুন কী দুবার ও PIN দিন। নতুন কী দিয়ে পুরনো-নতুন সব ব্যাকআপ খোলে।",
        "কী ভুলে গেলে “Change the recovery key” জানালায় “I forgot my current key” টিক দিয়ে নতুন কী দিন। তখন আগের ব্যাকআপগুলো শুধু হারানো কী দিয়েই খোলে; পাতায় লেখা থাকে কোন তারিখের আগের ব্যাকআপে পুরনো কী লাগবে।",
        "v6.3-এ ERP যে কী-কার্ড বানিয়ে দিত, নিজের কী ঠিক করার পর সেটি আর নতুন ব্যাকআপে লাগে না। তবে তার আগের ব্যাকআপগুলো খুলতে পুরনো কী-কার্ডটি রেখে দিন; পাতায় তারিখসহ লেখা থাকে।",
        "ব্যাকআপ ব্যর্থ হলে, সময়মতো শুরু না হলে বা Drive-এ না গেলে ERP-র ইনবক্সে ও Telegram-এ সতর্কবার্তা আসে, একই সমস্যার জন্য একবারই। সব আবার ঠিক হলে Backups are working again বার্তা আসে।",
        "“Take my key out of Google Drive” চাপলে (PIN লাগে) Drive থেকে কী-র ফাইল ও কী-সহ গাইড মুছে যায়; তখন রিস্টোরের সময় কী নিজে টাইপ করতে হবে। আপনার নিজের রাখা কোনো ফাইলে ERP হাত দেয় না।",
      ],
    },
    {
      slug: "backups-cloudflare",
      title: "নতুন সার্ভারের জন্য Cloudflare টোকেন রাখা যেভাবে",
      summary:
        "Cloudflare-এ এমন একটি টোকেন বানানো যা শুধু আপনার ডোমেইনের DNS বদলাতে পারে, আর সেটি একবার ERP-তে রাখা, যাতে নতুন সার্ভারে রিস্টোর নিজেই ডোমেইন ঠিক করে HTTPS চালু করে।",
      keywords: [
        "cloudflare",
        "dns",
        "api token",
        "domain",
        "https",
        "ক্লাউডফ্লেয়ার",
        "ডোমেইন",
        "টোকেন",
      ],
      routes: ["/settings/backups"],
      who: "শুধু প্ল্যাটফর্মের মালিক (সব কোম্পানির মালিক Super Admin)।",
      steps: [
        {
          text: "কম্পিউটারে dash.cloudflare.com খুলে সাইন ইন করুন। ডান দিকে উপরে মানুষের ছবিতে চাপুন, তারপর My Profile।",
        },
        {
          text: "বাম দিকে API Tokens চাপুন, তারপর Create Token। Edit zone DNS লেখার পাশে Use template চাপুন।",
        },
        {
          text: "Permissions-এ Zone, DNS, Edit যেমন আছে রাখুন, আর Add more চেপে আরেকটি লাইন যোগ করুন: Zone, Zone, Read। Zone Resources-এ Include, Specific zone, তারপর আপনার ডোমেইন (যেমন extasbd.com) বাছুন।",
        },
        {
          text: "Continue to summary চাপুন, তারপর Create Token। টোকেনটি একবারই দেখায়, তাই এখনই কপি করুন।",
        },
        {
          text: "ERP-তে “Settings” > “Backups” খুলে “Cloudflare (for a new server)” অংশে “Save the Cloudflare token” চাপুন। “Your domain” ঘরে ডোমেইন, “API token” ঘরে টোকেন ও “PIN” দিয়ে “Save and test” চাপুন। Cloudflare টোকেনটি মেনে নিলে তবেই রাখা হয়।",
          image: {
            id: "backups-cloudflare-1",
            caption:
              "“Cloudflare (for a new server)” অংশ: ধাপগুলো, “Save the Cloudflare token” ও “Test”",
          },
        },
        {
          text: "পরে যেকোনো সময় “Test” চাপলে ERP দেখে নেয় টোকেনটি এখনও কাজ করে কি না, আর আপনার ERP-র ঠিকানা এখন কোন IP-তে যায়। Cloudflare-এ কিছু বদলায় না।",
        },
      ],
      tips: [
        "টোকেনটি তালা দিয়ে রাখা হয় এবং আর কখনো পুরোটা দেখানো হয় না; শুধু শেষের 4টি অক্ষর দেখায়। এটি প্রতিটি তালা দেওয়া ব্যাকআপেও থাকে, তাই নতুন সার্ভারে আলাদা করে দিতে হয় না।",
        "টোকেন যদি অন্য ডোমেইনেও হাত দিতে পারে, ERP সেটি নেয় না: শুধু নিজের ডোমেইনের জন্য নতুন টোকেন বানান।",
        "টোকেন না রাখলেও ব্যাকআপ ও রিস্টোর চলে; তখন নতুন সার্ভারে DNS-এর A রেকর্ড হাতে বদলাতে হয়। “Remove” দিয়ে টোকেন সরানো যায় (PIN লাগে)।",
      ],
    },
    {
      slug: "backups-restore",
      title: "ব্যাকআপ থেকে ফেরত আনা ও মাসিক রিস্টোর মহড়া যেভাবে",
      summary:
        "Drive-এর একটি ব্যাকআপ এই সার্ভারে ফেরত আনা, প্রতি মাসের রিস্টোর মহড়া দেখা ও নিজে চালানো, আর সার্ভার হারালে রিস্টোর গাইড ও এক কমান্ডে নতুন সার্ভারে সব ফেরত আনা।",
      keywords: [
        "restore",
        "restore drill",
        "drill",
        "new server",
        "disaster",
        "command",
        "restore guide",
        "রিস্টোর",
        "ফেরত আনা",
        "নতুন সার্ভার",
        "মহড়া",
      ],
      routes: ["/settings/backups"],
      who: "শুধু প্ল্যাটফর্মের মালিক (সব কোম্পানির মালিক Super Admin)।",
      steps: [
        {
          text: "“Backups in Google Drive” তালিকায় যে ব্যাকআপে ফিরতে চান তার সারিতে “Restore” চাপুন। মনে রাখবেন: এতে সব কোম্পানির সব তথ্য ওই ব্যাকআপের মতো হয়ে যায়।",
        },
        {
          text: "জানালায় আপনার PIN দিন এবং “Type RESTORE” ঘরে বড় হাতের অক্ষরে RESTORE লিখে “Restore” চাপুন। কী Google Drive-এ না রাখলে “Recovery key” ঘরে কী লিখুন; v6.3-এর পুরনো ব্যাকআপ হলে “Old key card” ঘরে পুরনো কী-কার্ডের কী লিখুন।",
          image: {
            id: "backups-restore-1",
            caption: "“Restore” জানালা: “Recovery key”, PIN ও “Type RESTORE” ঘর",
          },
        },
        {
          text: "সার্ভার প্রথমে বর্তমান তথ্যের একটি নিরাপত্তা কপি রাখে, তারপর ব্যাকআপ বসায় এবং সব স্ক্রিন খুলে পরীক্ষা করে। কয়েক মিনিট ERP বন্ধ থাকে। শেষ হলে ইনবক্সে Restore finished আসে, সঙ্গে আগের অবস্থায় ফেরার নিরাপত্তা কপির নাম। ERP চালু না হলে সার্ভার নিজেই আগের অবস্থায় ফিরে যায়।",
        },
        {
          text: "প্রতি মাসে (শুরুতে মাসের 1 তারিখ ভোর 04:00) ERP নিজে সবচেয়ে নতুন ব্যাকআপটি একটি অস্থায়ী ডাটাবেসে ফেরত আনে, প্রতিটি টেবিলের রেকর্ড-সংখ্যা ও প্রতিটি ফাইলের চেকসাম মিলিয়ে দেখে, তারপর অস্থায়ী ডাটাবেস মুছে ফেলে। লাইভ বা ডেমো সাইটে কিছু বদলায় না। ফল আসে ইনবক্সে ও Telegram-এ, আর দেখায় “Last restore drill” ঘরে।",
        },
        {
          text: "নিজে এখনই মহড়া চালাতে “Run drill now” চাপুন। কী Drive-এ না রাখলে জানালায় এই একবারের জন্য কী লিখতে পারেন (রাখা হয় না); না লিখলে মহড়া শুধু ফাইলগুলোর চেকসাম মেলায়। দিন ও সময় বদলাতে “When to back up” অংশে “Day of the month” ও “Drill time” ঠিক করে “Save” চাপুন।",
        },
        {
          text: "সার্ভার পুরো হারানোর জন্য আগে থেকেই তৈরি থাকুন: “Download the restore guide” চেপে রিস্টোর গাইড (বাংলা, সঙ্গে “English copy”) কম্পিউটারে রাখুন। গাইডে নতুন Azure সার্ভার বানানো থেকে শুরু করে প্রতিটি ধাপ ছবিসহ আছে; একই গাইড Google Drive-এর ব্যাকআপ ফোল্ডারেও থাকে।",
          image: {
            id: "backups-restore-2",
            caption: "“Restore on a new server” অংশে এক লাইনের কমান্ড ও “Copy the command” বোতাম",
          },
        },
        {
          text: "“Restore on a new server” অংশের কমান্ডে কোনো পাসওয়ার্ড বা কী থাকে না: নতুন সার্ভারে পেস্ট করলে সে যা দরকার তা লুকানো ঘরে জিজ্ঞেস করে। Google-এ সাইন ইন হয় ফোনে কোড দিয়ে, তারপর ব্যাকআপের তালিকা দেখায় (Enter চাপলে সবচেয়ে নতুনটি)। বাকিটা সে নিজে করে এবং শেষে লেখে কতগুলো রেকর্ড ও ফাইল ফিরে এসেছে।",
        },
      ],
      tips: [
        "রিস্টোর ভুল হলে ফেরা যায়: ইনবক্সের বার্তায় যে নিরাপত্তা কপির নাম থাকে, সেটি দিয়ে আবার রিস্টোর করুন (সার্ভারে sudo ./deploy/restore.sh)।",
        "মহড়া কখনো লাইভ বা ডেমো ডাটাবেসে হাত দেয় না: শুধু extas_restore_test_ নামের অস্থায়ী ডাটাবেসে কাজ করে এবং শেষে সেটি মুছে দেয়।",
        "সার্ভার আপডেট হলে কমান্ডটি নতুন সংস্করণের সঙ্গে মিলিয়ে বদলায়; পুরনো কমান্ডও কাজ করে, তবে নতুন গাইড নামিয়ে রাখা ভালো।",
      ],
    },
    {
      slug: "backups-new-server",
      title: "সার্ভার হারালে নতুন সার্ভারে সব ফেরত আনবেন যেভাবে (রিস্টোর গাইড)",
      summary:
        "Azure-এ নতুন সার্ভার বানানো থেকে PuTTY, এক লাইনের কমান্ড, প্রশ্নের উত্তর, ফোনে Google সাইন-ইন আর ERP খুলে দেখা পর্যন্ত প্রতিটি ধাপ, সঙ্গে প্রতিটি ভুলের কোড ও তখন কী করবেন।",
      keywords: [
        "new server",
        "restore guide",
        "server lost",
        "azure",
        "putty",
        "one command",
        "error code",
        "cloudflare",
        "নতুন সার্ভার",
        "রিস্টোর গাইড",
        "সার্ভার হারানো",
        "পুটি",
        "ভুলের কোড",
      ],
      routes: ["/settings/backups"],
      who: "শুধু প্ল্যাটফর্মের মালিক (সব কোম্পানির মালিক Super Admin)।",
      steps: [
        {
          text: "আগে থেকেই তৈরি থাকুন: “Settings” > “Backups” খুলে “Download the restore guide” চাপুন (ইংরেজিতে চাইলে “English copy”)। এই PDF-এ সব ধাপ বড় ছবিসহ আছে, আর “Your restore details” ঘরে আপনার ওয়েব ঠিকানা ও Google client লেখা থাকে। কম্পিউটারে রেখে দিন। একই গাইড Google Drive-এর “Extas ERP Backups” ফোল্ডারেও থাকে, প্রতি মাসে ও কিছু বদলালেই নতুন করে বানানো হয়।",
        },
        ...newServerSteps,
      ],
      tips: [
        "কমান্ড কোথাও থেমে গেলে স্ক্রিনে Error R12 বা Note W03 ধরনের কোড আসে। নিচে প্রতিটি কোডের মানে আর তখন কী করবেন লেখা আছে। কমান্ড আবার চালালে কোনো ক্ষতি হয় না।",
        ...newServerErrors,
        "এই সার্ভারে আগে থেকেই Extas ERP থাকলে কমান্ড তার তথ্য বদলায় না, যতক্ষণ না আপনি তার ওয়েব ঠিকানা টাইপ করে নিশ্চিত করেন; আর সেই সার্ভারের নিজের ENCRYPTION_KEY কখনো বদলায় না।",
      ],
    },
  ],
};
