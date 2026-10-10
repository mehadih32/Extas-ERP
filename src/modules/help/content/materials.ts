import type { HelpSection } from "../types";

/** Raw materials: stock in each store, purchase orders, purchases, returns and issue notes. */
export const materialsHelp: HelpSection = {
  id: "materials",
  title: "কাঁচামাল (Raw materials)",
  description:
    "কাপড়, ট্রিমস, এক্সেসরিজ ও প্যাকেজিং: কোন স্টোরে কত আছে, সরবরাহকারীকে অর্ডার, মাল গ্রহণ ও বিল, ফেরত পাঠানো আর উৎপাদনে দেওয়া।",
  href: "/materials",
  articles: [
    {
      slug: "materials-overview",
      title: "কাঁচামালের সারসংক্ষেপ দেখবেন যেভাবে",
      summary:
        "কয়টি কাঁচামাল আছে, কোনগুলো ফুরিয়ে আসছে, কোন অর্ডার দেরিতে আর কোন স্টোরে কী আছে তা এক নজরে দেখা।",
      keywords: [
        "raw materials",
        "materials overview",
        "running low",
        "late orders",
        "stores",
        "reorder",
        "কাঁচামাল",
        "কাপড়",
        "ট্রিমস",
        "ফুরিয়ে আসছে",
        "স্টোর",
      ],
      routes: ["/materials"],
      who: "যাঁরা কাঁচামাল দেখতে পারেন: Super Admin, Production Manager, Accounts ও Warehouse Team। টাকার অঙ্ক শুধু যাঁরা দাম দেখতে পারেন।",
      steps: [
        {
          text: "মেনু থেকে “Materials” খুলুন। “Overview”-এর উপরে “Materials”, “Running low”, “Open orders”, “Late orders” আর অনুমতি থাকলে “Stock value”।",
          image: {
            id: "materials-overview-1",
            caption: "Raw materials-এর “Overview”: উপরের সংখ্যা ও দ্রুত কাজের বোতাম",
          },
        },
        {
          text: "“Running low” অংশে যে কাঁচামাল নিজের সীমায় বা তার নিচে নেমেছে, আর “Late orders”-এ যে অর্ডারের মাল আসার দিন পেরিয়ে গেছে।",
        },
        {
          text: "“By kind”-এ ধরন অনুযায়ী স্টক, “Stores”-এ প্রতিটি স্টোরে কী আছে, আর “Latest issue notes”-এ সর্বশেষ উৎপাদনে দেওয়া মাল।",
        },
        {
          text: "উপরের বোতাম থেকে সরাসরি “Receive goods”, “New purchase order”, “Issue to production” বা “Add a material” করা যায়।",
        },
      ],
    },
    {
      slug: "materials-add-material",
      title: "নতুন কাঁচামাল তালিকায় যোগ করবেন যেভাবে",
      summary:
        "কাপড় বা ট্রিমসের নাম, ধরন, একক, রং, ফুরানোর সীমা ও সাধারণ সরবরাহকারী দিয়ে নতুন কাঁচামাল যোগ করা।",
      keywords: [
        "add a material",
        "new material",
        "fabric",
        "trims",
        "accessories",
        "packaging",
        "unit",
        "reorder level",
        "নতুন কাঁচামাল",
        "কাপড় যোগ",
        "একক",
        "গজ",
        "কেজি",
      ],
      routes: ["/materials/stock/new", "/materials/stock"],
      who: "Super Admin, Production Manager ও Warehouse Team।",
      anyOf: ["materials.manage", "materials.purchase"],
      steps: [
        {
          text: "“Materials” > “Stock” ট্যাবে “Add a material” চাপুন।",
        },
        {
          text: "“Name” (যেমন Single jersey 160 GSM), “Kind” (কাপড়, ট্রিমস, এক্সেসরিজ, প্যাকেজিং…) ও “Counted in” (কোন এককে গোনা হয়, যেমন কেজি বা গজ) দিন।",
          image: {
            id: "materials-add-material-1",
            caption: "“Add a material” ফর্ম: নাম, ধরন, একক ও ফুরানোর সীমা",
          },
        },
        {
          text: "চাইলে “Colour (optional)”, “Running low at (optional)” (কত নামলে সতর্কতা), “Specification (optional)” ও “Usual supplier (optional)” দিন।",
        },
        {
          text: "“Add the material” চাপুন। কোড না দিলে ধরন অনুযায়ী কোড নিজে থেকে দেওয়া হয় (যেমন FAB-, TRM-, ACC-, PKG-)।",
        },
      ],
      tips: [
        "স্টক বা অর্ডার হয়ে গেলে একক আর বদলানো যায় না।",
        "পরে তথ্য বদলাতে কাঁচামালের পাতায় “Change details” চাপুন।",
      ],
    },
    {
      slug: "materials-stock-card",
      title: "কাঁচামালের স্টক ও স্টক কার্ড দেখবেন যেভাবে",
      summary:
        "কোন কাঁচামাল কোন স্টোরে কত আছে, কত অর্ডারে আছে, আর প্রতিটি আসা-যাওয়া ও তারপর কত রইল দেখা।",
      keywords: [
        "stock card",
        "material stock",
        "on hand",
        "on order",
        "balance",
        "movement",
        "স্টক কার্ড",
        "কাঁচামালের স্টক",
        "কত আছে",
        "হিসাব",
      ],
      routes: ["/materials/stock"],
      who: "যাঁরা কাঁচামাল দেখতে পারেন। Warehouse Team শুধু পরিমাণ দেখেন, দাম নয়।",
      steps: [
        {
          text: "“Materials” > “Stock” ট্যাবে কোড, নাম বা রং দিয়ে খুঁজুন। “Kind”, “Store”, “Running low” ও “Show archived” দিয়ে ছাঁকুন।",
          image: {
            id: "materials-stock-card-1",
            caption: "“Stock” ট্যাবের তালিকা ও ছাঁকনি",
          },
        },
        {
          text: "কাঁচামালে চাপলে “On hand”, “On order”, অনুমতি থাকলে “Average cost” ও “Value”, আর “In each store” দেখবেন।",
        },
        {
          text: "নিচে “Stock card”-এ প্রতিটি আসা (“In”), যাওয়া (“Out”) আর তারপরের “Balance”। “Store” ও “This month”, “Last 90 days” বা “From”-“To” দিয়ে দিন বেছে নিন।",
          image: {
            id: "materials-stock-card-2",
            caption: "স্টক কার্ড: শুরু, এসেছে, গেছে, শেষে আর প্রতিটি লেনদেন",
          },
        },
      ],
    },
    {
      slug: "materials-stock-actions",
      title: "কাঁচামাল গণনা, স্টোর বদল, নষ্ট বাদ ও শুরুর স্টক করবেন যেভাবে",
      summary:
        "স্টোরে গুনে মেলানো, এক স্টোর থেকে অন্যটিতে সরানো, নষ্ট বা হারানো মাল বাদ দেওয়া আর আগের মজুদ তোলা।",
      keywords: [
        "count it",
        "move between stores",
        "write off wastage",
        "wastage",
        "opening stock",
        "archive",
        "গণনা",
        "স্টোর বদল",
        "নষ্ট",
        "অপচয়",
        "শুরুর স্টক",
      ],
      routes: ["/materials/stock"],
      who: "গণনা, সরানো ও নষ্ট বাদ: Super Admin, Production Manager ও Warehouse Team। শুরুর স্টক: Super Admin, Production Manager ও Accounts।",
      anyOf: ["materials.manage", "materials.purchase", "accounts.manage"],
      steps: [
        {
          text: "কাঁচামালের পাতা খুলুন। উপরে কাজের বোতামগুলো থাকে।",
          image: {
            id: "materials-stock-actions-1",
            caption:
              "কাঁচামালের পাতায় “Count it”, “Move between stores”, “Write off wastage” ইত্যাদি বোতাম",
          },
        },
        {
          text: "গুনে মেলাতে “Count it” চাপুন, “Store”, “Counted on” ও স্টোরে আসলে যা আছে লিখে “Save the count” চাপুন। পার্থক্য স্টক কার্ডে লেখা থাকে।",
        },
        {
          text: "অন্য স্টোরে সরাতে “Move between stores” চাপুন, “From”, “To” ও পরিমাণ দিয়ে “Move it” চাপুন। দাম একই থাকে।",
        },
        {
          text: "নষ্ট, পচা বা হারানো মাল বাদ দিতে “Write off wastage” চাপুন, “From the store”, পরিমাণ, “On” ও “What happened” লিখে “Write it off” চাপুন।",
        },
        {
          text: "Extas ERP শুরুর আগে থেকে থাকা মাল তুলতে “Opening stock” চাপুন, “Into the store”, পরিমাণ, খরচ ও “As of” দিয়ে “Add the stock” চাপুন।",
        },
        {
          text: "যে কাঁচামাল আর লাগবে না এবং স্টক শেষ, সেটি “Archive” করুন। আবার লাগলে “Bring back”।",
        },
      ],
    },
    {
      slug: "materials-purchase-order",
      title: "সরবরাহকারীকে পারচেজ অর্ডার দেবেন যেভাবে",
      summary:
        "কোন কাঁচামাল কত পরিমাণে কোন দামে চাই, কবে লাগবে আর কোন প্রজেক্টের জন্য, তা দিয়ে অর্ডার তৈরি ও পরে বদলানো বা বন্ধ করা।",
      keywords: [
        "purchase order",
        "new purchase order",
        "po",
        "raise the order",
        "order more",
        "expected by",
        "late",
        "পারচেজ অর্ডার",
        "কাঁচামাল অর্ডার",
        "অর্ডার দেওয়া",
        "পিও",
        "সরবরাহকারী",
      ],
      routes: ["/materials/orders/new", "/materials/orders"],
      who: "যাঁদের কেনাকাটার অনুমতি আছে: Super Admin ও Production Manager।",
      anyOf: ["materials.purchase"],
      steps: [
        {
          text: "“Materials” > “Purchase orders” ট্যাবে “New purchase order” চাপুন (কাঁচামালের পাতার “Order more” থেকেও যাওয়া যায়)।",
          image: {
            id: "materials-purchase-order-1",
            caption: "“Purchase orders” ট্যাবের তালিকা ও “New purchase order” বোতাম",
          },
        },
        {
          text: "“Supplier”, দরকার হলে “For the project (optional)”, “Order date”, “Expected by (optional)” ও “Their reference (optional)” দিন।",
        },
        {
          text: "“Find a material to order” দিয়ে কাঁচামাল বেছে পরিমাণ ও দাম দিন। “Details for the supplier (optional)”-এ বিশেষ বিবরণ লিখুন (যেমন dyed navy, 72 inch)। আরও যোগ করতে “Add another material”।",
          image: {
            id: "materials-purchase-order-2",
            caption: "অর্ডারের লাইন: কাঁচামাল, পরিমাণ, দাম ও মোট",
          },
        },
        { text: "“Raise the order” চাপুন। “Order total” নিচে দেখাবে।" },
        {
          text: "অর্ডারের পাতায় প্রতিটি লাইনে কত এসেছে দেখবেন। খোলা অর্ডার “Change” দিয়ে বদলানো যায়। কিছু না এলে “Cancel the order”, বাকিটা আর আসবে না হলে “Close: the rest will not come”।",
        },
      ],
      tips: [
        "কিছু মাল এসে গেলে লাইন আর বদলানো যায় না।",
        "অর্ডার বদলালে সরবরাহকারীকে জানাতে ভুলবেন না।",
        "তালিকায় “Late only” দিয়ে শুধু দেরির অর্ডার দেখুন।",
      ],
    },
    {
      slug: "materials-receive-goods",
      title: "কাঁচামাল গ্রহণ ও সরবরাহকারীর বিল লিখবেন যেভাবে",
      summary:
        "অর্ডারের বা অর্ডার ছাড়া আসা মাল স্টোরে তোলা আর সঙ্গে সরবরাহকারীর বিল লেখা, বকেয়া বা এখনই পরিশোধিত।",
      keywords: [
        "receive goods",
        "purchase",
        "supplier bill",
        "grn",
        "bill",
        "pay the supplier",
        "মাল গ্রহণ",
        "কাঁচামাল এসেছে",
        "বিল",
        "ক্রয়",
        "কেনা",
      ],
      routes: ["/materials/purchases/new", "/materials/purchases"],
      who: "যাঁদের কেনাকাটার অনুমতি আছে (Super Admin, Production Manager) বকেয়া বিলে মাল গ্রহণ করেন। Accounts এখনই পরিশোধ করে বা পরে টাকা দেন।",
      anyOf: ["materials.purchase", "accounts.payments.record"],
      steps: [
        {
          text: "অর্ডারের মাল এলে অর্ডারের পাতায় “Receive the goods” চাপুন। অর্ডার ছাড়া এলে “Purchases” ট্যাবে “Receive goods” চাপুন।",
        },
        {
          text: "“Supplier”, “Their bill number (optional)”, “Received on” ও “Into the store” দিন।",
          image: {
            id: "materials-receive-goods-1",
            caption: "“Receive goods” ফর্ম: সরবরাহকারী, বিল নম্বর, স্টোর ও “What came in”",
          },
        },
        {
          text: "“What came in”-এ অর্ডারের বাকি পরিমাণ আগে থেকে বসানো থাকে। যা এসেছে সেই পরিমাণ ও দাম ঠিক করুন। অর্ডারে নেই এমন কিছু এলে “Add something not on the order”।",
        },
        {
          text: "অনুমতি থাকলে “How it is paid”-এ “Due to the supplier” (বকেয়া) বা “Paid now” (এখনই পরিশোধ) বেছে নিন। অনুমতি না থাকলে বিল সরবরাহকারীর হিসাবে বকেয়া যায়, Accounts পরে দেন।",
        },
        {
          text: "“Photo or PDF of the bill (optional)”-এ বিলের ছবি দিয়ে “Receive the goods” চাপুন।",
        },
        {
          text: "পরে টাকা দিতে কেনার পাতায় “Pay the supplier” চাপুন। ভুল হলে “Void the purchase”।",
        },
      ],
      tips: [
        "Warehouse Team-এর জন্য “Purchases” ও “Supplier returns” ট্যাব থাকে না, কারণ সেখানে দাম থাকে।",
        "বিল বা প্যাকিং লিস্ট AI দিয়ে পড়ে নেওয়া এখনো চালু হয়নি।",
      ],
    },
    {
      slug: "materials-supplier-return",
      title: "খারাপ বা ভুল কাঁচামাল সরবরাহকারীকে ফেরত পাঠাবেন যেভাবে",
      summary:
        "যে কেনার বিলে মাল এসেছিল সেখান থেকে ফেরত পাঠানো (ডেবিট নোট), যাতে সরবরাহকারীর হিসাবে টাকা কমে।",
      keywords: [
        "supplier return",
        "send goods back",
        "debit note",
        "return",
        "faulty",
        "ফেরত",
        "মাল ফেরত",
        "ডেবিট নোট",
        "খারাপ মাল",
      ],
      routes: ["/materials/returns", "/materials/purchases"],
      who: "Super Admin, Production Manager ও Accounts।",
      anyOf: ["materials.purchase", "accounts.manage"],
      steps: [
        {
          text: "“Purchases” ট্যাবে যে কেনার মাল ফেরত যাবে সেটি খুলে “Send goods back” চাপুন।",
        },
        {
          text: "“What goes back”-এ প্রতিটি লাইনের কত ফেরত যাবে লিখুন (রাখবেন যেগুলো, সেগুলো ফাঁকা রাখুন)। ফেরত যায় বিলের দামেই।",
          image: {
            id: "materials-supplier-return-1",
            caption: "“Send goods back” ফর্ম: ফেরতের পরিমাণ, স্টোর, তারিখ ও কারণ",
          },
        },
        {
          text: "“Leaves from the store”, “Sent back on” ও “Why it goes back” দিয়ে “Send the goods back” চাপুন।",
        },
        {
          text: "“Supplier returns” ট্যাবে সব ফেরত দেখবেন। ভুল হলে ফেরতের পাতায় “Void the return”।",
        },
      ],
      tips: ["একটি লাইনে যত এসেছিল তার বেশি ফেরত পাঠানো যায় না।"],
    },
    {
      slug: "materials-issue",
      title: "কাঁচামাল উৎপাদনে দেবেন বা অব্যবহৃত মাল ফেরত নেবেন যেভাবে",
      summary:
        "স্টোর থেকে কাপড় ও ট্রিমস একটি প্রোডাকশন প্রজেক্টে দেওয়া (ইস্যু নোট), আর বেঁচে যাওয়া মাল আবার স্টোরে নেওয়া।",
      keywords: [
        "issue to production",
        "issue note",
        "take back",
        "return note",
        "unused",
        "ইস্যু",
        "উৎপাদনে দেওয়া",
        "কাপড় দেওয়া",
        "ফেরত নেওয়া",
        "বেঁচে যাওয়া",
      ],
      routes: ["/materials/issues/new", "/materials/issues"],
      who: "Super Admin, Production Manager ও Warehouse Team।",
      anyOf: ["materials.manage"],
      steps: [
        {
          text: "“Materials” > “Issue notes” ট্যাবে “Issue to production” চাপুন (ফেরত নিতে “Take back”)। প্রজেক্টের পাতার “Issue materials” বা “Take back unused” থেকেও যাওয়া যায়।",
          image: {
            id: "materials-issue-1",
            caption: "“Issue notes” ট্যাবে “Issue to production” ও “Take back” বোতাম",
          },
        },
        {
          text: "“Production project” বেছে নিন। ফেরত নিলে প্রজেক্টের কাছে কী আছে তা দেখাবে।",
        },
        {
          text: "“From the store” (ফেরতে “Back into the store”), “Handed over on” ও দরকার হলে “Taken by (optional)” (যেমন লাইন সুপারভাইজার) দিন।",
        },
        {
          text: "“Find a material to hand over” দিয়ে কাঁচামাল ও পরিমাণ দিন। “Issue the materials” (ফেরতে “Take them back”) চাপুন।",
          image: {
            id: "materials-issue-2",
            caption: "ইস্যু নোটের ফর্ম: প্রজেক্ট, স্টোর, তারিখ ও কাঁচামালের লাইন",
          },
        },
      ],
      tips: [
        "প্রজেক্টের কাছে যা আছে তার বেশি ফেরত নেওয়া যায় না।",
        "দেওয়া কাঁচামালের খরচ প্রজেক্টের খরচে যোগ হয়, ফেরত নিলে কমে।",
        "প্রজেক্টের পাতার “Raw materials” অংশে প্রজেক্টের কাছে থাকা মাল, তার খরচ ও আসার বাকি অর্ডার দেখা যায়।",
      ],
    },
  ],
};
