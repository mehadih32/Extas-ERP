import type { HelpSection } from "../types";

/** Buyers & suppliers: their profiles, grades, statements, opening balances and dues. */
export const partiesHelp: HelpSection = {
  id: "parties",
  title: "ক্রেতা ও সরবরাহকারী (Buyers & suppliers)",
  description:
    "প্রতিটি ক্রেতা ও সরবরাহকারীর প্রোফাইল, ৩৬০° হিসাব, যোগাযোগ, গ্রেড, Blue Verified চিহ্ন, সরবরাহকারীর ধরন (Fabric, Accessories, FOB, CM), পাওনা-দেনা, হিসাবের স্টেটমেন্ট আর কে কত বকেয়া (Dues)।",
  href: "/parties",
  articles: [
    {
      slug: "parties-find",
      title: "ক্রেতা বা সরবরাহকারী খুঁজবেন ও প্রোফাইল দেখবেন যেভাবে",
      summary:
        "নাম, কোড, ফোন বা ইমেইল দিয়ে খোঁজা, গ্রেড ও অবস্থা দিয়ে ছাঁকা, আর প্রোফাইলে ব্যালান্স, ক্রেডিট ও ব্যবসার হিসাব দেখা।",
      keywords: [
        "buyers",
        "suppliers",
        "parties",
        "customer",
        "profile",
        "balance",
        "owes you",
        "you owe",
        "ক্রেতা",
        "সরবরাহকারী",
        "কাস্টমার",
        "সাপ্লায়ার",
        "পার্টি",
        "প্রোফাইল",
      ],
      routes: ["/parties/buyers", "/parties/suppliers", "/parties"],
      who: "যাঁরা ক্রেতা ও সরবরাহকারী দেখতে পারেন: Super Admin, Sales Executive, Accounts ও Production Manager।",
      anyOf: ["parties.view"],
      steps: [
        {
          text: "মেনু থেকে “Buyers & suppliers” খুলুন (ফোনে “Parties”)। “Buyers” বা “Suppliers” ট্যাব বেছে নিন।",
          image: {
            id: "parties-find-1",
            caption: "“Buyers” ট্যাবের তালিকা: নাম, ধরন, যোগাযোগ, শহর, গ্রেড ও ব্যালান্স",
          },
        },
        {
          text: "খোঁজার ঘরে নাম, কোড, যোগাযোগের মানুষ, ফোন বা ইমেইল লিখুন। “Status”, “Grade”, “Buyer type” ও “Blue Verified only” দিয়ে ছাঁকুন। “Clear filters” দিয়ে আবার সব দেখুন।",
        },
        {
          text: "“Suppliers” ট্যাবে “Buyer type”-এর জায়গায় “All categories” বাছাই থাকে: “Fabric”, “Accessories”, “FOB” বা “CM (Factory)” বেছে শুধু সেই ধরনের সরবরাহকারী দেখুন। তালিকার “Category” কলামে প্রত্যেকে কী সরবরাহ করেন তা লেখা থাকে।",
        },
        {
          text: "তালিকার “Balance”-এ “Owes you” মানে তাঁর কাছে আপনার পাওনা, “You owe” মানে আপনার দেনা, “Settled” মানে কিছু বাকি নেই।",
        },
        {
          text: "নামে চাপলে প্রোফাইল খুলবে: “Balance”, “Credit limit”, “Credit left”, “Payment terms”, “Last payment”, “Last business” ও “Opening balance”।",
          image: {
            id: "parties-find-2",
            caption: "প্রোফাইল পাতা: ব্যালান্স, ক্রেডিট, যোগাযোগ ও “Business so far”",
          },
        },
        {
          text: "“Contact”-এ ফোন, WhatsApp ও ইমেইলে চাপলে ফোনের নিজের অ্যাপ খুলবে। “Business so far”-এ কয়টি কোটেশন, অর্ডার, ইনভয়েস, বিল ও প্রোডাকশন প্রজেক্ট আছে দেখাবে।",
        },
      ],
      tips: [
        "যিনি ক্রেতা ও সরবরাহকারী দুটোই, তিনি দুই তালিকাতেই দেখাবেন।",
        "অন্য কোনো অ্যাকাউন্টে একই ফোন বা ইমেইল থাকলে প্রোফাইলে সতর্কবার্তা আসে, যাতে একই মানুষকে দুবার যোগ না করেন।",
      ],
    },
    {
      slug: "parties-buyer-360",
      title: "ক্রেতার ৩৬০° প্রোফাইল (Customer 360°) দেখবেন যেভাবে",
      summary:
        "এক পাতায় ক্রেতার মোট বিক্রি, গড় অর্ডার, পাওনা, মেয়াদোত্তীর্ণ বকেয়া, মোট লাভ (Gross profit), সবচেয়ে বেশি কেনা স্টাইল আর অর্ডার, কোটেশন, পেমেন্ট, প্রোডাকশন ও কাগজের পুরো ইতিহাস।",
      keywords: [
        "customer 360",
        "buyer 360",
        "360",
        "total sales",
        "average order",
        "outstanding",
        "overdue",
        "gross profit",
        "margin",
        "top style",
        "order history",
        "payment history",
        "৩৬০",
        "মোট বিক্রি",
        "গড় অর্ডার",
        "মেয়াদোত্তীর্ণ",
        "লাভ",
        "ক্রেতার ইতিহাস",
      ],
      routes: ["/parties/buyers"],
      who: "যাঁরা ক্রেতা দেখতে পারেন। কে কোন অংশ দেখবেন তা ভূমিকা অনুযায়ী: বিক্রির হিসাব ও ইতিহাস Sales Executive, Accounts ও Super Admin; লাভ শুধু Accounts ও Super Admin; প্রোডাকশন Production Manager, Accounts ও Super Admin।",
      anyOf: ["parties.view"],
      steps: [
        {
          text: "“Buyers” ট্যাবে ক্রেতার নামে চাপুন। প্রোফাইলের ওপরে “At a glance” অংশে এক নজরে হিসাব: “Total sales”, “Average order”, “Outstanding”, “Overdue” ও “Gross profit”।",
          image: {
            id: "parties-buyer-360-1",
            caption:
              "ক্রেতার প্রোফাইলের “At a glance”: মোট বিক্রি, গড় অর্ডার, পাওনা, মেয়াদোত্তীর্ণ ও মোট লাভ",
          },
        },
        {
          text: "“Total sales” মানে ইনভয়েস হওয়া পণ্যের দাম, ছাড় বাদ দিয়ে, ডেলিভারি চার্জ ও VAT ছাড়া। বাতিল অর্ডার বা বাতিল (void) ইনভয়েস ধরা হয় না। “Average order” হলো মোট বিক্রিকে ইনভয়েস হওয়া অর্ডারের সংখ্যা দিয়ে ভাগ।",
        },
        {
          text: "“Outstanding” হলো আজ তাঁর কাছে আপনার মোট পাওনা। “Overdue” হলো যেসব ইনভয়েসের পরিশোধের তারিখ পেরিয়ে গেছে তাদের বাকি টাকা; বাকি থাকলে লাল দেখায়, সঙ্গে কয়টি ইনভয়েস ও সবচেয়ে পুরোনোটি কত দিন দেরি।",
        },
        {
          text: "“Gross profit” হলো বিক্রি থেকে ওই পণ্যের খরচ (landed cost: কেনা বা তৈরির খরচ) বাদ দিয়ে যা থাকে, সঙ্গে লাভের হার (margin)। অফিস ভাড়া, বেতনের মতো অফিস খরচ এখানে ধরা হয় না।",
        },
        {
          text: "বাঁ পাশে “Styles bought most”-এ তিনি কোন স্টাইল সবচেয়ে বেশি কিনেছেন: অর্ডার, পিস, টাকা আর মোট কেনার কত ভাগ। লাভ দেখার অনুমতি থাকলে প্রতিটির লাভও দেখাবে।",
        },
        {
          text: "নিচে ইতিহাস: “Orders”, “Quotations”, “Payments received” (ফেরত দেওয়া টাকা থাকলে “Refunds”-সহ), “Production” ও “Documents”। প্রতিটিতে সর্বশেষ ৮টি থাকে; বাকিগুলো দেখতে “Show all …”, আবার ছোট করতে “Show fewer” চাপুন। যেকোনো সারিতে চাপলে সেই অর্ডার, রসিদ বা প্রজেক্ট খুলবে।",
          image: {
            id: "parties-buyer-360-2",
            caption: "ক্রেতার ইতিহাস: অর্ডার, কোটেশন, পেমেন্ট, প্রোডাকশন ও ছাপা কাগজ",
          },
        },
      ],
      tips: [
        "যে অংশ আপনার ভূমিকায় দেখা যায় না, সেটি পাতায় আসেই না। যেমন Sales Executive লাভ দেখেন না, Production Manager বিক্রির হিসাব দেখেন না।",
        "“Walk-in customers” অ্যাকাউন্টের ৩৬০° পাতায় কাউন্টার, ওয়েবসাইট ও সোশ্যাল মিডিয়ার নামবিহীন সব বিক্রি থাকে।",
        "মোট লাভে ডেলিভারি হয়ে যাওয়া পণ্য তার বের হওয়ার দিনের খরচে, বাকিটা SKU-র গড় খরচে ধরা হয়; ড্যাশবোর্ডের সবচেয়ে বেশি বিক্রির হিসাবের সঙ্গে মিলবে।",
      ],
    },
    {
      slug: "parties-buyer-360-pdf",
      title: "ক্রেতার পুরো ইতিহাস এক PDF-এ নেবেন যেভাবে",
      summary:
        "এক ক্লিকে ক্রেতার ৩৬০° প্রোফাইলের সব হিসাব ও পুরো ইতিহাস লেটারহেডে PDF করা; ইমেইলে পাঠানো ইন্টিগ্রেশনের সঙ্গে আসবে।",
      keywords: [
        "360 pdf",
        "buyer profile pdf",
        "customer history pdf",
        "export",
        "email",
        "integration pending",
        "পিডিএফ",
        "ক্রেতার প্রোফাইল",
        "ইমেইল",
        "ডাউনলোড",
      ],
      routes: ["/parties/buyers"],
      who: "যাঁরা ক্রেতা দেখতে পারেন। PDF-এ শুধু সেই হিসাব থাকে যা আপনার ভূমিকা দেখতে পারে।",
      anyOf: ["parties.view"],
      steps: [
        {
          text: "ক্রেতার প্রোফাইলে “360° PDF” চাপুন। কিছুক্ষণ পর জানালা খুলবে; “Open the PDF” চাপলে ব্রাউজারে দেখবেন, “Download” চাপলে নামবে।",
          image: {
            id: "parties-buyer-360-pdf-1",
            caption: "প্রোফাইলের ওপরের বোতাম: “360° PDF” ও “Email”",
          },
        },
        {
          text: "PDF-এ থাকে আজকের তারিখ পর্যন্ত মোট বিক্রি, গড় অর্ডার, পাওনা, মেয়াদোত্তীর্ণ বকেয়া, মোট লাভ, সবচেয়ে বেশি কেনা স্টাইল আর সব অর্ডার, কোটেশন, পেমেন্ট, ফেরত ও প্রোডাকশনের তালিকা।",
        },
        {
          text: "“Email” বোতাম এখনো কাজ করে না: চাপলে “Integration Pending” বার্তা আসে। ততদিন PDF নামিয়ে নিজের ইমেইলে সংযুক্ত করে পাঠান।",
        },
      ],
      tips: [
        "একই দিনে কিছু না বদলালে আবার চাপলে আগের PDF-ই ফেরত আসে, নতুন কপি হয় না।",
        "তৈরি করা PDF “Reports & documents” > “Printed documents”-এ ও প্রোফাইলের “Documents”-এ থাকে। যে PDF-এ লাভ বা প্রোডাকশন আছে, তা শুধু তাঁরাই খুলতে পারেন যাঁরা ওই অংশ দেখার অনুমতি রাখেন।",
      ],
    },
    {
      slug: "parties-supplier-360",
      title: "সরবরাহকারীর ৩৬০° প্রোফাইল (Supplier 360°) দেখবেন যেভাবে",
      summary:
        "এক পাতায় সরবরাহকারীর কাছে মোট দেনা, মোট বিল ও পরিশোধ, চলমান ও শেষ হওয়া প্রজেক্ট (প্রতিটির হিসাব মেলানোসহ), মাল ডেলিভারি, পারচেজ অর্ডার, বিল, পেমেন্ট ও কাগজের পুরো ইতিহাস।",
      keywords: [
        "supplier 360",
        "360",
        "due to them",
        "master ledger",
        "running ledger",
        "active projects",
        "completed projects",
        "settled",
        "deliveries",
        "purchase orders",
        "supplier bills",
        "fob",
        "cm",
        "fabric",
        "accessories",
        "সরবরাহকারীর হিসাব",
        "দেনা",
        "প্রজেক্টের হিসাব",
        "ডেলিভারি",
        "ফ্যাক্টরি",
      ],
      routes: ["/parties/suppliers"],
      who: "যাঁরা সরবরাহকারী দেখতে পারেন। কে কোন অংশ দেখবেন তা ভূমিকা অনুযায়ী: টাকার অঙ্ক (বিল, পেমেন্ট, প্রজেক্টের পাওনা) Production Manager, Accounts ও Super Admin; প্রজেক্ট ও তৈরি পণ্যের ডেলিভারি যাঁরা প্রোডাকশন দেখেন; পারচেজ অর্ডার ও কাঁচামালের ডেলিভারি যাঁরা কাঁচামাল দেখেন। Sales Executive শুধু প্রোফাইলের ব্যালান্স দেখেন।",
      anyOf: ["parties.view"],
      steps: [
        {
          text: "“Suppliers” ট্যাবে সরবরাহকারীর নামে চাপুন। নামের নিচে তাঁর ধরন (যেমন “FOB”, “CM (Factory)”) দেখাবে। ওপরে “At a glance” অংশে এক নজরে: “Due to them”, “Billed in all”, “Open bills”, “Paid to them”, “Projects” ও “Deliveries”।",
          image: {
            id: "parties-supplier-360-1",
            caption:
              "সরবরাহকারীর প্রোফাইলের “At a glance”: দেনা, মোট বিল, খোলা বিল, পরিশোধ, প্রজেক্ট ও ডেলিভারি",
          },
        },
        {
          text: "“Due to them” হলো তাঁর মূল খাতায় (master ledger) আজ আপনার মোট দেনা: সব বিল, বাকিতে খরচ ও শুরুর ব্যালান্স থেকে পরিশোধ বাদ দিয়ে। শেষ হওয়া প্রজেক্টের বাকি টাকাও এখানেই থাকে।",
        },
        {
          text: "“Active projects”-এ চলমান প্রজেক্ট: প্রতিটিতে তাঁর বিল (“Billed”), পরিশোধ (“paid”) আর ওই প্রজেক্টে এখনো কত বাকি। তিনি প্রজেক্টের ফ্যাক্টরি হলে “Their factory” লেখা থাকে।",
          image: {
            id: "parties-supplier-360-2",
            caption:
              "“Active projects” ও “Completed projects”: প্রতিটি প্রজেক্টে বিল, পরিশোধ ও বাকি",
          },
        },
        {
          text: "“Completed projects”-এ শেষ হওয়া প্রজেক্ট “Settled” চিহ্নসহ: প্রজেক্ট শেষ হওয়ার দিন তাঁর বিল ও পরিশোধ মিলিয়ে হিসাব রাখা হয়েছে, প্রজেক্টের ব্যালান্স শূন্য (“Balance zero”), আর যা বাকি ছিল তা তাঁর মূল খাতায় চলে গেছে। পরে তার কত শোধ হলো তাও লেখা থাকে।",
        },
        {
          text: "“Deliveries”-এ তিনি যা দিয়েছেন: “Raw materials” (তাঁর কাছ থেকে কেনা কাপড় বা অ্যাক্সেসরিজ, কোন স্টোরে ঢুকেছে) আর “Finished goods” (তাঁর ফ্যাক্টরি থেকে প্রজেক্টের তৈরি পণ্য, A ও B গ্রেডের পিস)। নিচে “Purchase orders”, “Bills”, “Payments made” ও “Documents”।",
          image: {
            id: "parties-supplier-360-3",
            caption: "ডেলিভারি, পারচেজ অর্ডার, বিল, পেমেন্ট ও ছাপা কাগজের তালিকা",
          },
        },
        {
          text: "প্রতিটি তালিকায় সর্বশেষ ৮টি থাকে; বাকিগুলো দেখতে “Show all …”, ছোট করতে “Show fewer” চাপুন। সারিতে চাপলে সেই প্রজেক্ট, বিল, ডেলিভারি বা পেমেন্ট খুলবে।",
        },
        {
          text: "Accounts হলে ওপরে “Pay supplier” চাপুন, অথবা কোনো প্রজেক্টের নিচের “Pay for …” লিংকে চাপলে সেই প্রজেক্ট আগে থেকে বাছাই করা পেমেন্ট ফর্ম খুলবে।",
        },
      ],
      tips: [
        "“Fabric”, “FOB” ও “CM (Factory)” সরবরাহকারীর হিসাব প্রজেক্ট ধরে মেলানো হয়। শুধু “Accessories” হলে তাঁর হিসাব একটানা খাতায় চলে (running ledger), প্রজেক্ট শেষ হলেও আলাদা করে মেলানো হয় না।",
        "একটি বিল দুই প্রজেক্টে ভাগ করা থাকলে প্রতিটি প্রজেক্টে তার নিজের অংশ ধরা হয়, পরিশোধও সেই অনুপাতে।",
        "যে অংশ আপনার ভূমিকায় দেখা যায় না, সেটি পাতায় আসেই না; টাকার অঙ্ক না দেখলেও প্রজেক্ট ও ডেলিভারির তালিকা দেখা যায়।",
      ],
    },
    {
      slug: "parties-supplier-360-pdf",
      title: "সরবরাহকারীর পুরো হিসাব এক PDF-এ নেবেন যেভাবে",
      summary:
        "এক ক্লিকে সরবরাহকারীর ৩৬০° প্রোফাইলের দেনা, প্রজেক্ট, ডেলিভারি, বিল ও পেমেন্ট লেটারহেডে PDF করা; ইমেইলে পাঠানো ইন্টিগ্রেশনের সঙ্গে আসবে।",
      keywords: [
        "supplier 360 pdf",
        "supplier profile pdf",
        "supplier history pdf",
        "export",
        "email",
        "integration pending",
        "পিডিএফ",
        "সরবরাহকারীর প্রোফাইল",
        "ইমেইল",
        "ডাউনলোড",
      ],
      routes: ["/parties/suppliers"],
      who: "যাঁরা সরবরাহকারী দেখতে পারেন। PDF-এ শুধু সেই হিসাব থাকে যা আপনার ভূমিকা দেখতে পারে।",
      anyOf: ["parties.view"],
      steps: [
        {
          text: "সরবরাহকারীর প্রোফাইলে “360° PDF” চাপুন। কিছুক্ষণ পর জানালা খুলবে; “Open the PDF” চাপলে ব্রাউজারে দেখবেন, “Download” চাপলে নামবে।",
          image: {
            id: "parties-supplier-360-pdf-1",
            caption: "সরবরাহকারীর প্রোফাইলের ওপরের বোতাম: “Pay supplier”, “360° PDF” ও “Email”",
          },
        },
        {
          text: "PDF-এ থাকে আজকের তারিখ পর্যন্ত তাঁর কাছে দেনা, মোট বিল ও পরিশোধ, চলমান ও শেষ হওয়া প্রজেক্ট (প্রতিটির হিসাব মেলানোসহ), সব ডেলিভারি, পারচেজ অর্ডার, বিল ও পেমেন্ট।",
        },
        {
          text: "“Email” বোতাম এখনো কাজ করে না: চাপলে “Integration Pending” বার্তা আসে। ততদিন PDF নামিয়ে নিজের ইমেইলে সংযুক্ত করে পাঠান।",
        },
      ],
      tips: [
        "কিছু না বদলালে আবার চাপলে আগের PDF-ই ফেরত আসে, নতুন কপি হয় না।",
        "তৈরি করা PDF “Reports & documents” > “Printed documents”-এ ও প্রোফাইলের “Documents”-এ থাকে। যে PDF-এ টাকার অঙ্ক বা প্রজেক্ট আছে, তা শুধু তাঁরাই খুলতে পারেন যাঁরা ওই অংশ দেখার অনুমতি রাখেন।",
      ],
    },
    {
      slug: "parties-new",
      title: "নতুন ক্রেতা বা সরবরাহকারী যোগ করবেন যেভাবে",
      summary:
        "নাম, ধরন, যোগাযোগ, ক্রেডিট সীমা ও পরিশোধের মেয়াদ দিয়ে নতুন ক্রেতা, সরবরাহকারী বা ফ্যাক্টরির অ্যাকাউন্ট খোলা।",
      keywords: [
        "new buyer",
        "new supplier",
        "add buyer",
        "add supplier",
        "factory",
        "credit limit",
        "payment terms",
        "নতুন ক্রেতা",
        "নতুন সরবরাহকারী",
        "কাস্টমার যোগ",
        "ফ্যাক্টরি যোগ",
        "ক্রেডিট লিমিট",
      ],
      routes: ["/parties/buyers/new", "/parties/suppliers/new"],
      who: "যাঁদের অ্যাকাউন্ট বদলানোর অনুমতি আছে: Super Admin ও Sales Executive।",
      anyOf: ["parties.manage"],
      steps: [
        {
          text: "“Buyers” ট্যাবে “New buyer” অথবা “Suppliers” ট্যাবে “New supplier” চাপুন।",
        },
        {
          text: "“Who they are” অংশে “Account type” বেছে নিন: “Buyer”, “Supplier” বা দুটোই হলে “Buyer and supplier”। ক্রেতা হলে “Buyer type” (“Retail”, “Wholesale”, “Corporate (B2B)”) দিন।",
          image: {
            id: "parties-new-1",
            caption: "নতুন ক্রেতার ফর্ম: “Account type”, “Buyer type”, নাম ও গ্রেড",
          },
        },
        {
          text: "“Name”, দরকার হলে “Code (optional)” ও “Grade (optional)” দিন।",
        },
        {
          text: "সরবরাহকারী হলে “What they supply (optional)” অংশে যা যা প্রযোজ্য সবগুলোতে টিক দিন: “Fabric” (কাপড়), “Accessories” (বোতাম, লেবেল, ট্রিমস), “FOB” (অর্ডারমতো তৈরি পণ্য) বা “CM (Factory)” (কাটিং-সেলাইয়ের ফ্যাক্টরি)। একটি ফ্যাক্টরি একসঙ্গে “CM (Factory)” ও “FOB” দুটোই হতে পারে।",
        },
        {
          text: "“Contact” অংশে “Contact person (optional)”, “Email (optional)”, “Phone (optional)”, “WhatsApp (optional)”, “Address (optional)”, “City (optional)” ও “Country” দিন।",
        },
        {
          text: "“Terms” অংশে ক্রেতা সর্বোচ্চ কত বাকি রাখতে পারবেন (“Credit limit”, ফাঁকা মানে সীমা নেই), কত দিনে টাকা দেবেন (“Payment terms (days)”) ও “Tax ID (optional)” দিন।",
        },
        { text: "নোট লিখে “Add the buyer” (বা “Add the supplier”) চাপুন। নতুন প্রোফাইল খুলবে।" },
      ],
    },
    {
      slug: "parties-edit-status",
      title: "প্রোফাইল বদলাবেন, গ্রেড বা Blue Verified দেবেন যেভাবে",
      summary:
        "তথ্য বদলানো, A+ থেকে C গ্রেড দেওয়া, বিশ্বস্তদের Blue Verified চিহ্ন দেওয়া, আর অ্যাকাউন্ট নিষ্ক্রিয়, বন্ধ বা আবার চালু করা।",
      keywords: [
        "edit details",
        "grade",
        "blue verified",
        "dormant",
        "close the account",
        "reopen",
        "settling",
        "গ্রেড",
        "ব্লু ভেরিফায়েড",
        "যাচাইকৃত",
        "অ্যাকাউন্ট বন্ধ",
        "নিষ্ক্রিয়",
      ],
      routes: ["/parties/buyers", "/parties/suppliers"],
      who: "যাঁদের অ্যাকাউন্ট বদলানোর অনুমতি আছে: Super Admin ও Sales Executive।",
      anyOf: ["parties.manage"],
      steps: [
        {
          text: "প্রোফাইল খুলুন। তথ্য বদলাতে “Edit details” চাপুন, বদলে “Save changes” চাপুন।",
        },
        {
          text: "গ্রেড দিতে “Give a grade” (বা “Change the grade”) চাপুন, “A+”, “A”, “B”, “C” বা “No grade” বেছে “Save the grade” চাপুন।",
          image: {
            id: "parties-edit-status-1",
            caption: "প্রোফাইলের কাজের মেনু: গ্রেড, Blue Verified, অবস্থা ও স্টেটমেন্ট",
          },
        },
        {
          text: "বিশ্বস্ত অ্যাকাউন্টে নীল টিক দিতে “Give the Blue Verified badge”, সরাতে “Remove the Blue Verified badge” চাপুন।",
        },
        {
          text: "কিছু দিন অর্ডার না দেওয়া ক্রেতাকে “Mark as dormant” করুন, পরের অর্ডারে নিজে থেকেই সক্রিয় হবে। ব্যবসা বন্ধ করতে “Close the account”, চাইলে “Reason (optional)” লিখে নিশ্চিত করুন। আবার চালু করতে “Reopen”।",
        },
      ],
      tips: [
        "সরবরাহকারীর ধরন বদলাতে “Edit details”-এ “What they supply (optional)”-এর টিক বদলান। কাউকে শুধু ক্রেতা বানালে তাঁর ধরন মুছে যায়।",
        "পাওনা বা দেনা বাকি থাকা অবস্থায় বন্ধ করলে অ্যাকাউন্ট “Settling” হয়; ব্যালান্স শূন্য হলে বন্ধ হয়ে যায়।",
        "টাকা বাকি থাকলে ক্রেতাকে সরবরাহকারী (বা উল্টোটা) বানানো যায় না, তবে “Buyer and supplier” করা সবসময় যায়।",
        "“Walk-in customers” অ্যাকাউন্টটি সিস্টেমের, এর শুধু নাম ও নোট বদলানো যায়।",
      ],
    },
    {
      slug: "parties-statement",
      title: "ক্রেতা বা সরবরাহকারীর হিসাবের স্টেটমেন্ট দেখবেন ও ছাপবেন যেভাবে",
      summary:
        "যেকোনো সময়ের শুরুর ব্যালান্স, প্রতিটি লেনদেন, চলমান ব্যালান্স ও শেষ ব্যালান্স দেখা আর লেটারহেডে PDF ছাপা।",
      keywords: [
        "statement",
        "statement of account",
        "ledger",
        "running balance",
        "debit",
        "credit",
        "pdf",
        "স্টেটমেন্ট",
        "হিসাব বিবরণী",
        "লেজার",
        "খতিয়ান",
        "বকেয়ার হিসাব",
      ],
      routes: ["/parties/buyers", "/parties/suppliers"],
      who: "যাঁরা স্টেটমেন্ট দেখতে পারেন: Super Admin, Sales Executive ও Accounts।",
      anyOf: ["parties.ledger.view"],
      steps: [
        { text: "প্রোফাইলে “Statement” চাপুন।" },
        {
          text: "সময় বেছে নিন: “Whole account”, “This month”, “Last 90 days”, “This year”, অথবা “From” ও “To” দিয়ে “Show these days”।",
          image: {
            id: "parties-statement-1",
            caption: "স্টেটমেন্ট পাতা: সময় বাছাই, সারাংশ ও লেনদেনের তালিকা",
          },
        },
        {
          text: "“Summary”-তে “Opening balance”, “Total debit”, “Total credit” ও “Closing balance”। নিচে প্রতিটি লেনদেন চলমান “Balance”-সহ। “Dr” মানে তাঁর কাছে কোম্পানির পাওনা, “Cr” মানে কোম্পানির কাছে তাঁর পাওনা।",
        },
        {
          text: "ছাপতে বা পাঠাতে “Statement (PDF)” চাপুন। কোম্পানির লেটারহেডে সারাংশ ও সব লেনদেন আসবে।",
        },
      ],
    },
    {
      slug: "parties-opening-balance",
      title: "শুরুর পাওনা-দেনা (Opening balance) দেবেন যেভাবে",
      summary:
        "Extas ERP শুরুর আগে কোনো ক্রেতা বা সরবরাহকারীর সঙ্গে যে পাওনা বা দেনা ছিল, তা একবার লিখে দেওয়া।",
      keywords: [
        "opening balance",
        "previous due",
        "old balance",
        "brought forward",
        "শুরুর ব্যালান্স",
        "আগের বকেয়া",
        "পুরোনো পাওনা",
        "পুরোনো দেনা",
      ],
      routes: ["/parties/buyers", "/parties/suppliers"],
      who: "শুধু Accounts ও Super Admin (হিসাবের খাতায় যায়)।",
      anyOf: ["accounts.manage"],
      steps: [
        { text: "ক্রেতা বা সরবরাহকারীর প্রোফাইল খুলে “Set the opening balance” চাপুন।" },
        {
          text: "দিক বেছে নিন: “… owed you” (তিনি আপনার কাছে ঋণী ছিলেন) অথবা “You owed …” (আপনি তাঁর কাছে ঋণী ছিলেন, যেমন বাকি বিল বা তাঁর দেওয়া অগ্রিম)।",
          image: {
            id: "parties-opening-balance-1",
            caption: "“Opening balance” জানালা: দুই দিকের বাছাই, পরিমাণ ও “As of”",
          },
        },
        {
          text: "পরিমাণ ও “As of” (কোন তারিখের হিসাব) দিয়ে “Save the opening balance” চাপুন।",
        },
      ],
    },
    {
      slug: "parties-dues",
      title: "কে কত বকেয়া (Dues) দেখবেন যেভাবে",
      summary: "আজ পর্যন্ত ক্রেতাদের কাছে মোট পাওনা আর সরবরাহকারীদের মোট দেনা, বড় অঙ্ক আগে।",
      keywords: [
        "dues",
        "receivable",
        "payable",
        "owed to you",
        "you owe",
        "outstanding",
        "বকেয়া",
        "পাওনা",
        "দেনা",
        "বাকি",
        "আদায়যোগ্য",
      ],
      routes: ["/parties/dues"],
      who: "যাঁরা স্টেটমেন্ট দেখতে পারেন: Super Admin, Sales Executive ও Accounts।",
      anyOf: ["parties.ledger.view"],
      steps: [
        {
          text: "“Buyers & suppliers” > “Dues” ট্যাব খুলুন।",
          image: {
            id: "parties-dues-1",
            caption: "“Dues” ট্যাব: “Owed to you” ও “You owe” তালিকা",
          },
        },
        {
          text: "“Owed to you”-এ ক্রেতারা কে কত দেবেন, “You owe”-এ আপনি কোন সরবরাহকারীকে কত দেবেন, বড় অঙ্ক আগে।",
        },
        {
          text: "যেকোনো সারির “Statement”-এ চাপলে তাঁর পুরো হিসাব খুলবে।",
        },
      ],
    },
  ],
};
