import type { HelpSection } from "../types";

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
          text: "তাঁর সারির ডান পাশে তিন-বিন্দুর বোতামে চাপুন। মেনুতে “Change role”, “Reset password” ও “Deactivate” পাবেন।",
          image: {
            id: "settings-manage-member-1",
            caption:
              "কর্মীর সারিতে তিন-বিন্দুর মেনু খোলা: “Change role”, “Reset password”, “Deactivate”",
          },
        },
        {
          text: "ভূমিকা বদলাতে “Change role” চাপুন, “New role” থেকে নতুন ভূমিকা বেছে নিয়ে “Change role” বোতামে চাপুন।",
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
          text: "নিচে বিভাগ অনুযায়ী (যেমন “Sales”, “Accounts”, “HR and payroll”) অনুমতিগুলো টিক দিন বা টিক তুলে দিন। পুরো বিভাগ একসঙ্গে বাছতে “Select all”, সরাতে “Clear”।",
          image: {
            id: "settings-new-role-2",
            caption: "বিভাগ অনুযায়ী অনুমতির টিকবক্স, “Money” চিহ্ন ও “Select all”",
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
  ],
};
