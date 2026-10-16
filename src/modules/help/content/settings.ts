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
        "এই একই ক্লায়েন্ট নতুন সার্ভারেও কাজে লাগে: “Restore on a new server” কমান্ডে এটি থাকে। তাই ক্লায়েন্টটি মুছবেন না।",
        "Client secret কাউকে পাঠাবেন না; এটি ERP-তে তালা দিয়ে রাখা হয় এবং আর পুরোটা দেখানো হয় না।",
      ],
    },
    {
      slug: "backups-drive-key",
      title: "ব্যাকআপ Google Drive-এ পাঠানো ও রিকভারি কী বানানো যেভাবে",
      summary:
        "Google Drive যুক্ত করা, রিকভারি কী একবার দেখে লিখে রাখা, প্রতিদিনের সময় ও কতগুলো রাখা হবে ঠিক করা, আর ব্যাকআপ ব্যর্থ হলে সতর্কবার্তা পাওয়া।",
      keywords: [
        "backup",
        "backups",
        "google drive",
        "recovery key",
        "back up now",
        "daily backup",
        "keep",
        "ব্যাকআপ",
        "রিকভারি কী",
        "গুগল ড্রাইভ",
        "দৈনিক ব্যাকআপ",
      ],
      routes: ["/settings/backups"],
      who: "শুধু প্ল্যাটফর্মের মালিক (সব কোম্পানির মালিক Super Admin)।",
      steps: [
        {
          text: "“Settings” > “Backups” খুলুন। উপরে “Backups are not safe yet.” লেখা থাকলে নিচের ধাপগুলো এখনো বাকি।",
          image: {
            id: "backups-drive-key-1",
            caption: "“Backups” পাতা: শেষ ব্যাকআপ, পরের ব্যাকআপ ও “Back up now” বোতাম",
          },
        },
        {
          text: "“Google Drive” অংশে “Connect Google Drive” চাপুন। একটি কোড দেখাবে। ফোনে google.com/device খুলে কোডটি লিখুন, তারপর নিজের Google অ্যাকাউন্ট বেছে অনুমতি দিন। পাতাটি নিজেই বুঝে নেয়, কিছু চাপতে হয় না।",
          image: {
            id: "backups-drive-key-2",
            caption: "ফোনে দেওয়ার জন্য Google সাইন-ইন কোড",
          },
        },
        {
          text: "“Recovery key” অংশে “Make the recovery key” চাপুন। কাগজ-কলম হাতে নিয়ে “Show me the key” চাপুন। 14টি চার অক্ষরের দল দেখাবে: সবগুলো কাগজে লিখুন বা “Copy” চেপে পাসওয়ার্ড ম্যানেজারে রাখুন। এটি আর কখনো দেখানো হবে না।",
          image: {
            id: "backups-drive-key-3",
            caption: "“Your recovery key”: একবারই দেখানো রিকভারি কী ও “I wrote it down” বোতাম",
          },
        },
        {
          text: "“I wrote it down” চাপুন। “Check your copy” জানালায় “Last group” ঘরে কী-র শেষ চার অক্ষর লিখে “Confirm” চাপুন। এরপর থেকে প্রতিটি ব্যাকআপ এই কী দিয়ে তালা দিয়ে Drive-এ যায়।",
        },
        {
          text: "“When and how many” অংশে “Daily time” (প্রতিদিন কখন) ও “How many to keep in Drive” (কতগুলো রাখা হবে) ঠিক করে “Save” চাপুন। সবচেয়ে নতুন যাচাই করা ব্যাকআপ সবসময় থেকে যায়।",
        },
        {
          text: "এখনই একটি ব্যাকআপ নিতে “Back up now” চাপুন। কয়েক মিনিট পর “Backups in Google Drive” তালিকায় তারিখ, আকার ও “Checked” দেখাবে। “Checked” মানে Google-এর কপি সার্ভারের কপির সঙ্গে বাইট ধরে মিলিয়ে দেখা হয়েছে, তারপর সার্ভারের কপি মুছে ফেলা হয়েছে।",
          image: {
            id: "backups-drive-key-4",
            caption: "“Backups in Google Drive” তালিকা: “Date”, “Size”, “Checked in Drive”",
          },
        },
      ],
      tips: [
        "রিকভারি কী ছাড়া কোনো ব্যাকআপ খোলা যায় না, ERP-ও পারে না। কী হারালে নতুন কী বানান (“Make a new recovery key”, PIN লাগে), তবে পুরনো ব্যাকআপগুলো শুধু পুরনো কী দিয়েই খোলে।",
        "ব্যাকআপ ব্যর্থ হলে বা Drive-এ না গেলে ERP-র ইনবক্সে ও বটে সঙ্গে সঙ্গে সতর্কবার্তা আসে। Drive-এ না যাওয়া ব্যাকআপ সার্ভারে থাকে এবং এক ঘণ্টার মধ্যে আবার পাঠানো হয়।",
        "আপডেটের আগের নিরাপত্তা কপিও (“Update safety copy”) তালা দিয়ে Drive-এ যায়; সার্ভারে সেটি 24 ঘণ্টা থাকে, যাতে আপডেট ব্যর্থ হলে সঙ্গে সঙ্গে ফেরা যায়।",
      ],
    },
    {
      slug: "backups-restore",
      title: "ব্যাকআপ থেকে ফেরত আনা ও নতুন সার্ভারে চালু করা যেভাবে",
      summary:
        "Drive-এর একটি ব্যাকআপ এই সার্ভারে ফেরত আনা, প্রতি সপ্তাহের পরীক্ষামূলক রিস্টোর দেখা, আর সার্ভার হারালে এক কমান্ডে নতুন সার্ভারে সব ফেরত আনা।",
      keywords: [
        "restore",
        "test restore",
        "new server",
        "disaster",
        "command",
        "bootstrap",
        "রিস্টোর",
        "ফেরত আনা",
        "নতুন সার্ভার",
        "পরীক্ষা",
      ],
      routes: ["/settings/backups"],
      who: "শুধু প্ল্যাটফর্মের মালিক (সব কোম্পানির মালিক Super Admin)।",
      steps: [
        {
          text: "“Backups in Google Drive” তালিকায় যে ব্যাকআপে ফিরতে চান তার সারিতে “Restore” চাপুন। মনে রাখবেন: এতে সব কোম্পানির সব তথ্য ওই ব্যাকআপের মতো হয়ে যায়।",
        },
        {
          text: "জানালায় আপনার PIN দিন এবং “Type RESTORE” ঘরে বড় হাতের অক্ষরে RESTORE লিখে “Restore” চাপুন। ERP ব্যাকআপটি নামিয়ে, প্রতিটি ফাইল মিলিয়ে, রিকভারি কী দিয়ে খুলে সার্ভারের হাতে দেয়।",
          image: {
            id: "backups-restore-1",
            caption: "“Restore” জানালা: PIN ও “Type RESTORE” ঘর",
          },
        },
        {
          text: "সার্ভার প্রথমে বর্তমান তথ্যের একটি নিরাপত্তা কপি রাখে, তারপর ব্যাকআপ বসায় এবং সব স্ক্রিন খুলে পরীক্ষা করে। কয়েক মিনিট ERP বন্ধ থাকে। শেষ হলে ইনবক্সে “Restore finished” আসে, সঙ্গে আগের অবস্থায় ফেরার নিরাপত্তা কপির নাম। ERP চালু না হলে সার্ভার নিজেই আগের অবস্থায় ফিরে যায়।",
        },
        {
          text: "প্রতি সপ্তাহে ERP নিজে সবচেয়ে নতুন ব্যাকআপটি একটি অস্থায়ী ডাটাবেসে ফেরত এনে পরীক্ষা করে মুছে ফেলে; লাইভ বা ডেমো সাইটে কিছু বদলায় না। ফল দেখাবে “Last test restore” ঘরে, আর ইনবক্সে “Test restore worked” বা “Test restore failed”। নিজে এখনই চালাতে “Test a restore now” চাপুন।",
        },
        {
          text: "সার্ভার পুরো হারালে: আগে থেকেই “Restore on a new server” অংশে “Show the command” চেপে কমান্ডটি “Copy” করে রিকভারি কী-র সঙ্গে নিরাপদে রাখুন। দরকারের দিন Azure-এ নতুন Ubuntu সার্ভার বানিয়ে তাতে ঢুকে কমান্ডটি পেস্ট করুন।",
          image: {
            id: "backups-restore-2",
            caption: "“Restore on a new server” অংশে এক লাইনের কমান্ড ও “Copy” বোতাম",
          },
        },
        {
          text: "কমান্ড জিজ্ঞেস করবে: GitHub token (রিপোজিটরি পাবলিক হলে শুধু Enter), ওয়েব ঠিকানা, আর রিকভারি কী। তারপর একটি Google কোড দেখাবে: ফোনে google.com/device খুলে কোডটি দিন। এরপর Drive-এর ব্যাকআপের তালিকা দেখাবে; Enter চাপলে সবচেয়ে নতুনটি, নম্বর লিখলে সেটি। বাকিটা সে নিজে করে: সব ইনস্টল, রিস্টোর, HTTPS চালু ও প্রতিটি স্ক্রিন পরীক্ষা, শেষে কত সময় লাগল তা জানায়। নতুন সার্ভারে পরীক্ষায় পুরো কাজে প্রায় 7 মিনিট লেগেছে (ছোট সার্ভারে 10 থেকে 20 মিনিট লাগতে পারে)।",
        },
        {
          text: "শেষে ওয়েব ঠিকানার DNS নতুন সার্ভারের IP-তে বদলান (আগের মতো A রেকর্ড)। কয়েক মিনিটের মধ্যে HTTPS নিজে চালু হয় এবং আগের পাসওয়ার্ড দিয়েই সবাই ঢুকতে পারেন।",
        },
      ],
      tips: [
        "রিস্টোর ভুল হলে ফেরা যায়: ইনবক্সের বার্তায় যে নিরাপত্তা কপির নাম থাকে, সেটি দিয়ে আবার রিস্টোর করুন (সার্ভারে sudo ./deploy/restore.sh)।",
        "রিপোজিটরি প্রাইভেট হলে কমান্ডের জন্য GitHub-এ একটি টোকেন লাগে (Fine-grained token, শুধু এই রিপোজিটরির Contents: Read)। সার্ভার পরে আপডেট আনতে টোকেনটি রেখে দেয়।",
        "কমান্ডে Google ক্লায়েন্টের তথ্য থাকে, তাই কমান্ডটিও রিকভারি কী-র মতো গোপন রাখুন।",
      ],
    },
  ],
};
