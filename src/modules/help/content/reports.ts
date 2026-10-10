import type { HelpSection } from "../types";

/** Reports & documents: the Report Builder, printed documents and letters, and document templates. */
export const reportsHelp: HelpSection = {
  id: "reports",
  title: "রিপোর্ট ও ডকুমেন্ট (Reports & documents)",
  description:
    "Report Builder দিয়ে PDF বা Excel রিপোর্ট বানানো, অ্যাপ থেকে ছাপা সব PDF এক জায়গায় পাওয়া, চিঠি লেখা আর কোম্পানির নিজস্ব ডিজাইনের টেমপ্লেট।",
  href: "/reports",
  articles: [
    {
      slug: "reports-make",
      title: "Report Builder দিয়ে রিপোর্ট বানাবেন যেভাবে",
      summary:
        "যেকোনো সময়ের মূল হিসাব, বিক্রি, লাভ-ক্ষতি, বেশি বিক্রি হওয়া পণ্য ও স্টকের সতর্কতা নিয়ে রিপোর্ট বানিয়ে পর্দায় দেখা বা PDF ও Excel হিসেবে রাখা।",
      keywords: [
        "report",
        "make a report",
        "report builder",
        "pdf",
        "excel",
        "export",
        "sales report",
        "রিপোর্ট",
        "রিপোর্ট তৈরি",
        "এক্সেল",
        "পিডিএফ",
        "বিক্রির রিপোর্ট",
        "মাসিক রিপোর্ট",
      ],
      routes: ["/reports/new", "/reports"],
      who: "যাঁদের রিপোর্ট বানানোর অনুমতি আছে: Super Admin, Accounts ও Production Manager। প্রত্যেকে শুধু নিজের ভূমিকায় খোলা হিসাবগুলো বাছতে পারেন।",
      anyOf: ["reports.export"],
      steps: [
        {
          text: "মেনু থেকে “Reports & documents” খুলুন (ফোনে “Reports”)। “Reports” ট্যাবে “Make a report” চাপুন।",
          image: {
            id: "reports-make-1",
            caption: "“Reports” ট্যাবে আগের রিপোর্টের তালিকা ও “Make a report” বোতাম",
          },
        },
        {
          text: "“Title” লিখুন এবং “Period” বেছে নিন: আজ, এ মাস, গত মাস, এই বা গত অর্থবছর, গত সপ্তাহ, মাস বা বছর, অথবা “From” ও “To” দিয়ে নিজের দিন।",
        },
        {
          text: "“Figures”-এ কী থাকবে টিক দিন: “Key figures”, “Sales”, “Profit and loss”, “Top sellers”, “Stock alerts”।",
          image: {
            id: "reports-make-2",
            caption: "Report Builder: শিরোনাম, সময়, হিসাবের টিকবক্স ও তালিকার দৈর্ঘ্য",
          },
        },
        {
          text: "“How long the lists are”-এ কয়টি বেশি বিক্রির পণ্য (“Top sellers to list”) ও প্রতিটি সতর্কতায় কয়টি জিনিস দেখাবে ঠিক করুন।",
        },
        {
          text: "পর্দায় দেখতে “Show on screen”, ফাইল হিসেবে রাখতে “Make PDF” বা “Make Excel” চাপুন। ফাইল তৈরি হলে “Open the PDF” বা “Download” চাপুন।",
        },
      ],
      tips: [
        "রাখা রিপোর্ট “Reports” তালিকায় থাকে। “Everyone's” বা “Only mine” দিয়ে বেছে নিন।",
        "রাখা রিপোর্ট খুলে “Show on screen” (একই দিনের জন্য) বা “Make it again” করা যায়। যিনি বানিয়েছেন তিনি বা Super Admin “Delete” করতে পারেন।",
        "যে রিপোর্টের কোনো হিসাব আপনার ভূমিকায় খোলা নেই, সেটি আপনার জন্য খুলবে না।",
      ],
    },
    {
      slug: "reports-printed-documents",
      title: "আগে ছাপা PDF (Printed documents) খুঁজে পাবেন যেভাবে",
      summary:
        "অ্যাপ থেকে তৈরি সব কোটেশন, ইনভয়েস, চালান, রসিদ, স্টেটমেন্ট, ক্রেতার ৩৬০° প্রোফাইল, স্টক শিট, চিঠি ও পে-স্লিপ আবার খোলা বা নামানো।",
      keywords: [
        "printed documents",
        "pdf",
        "download",
        "invoice pdf",
        "challan pdf",
        "money receipt",
        "archive",
        "ছাপা কাগজ",
        "পিডিএফ",
        "ডাউনলোড",
        "পুরোনো ইনভয়েস",
        "ডকুমেন্ট",
      ],
      routes: ["/reports/documents"],
      who: "প্রত্যেকে শুধু সেই ধরনের কাগজ দেখেন যা তাঁর ভূমিকা ছাপতে পারে। যেমন Sales Executive বিক্রির কাগজ, স্টেটমেন্ট, স্টক শিট ও চিঠি।",
      steps: [
        {
          text: "“Reports & documents” > “Printed documents” ট্যাব খুলুন। সর্বশেষ কাগজ আগে থাকে।",
          image: {
            id: "reports-printed-documents-1",
            caption: "“Printed documents” ট্যাব: ধরন বাছাই ও কাগজের তালিকা",
          },
        },
        {
          text: "“Kind of document” থেকে ধরন বেছে নিন (যেমন ইনভয়েস বা চালান), সব দেখতে “Every kind of document”।",
        },
        {
          text: "প্রতিটি সারিতে “Open” (ব্রাউজারে খোলা) ও “Download” (নামানো) পাবেন। “For”-এ চাপলে যে রেকর্ডের জন্য ছাপা হয়েছিল সেটি খুলবে।",
        },
      ],
      tips: [
        "খুব পুরোনো কোনো ফাইল আর রাখা না থাকলে “File no longer kept” লেখা থাকে। মূল রেকর্ড থেকে আবার PDF বানান।",
      ],
    },
    {
      slug: "reports-letter",
      title: "লেটারহেডে চিঠি লিখবেন যেভাবে",
      summary:
        "খালি লেটারহেড ছাপা, অথবা কোম্পানির চিঠির টেমপ্লেটে কোনো ক্রেতা বা সরবরাহকারীকে উদ্দেশ করে চিঠি তৈরি করা।",
      keywords: [
        "letter",
        "write a letter",
        "letterhead",
        "blank letterhead",
        "pad",
        "চিঠি",
        "লেটারহেড",
        "প্যাড",
        "চিঠি লেখা",
        "অফিসিয়াল চিঠি",
      ],
      routes: ["/reports/documents"],
      who: "যাঁদের চিঠি লেখার অনুমতি আছে: Super Admin, Accounts, Production Manager ও Sales Executive।",
      anyOf: ["documents.letterhead"],
      steps: [
        {
          text: "“Printed documents” ট্যাবে “Letters” অংশে যান।",
          image: {
            id: "reports-letter-1",
            caption: "“Letters” অংশ: “Blank letterhead” ও “Write a letter”",
          },
        },
        {
          text: "হাতে লেখার জন্য খালি প্যাড চাইলে “Blank letterhead”-এর PDF খুলে ছাপুন।",
        },
        {
          text: "টেমপ্লেটে চিঠি লিখতে “Write a letter” চাপুন। টেমপ্লেট বেছে নিন এবং “To (optional)”-এ “Find a buyer or supplier” দিয়ে প্রাপক বেছে নিন।",
        },
        { text: "“Make the letter” চাপুন। তৈরি PDF খুলুন বা নামান।" },
      ],
      tips: [
        "চিঠির টেমপ্লেট না থাকলে Super Admin “Templates” ট্যাবে একটি যোগ করবেন।",
        "লেটারহেডের লোগো, রং ও ফুটার Settings-এর “Company” ট্যাবে ঠিক হয়।",
      ],
    },
    {
      slug: "reports-template-add",
      title: "কোম্পানির নিজস্ব ডিজাইনের টেমপ্লেট যোগ করবেন যেভাবে",
      summary:
        "কোটেশন, প্রোফর্মা, ইনভয়েস, চালান বা চিঠির জন্য নিজেদের Word, HTML, PDF বা প্যাডের ছবি টেমপ্লেট হিসেবে যোগ করা।",
      keywords: [
        "template",
        "add a template",
        "word",
        "docx",
        "html",
        "custom design",
        "invoice template",
        "টেমপ্লেট",
        "নিজস্ব ডিজাইন",
        "ইনভয়েসের ডিজাইন",
        "ওয়ার্ড ফাইল",
      ],
      routes: ["/reports/templates"],
      who: "যাঁদের টেমপ্লেট সামলানোর অনুমতি আছে: শুরুতে শুধু Super Admin।",
      anyOf: ["templates.manage"],
      steps: [
        {
          text: "“Reports & documents” > “Templates” ট্যাবে “Add a template” চাপুন।",
          image: {
            id: "reports-template-add-1",
            caption: "“Templates” ট্যাবে “Add a template” ও “Write an HTML template”",
          },
        },
        {
          text: "“Name” দিন, “For”-এ কোন কাগজের জন্য (কোটেশন, প্রোফর্মা, ইনভয়েস, চালান বা চিঠি) বেছে নিন।",
        },
        {
          text: "“File”-এ Word ফাইল (.docx), PDF, HTML পাতা, অথবা প্যাডের JPG বা PNG ছবি দিন (১০ MB পর্যন্ত)। এই ধরনের কাগজে শুরুতেই এটি চাইলে “Offer it first” টিক দিন। “Upload” চাপুন।",
        },
        {
          text: "Word বা HTML ফাইলে যেখানে তথ্য বসবে সেখানে ট্যাগ লিখুন, যেমন {BuyerName}। “Tags you can use”-এ সব ট্যাগের তালিকা ও “Copy” বোতাম আছে।",
        },
        {
          text: "ফাইল না থাকলে “Write an HTML template” চাপুন। একটি শুরুর পাতা আসবে, সেটি বদলে “Save the template” চাপুন।",
        },
      ],
      tips: [
        "টেমপ্লেট থাকলে কোটেশন, প্রোফর্মা, ইনভয়েস ও চালানের “PDF”-এর পাশে “Template” বোতাম দেখাবে।",
      ],
    },
    {
      slug: "reports-template-tags",
      title: "টেমপ্লেটের ট্যাগ মেলাবেন ও পরীক্ষা করবেন যেভাবে",
      summary:
        "চেনা যায়নি এমন ট্যাগে কী ছাপবে বেছে দেওয়া, PDF বা ছবিতে ট্যাগ বসানো, নমুনা দিয়ে পরীক্ষা, আর টেমপ্লেট বন্ধ, নাম বদল বা মোছা।",
      keywords: [
        "tags",
        "try it",
        "place tags",
        "template settings",
        "switch off",
        "offer it first",
        "ট্যাগ",
        "টেমপ্লেট পরীক্ষা",
        "ট্যাগ বসানো",
        "টেমপ্লেট বন্ধ",
      ],
      routes: ["/reports/templates"],
      who: "যাঁদের টেমপ্লেট সামলানোর অনুমতি আছে: শুরুতে শুধু Super Admin।",
      anyOf: ["templates.manage"],
      steps: [
        {
          text: "টেমপ্লেট খুলুন। Word বা HTML হলে “What the tags print”-এ প্রতিটি ট্যাগের তথ্য দেখাবে। চেনা যায়নি এমন ট্যাগে তালিকা থেকে বেছে দিন, তারপর “Save what the tags print”।",
        },
        {
          text: "PDF বা ছবি হলে “Where the tags print”-এ “Add a tag” চাপুন, পাতায় ক্লিক করে জায়গা দিন। “Text size”, “Width (mm)”, “Line up”, “Bold” ঠিক করে “Save the placed tags” চাপুন।",
          image: {
            id: "reports-template-tags-1",
            caption: "PDF টেমপ্লেটের পাতায় ট্যাগ বসানো ও পাশের সেটিংস",
          },
        },
        {
          text: "“Try it on …” চাপলে ওই ধরনের সর্বশেষ রেকর্ড দিয়ে নমুনা PDF তৈরি হবে। দেখে নিন সব ঠিক জায়গায় ছাপছে কি না।",
        },
        {
          text: "মেনু থেকে “Rename”, “Replace the file”, “Edit the HTML”, “Offer it first”, “Switch off” (কেউ ব্যবহার করতে পারবে না) বা “Delete” করা যায়।",
        },
      ],
      tips: ["টেমপ্লেট মুছলেও তা থেকে আগে তৈরি কাগজ “Printed documents”-এ থেকে যায়।"],
    },
  ],
};
