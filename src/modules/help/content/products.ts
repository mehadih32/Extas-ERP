import type { HelpSection } from "../types";

/** Products: styles and their stock matrix, SKUs, stock counts, bad stock and the catalogue setup. */
export const productsHelp: HelpSection = {
  id: "products",
  title: "পণ্য ও স্টক (Products)",
  description:
    "প্রতিটি স্টাইল, তার রং ও সাইজ অনুযায়ী স্টক (SKU), স্টক গণনা, নষ্ট মাল (Bad stock), আর রং, সাইজ, ক্যাটাগরি, ব্র্যান্ড ও গুদামের সেটআপ।",
  href: "/products",
  articles: [
    {
      slug: "products-find-style",
      title: "স্টাইল খুঁজবেন ও স্টক দেখবেন যেভাবে",
      summary:
        "নাম, কোড, SKU বা বারকোড দিয়ে স্টাইল খোঁজা, আর রং × সাইজের ছকে (Stock matrix) কোন গুদামে কত পিস আছে দেখা।",
      keywords: [
        "style",
        "stock",
        "stock matrix",
        "sku",
        "barcode",
        "search",
        "warehouse",
        "স্টাইল",
        "স্টক",
        "কত পিস আছে",
        "বারকোড",
        "মজুদ",
        "খোঁজা",
      ],
      routes: ["/products"],
      who: "যাঁরা স্টক দেখতে পারেন: Super Admin, Production Manager, Warehouse Team ও Sales Executive।",
      steps: [
        {
          text: "মেনু থেকে “Products” খুলুন। “Styles” ট্যাবে প্রতিটি স্টাইলের কার্ডে বিক্রির জন্য তৈরি পিস (“Available”), “B-grade” ও “SKUs”-এর সংখ্যা থাকে।",
          image: {
            id: "products-find-style-1",
            caption: "“Styles” ট্যাবে স্টাইলের কার্ড, খোঁজার ঘর ও ক্যাটাগরি",
          },
        },
        {
          text: "খোঁজার ঘরে স্টাইলের নাম বা কোড লিখুন। পুরো SKU কোড বা বারকোড লিখলে সরাসরি সেই SKU খুলবে (“SKU found”)।",
        },
        {
          text: "কম্পিউটারে বাঁ পাশের “Categories” গাছ থেকে, ফোনে “Category” তালিকা থেকে ক্যাটাগরি বেছে নিন। “Brand” দিয়ে ছাঁকুন। আর্কাইভ করা স্টাইল দেখতে “Show archived styles” টিক দিন।",
        },
        {
          text: "স্টাইলে চাপলে তার পাতা খুলবে। “Stock matrix”-এ রং নিচে নিচে, সাইজ পাশাপাশি সাজানো। “Warehouse”-এ “All warehouses” বা একটি গুদাম বেছে নিন। লাল ঘর মানে কম স্টক।",
          image: {
            id: "products-find-style-2",
            caption: "স্টাইলের পাতায় “Stock matrix”: রং × সাইজ, গুদাম বাছাই ও লাল ঘর",
          },
        },
        {
          text: "ছকের কোনো ঘরে চাপলে সেই SKU খুলবে: দাম, বারকোড, প্রতিটি গুদামে “Available”, “Set aside” (অর্ডারের জন্য আটকে রাখা) ও “B-grade”।",
        },
        {
          text: "নিচে “Stock history”-তে প্রতিটি পিস আসা-যাওয়ার ইতিহাস (শুরুর স্টক, উৎপাদন থেকে আসা, বিক্রি, গণনা) সর্বশেষটি আগে দেখাবে।",
        },
      ],
      tips: [
        "খরচ দেখার অনুমতি থাকলে SKU-তে “Average cost per piece” এবং ইতিহাসে “Value” দেখাবে।",
        "একটি ব্র্যান্ডের সব স্টাইলের স্টক তালিকা ছাপতে ব্র্যান্ড বেছে “Stock sheet (PDF)” চাপুন।",
      ],
    },
    {
      slug: "products-new-style",
      title: "নতুন স্টাইল যোগ করবেন ও রং-সাইজ (SKU) বানাবেন যেভাবে",
      summary:
        "স্টাইলের কোড, নাম, ক্যাটাগরি, দাম ও কাপড় দিয়ে স্টাইল যোগ করা, তারপর তার রং ও সাইজ বেছে SKU তৈরি করা।",
      keywords: [
        "new style",
        "add the style",
        "sku",
        "add colours or sizes",
        "wholesale price",
        "retail price",
        "নতুন স্টাইল",
        "নতুন পণ্য",
        "পণ্য যোগ",
        "দাম",
        "রং সাইজ",
      ],
      routes: ["/products/new", "/products"],
      who: "যাঁদের স্টক সামলানোর অনুমতি আছে: Super Admin, Production Manager ও Warehouse Team।",
      anyOf: ["inventory.manage"],
      steps: [
        {
          text: "“Products” > “Styles” ট্যাবে “New style” চাপুন। ক্যাটাগরি না থাকলে আগে “Setup” ট্যাবে ক্যাটাগরি যোগ করুন।",
        },
        {
          text: "“Style code” (যেমন EX-PL-001), “Name”, “Category” ও দরকার হলে “Brand” দিন।",
          image: {
            id: "products-new-style-1",
            caption: "“New style” ফর্ম: কোড, নাম, ক্যাটাগরি, ব্র্যান্ড ও দুই দাম",
          },
        },
        {
          text: "“Wholesale price” (পাইকারি দাম) ও “Retail price” (খুচরা দাম) লিখুন। চাইলে “Fabric (optional)” ও “Description (optional)” দিন। “Add the style” চাপুন।",
        },
        {
          text: "স্টাইলের পাতায় “Add colours or sizes” চাপুন। “Colours” ও “Sizes” থেকে যেগুলো এই স্টাইলে বানানো হয় টিক দিন। প্রতিটি রং-সাইজের জোড়া একটি SKU হবে।",
          image: {
            id: "products-new-style-2",
            caption: "“Add colours or sizes” জানালায় রং ও সাইজের টিকবক্স",
          },
        },
        {
          text: "নিশ্চিত করুন। ছকে নতুন SKU-গুলো দেখাবে, স্টক তখন শূন্য। স্টক আসবে উৎপাদনের ডেলিভারি বা শুরুর স্টক (Opening stock) থেকে।",
        },
      ],
      tips: [
        "রং বা সাইজ তালিকায় না থাকলে আগে “Setup” ট্যাবে যোগ করুন।",
        "পরে নতুন রং বা সাইজ যোগ করা যায়, পুরোনো SKU ঠিক থাকে।",
      ],
    },
    {
      slug: "products-edit-sku",
      title: "স্টাইল বা SKU বদলাবেন, আর্কাইভ বা মুছবেন যেভাবে",
      summary:
        "স্টাইলের তথ্য ও দাম বদলানো, একটি SKU-র নিজের দাম ও বারকোড দেওয়া, বিক্রি বন্ধ করা, আর স্টাইল আর্কাইভ বা মুছে ফেলা।",
      keywords: [
        "edit style",
        "edit sku",
        "barcode",
        "own price",
        "archive",
        "restore",
        "delete style",
        "offered for sale",
        "স্টাইল বদল",
        "দাম বদল",
        "বারকোড",
        "আর্কাইভ",
        "মুছুন",
      ],
      routes: ["/products"],
      who: "যাঁদের স্টক সামলানোর অনুমতি আছে: Super Admin, Production Manager ও Warehouse Team।",
      anyOf: ["inventory.manage"],
      steps: [
        {
          text: "স্টাইলের পাতায় “Edit details” চাপুন, তথ্য বা দাম বদলে “Save changes” চাপুন। স্টাইলের কোড বদলালেও SKU-র কোড আগের মতো থাকে, তাই ছাপানো ট্যাগ ঠিক থাকে।",
        },
        {
          text: "একটি SKU-র আলাদা দাম বা বারকোড দিতে ছকের ঘরে চাপুন, তারপর “Edit SKU”। “Barcode”, আর দরকার হলে “This SKU's own price” বেছে “Own wholesale price” ও “Own retail price” দিন।",
          image: {
            id: "products-edit-sku-1",
            caption: "SKU-র জানালায় “Edit SKU”: বারকোড, নিজের দাম ও “Offered for sale”",
          },
        },
        {
          text: "কোনো রং-সাইজ আর বিক্রি না করতে চাইলে “Offered for sale” টিক তুলে দিন। স্টক ও ইতিহাস থেকে যাবে।",
        },
        {
          text: "পুরো স্টাইল বিক্রি বন্ধ করতে “Archive” চাপুন, আবার চালু করতে “Restore”। যে স্টাইলের কোনো ইতিহাস নেই (ভুল করে যোগ করা), সেটি “Delete” দিয়ে মোছা যায়।",
        },
      ],
      tips: [
        "আর্কাইভ করা স্টাইল শুধু বাকি স্টক থেকে বিক্রি করা যায়।",
        "স্টক বা বিক্রির ইতিহাস থাকলে স্টাইল মোছা যায় না, আর্কাইভ করুন।",
      ],
    },
    {
      slug: "products-stock-count",
      title: "স্টক গণনা (Stock count) করে মিলাবেন যেভাবে",
      summary:
        "তাকে গুনে পাওয়া পিস লিখে শুধু পার্থক্যগুলো সংরক্ষণ করা। কম পাওয়া পিস ক্ষতি হিসেবে লেখা হয়।",
      keywords: [
        "stock count",
        "count",
        "physical count",
        "stock take",
        "shelf",
        "difference",
        "স্টক গণনা",
        "স্টক মেলানো",
        "গোনা",
        "মজুদ যাচাই",
        "স্টক টেক",
      ],
      routes: ["/products/stock-count"],
      who: "যাঁদের স্টক সামলানোর অনুমতি আছে: Super Admin, Production Manager ও Warehouse Team।",
      anyOf: ["inventory.manage"],
      steps: [
        {
          text: "“Products” > “Stock count” ট্যাব খুলুন। “What to do”-তে “Count” বেছে নিন।",
          image: {
            id: "products-stock-count-1",
            caption: "“Stock count” ট্যাব: “What to do”, “Style”, “Warehouse” ও “Grade”",
          },
        },
        {
          text: "“Style”, “Warehouse” ও “Grade” (“A-grade” বা “B-grade”) বেছে নিন। রং × সাইজের গণনার শিট খুলবে।",
        },
        {
          text: "প্রতিটি ঘরে তাকে গুনে যত পিস পেলেন লিখুন। যেগুলো গোনেননি সেগুলোতে বর্তমান সংখ্যা বসাতে “Fill the rest”, সব মুছতে “Clear”।",
          image: {
            id: "products-stock-count-2",
            caption: "গণনার শিট: প্রতিটি ঘরে গোনা পিস লেখা",
          },
        },
        {
          text: "“Review and save” চাপুন। কোন SKU-তে কত পার্থক্য তা দেখাবে। সব মিললে “Everything matches” লেখা আসবে।",
        },
        {
          text: "দরকার হলে নোট লিখে (যেমন October count) “Save the count” চাপুন।",
        },
      ],
      tips: [
        "গণনার সময় স্টক বদলালে (বিক্রি বা অন্য গণনা) সংরক্ষণ আটকে যাবে। “Load the new shelf numbers, keeping what you typed” চাপুন, আপনার লেখা থেকে যাবে।",
        "একটি SKU-র স্টক দ্রুত ঠিক করতে SKU-র জানালায় “Correct stock” চাপুন, “Pieces counted on the shelf” লিখে “Save the count” চাপুন।",
        "Sales Executive-এর জন্য এই ট্যাব থাকে না।",
      ],
    },
    {
      slug: "products-opening-stock",
      title: "শুরুর স্টক (Opening stock) তুলবেন যেভাবে",
      summary:
        "Extas ERP ব্যবহার শুরুর আগে থেকে থাকা পিস, চাইলে পিসপ্রতি খরচসহ, একবারে স্টকে তোলা।",
      keywords: [
        "opening stock",
        "starting stock",
        "initial stock",
        "go-live",
        "cost per piece",
        "শুরুর স্টক",
        "প্রথম স্টক",
        "আগের মাল",
        "ওপেনিং স্টক",
      ],
      routes: ["/products/stock-count"],
      who: "যাঁদের স্টক সামলানোর অনুমতি আছে: Super Admin, Production Manager ও Warehouse Team।",
      anyOf: ["inventory.manage"],
      steps: [
        {
          text: "“Products” > “Stock count” ট্যাবে “What to do”-তে “Opening stock” বেছে নিন।",
        },
        {
          text: "“Style”, “Warehouse” ও “Grade” বেছে প্রতিটি রং-সাইজে কত পিস আছে লিখুন।",
        },
        {
          text: "“Cost per piece (optional)”-এ একটি পিসের খরচ দিন। এটিই হিসাবের খাতায় স্টকের মূল্য হবে।",
          image: {
            id: "products-opening-stock-1",
            caption: "“Opening stock” শিট ও “Cost per piece (optional)” ঘর",
          },
        },
        {
          text: "নোট লিখে (যেমন stock at the start) “Add opening stock” চাপুন।",
        },
      ],
      tips: ["পরে আসা মাল উৎপাদনের ডেলিভারি দিয়ে তুলুন, শুরুর স্টক দিয়ে নয়।"],
    },
    {
      slug: "products-bad-stock",
      title: "নষ্ট মাল (Bad stock) আলাদা করবেন যেভাবে",
      summary:
        "দাগ লাগা, ছেঁড়া বা হারানো পিস বিক্রির স্টক থেকে সরিয়ে কারণসহ লেখা, আর কোন সময়ে কত নষ্ট হলো দেখা।",
      keywords: [
        "bad stock",
        "damaged",
        "defect",
        "lost",
        "write off",
        "record bad stock",
        "নষ্ট মাল",
        "ক্ষতিগ্রস্ত",
        "দাগ",
        "ছেঁড়া",
        "বাতিল মাল",
      ],
      routes: ["/products/bad-stock"],
      who: "দেখতে পারেন যাঁরা স্টক দেখেন। লিখতে স্টক সামলানোর অনুমতি লাগে (Super Admin, Production Manager, Warehouse Team)।",
      steps: [
        {
          text: "“Products” > “Bad stock” ট্যাবে “Record bad stock” চাপুন।",
          image: {
            id: "products-bad-stock-1",
            caption: "“Bad stock” ট্যাব: সময় বাছাই, তালিকা ও “Record bad stock” বোতাম",
          },
        },
        {
          text: "“SKU or barcode” ঘরে SKU কোড লিখুন বা বারকোড স্ক্যান করুন, তারপর “Find the SKU” চাপুন।",
        },
        {
          text: "“From” (কোন গুদাম), “Grade”, “Pieces” ও “Why” (কারণ) দিন। চাইলে “What happened (optional)”-এ বিস্তারিত লিখুন (যেমন stained in the wash)।",
          image: {
            id: "products-bad-stock-2",
            caption: "নষ্ট মালের ফর্ম: গুদাম, গ্রেড, পিস ও কারণ",
          },
        },
        { text: "“Move to bad stock” চাপুন।" },
        {
          text: "তালিকায় “Period” বেছে নিয়ে কবে, কোন SKU, কত পিস, কেন, কোথা থেকে আর কে লিখেছেন দেখুন।",
        },
      ],
      tips: [
        "অর্ডারের জন্য আটকে রাখা পিস সরালে সেই অর্ডারে পিস কম পড়বে, ফর্মে সতর্কবার্তা আসবে।",
        "SKU-র জানালার “Bad stock” বোতাম থেকেও সরাসরি নষ্ট মাল লেখা যায়।",
        "ক্ষতির টাকার অঙ্ক শুধু যাঁরা খরচ দেখতে পারেন তাঁরা দেখেন।",
      ],
    },
    {
      slug: "products-setup",
      title: "রং, সাইজ, ক্যাটাগরি, ব্র্যান্ড ও গুদাম সাজাবেন যেভাবে",
      summary:
        "স্টাইল যেগুলো দিয়ে তৈরি (রং, সাইজ, ক্যাটাগরি, ব্র্যান্ড) আর মাল যেখানে থাকে (গুদাম), সেগুলো যোগ ও বদল করা।",
      keywords: [
        "setup",
        "colours",
        "sizes",
        "categories",
        "brands",
        "warehouses",
        "default warehouse",
        "রং",
        "সাইজ",
        "ক্যাটাগরি",
        "ব্র্যান্ড",
        "গুদাম",
        "ওয়্যারহাউস",
      ],
      routes: ["/products/setup"],
      who: "বদলাতে পারেন যাঁদের স্টক সামলানোর অনুমতি আছে। Sales Executive শুধু দেখতে পারেন।",
      steps: [
        {
          text: "“Products” > “Setup” ট্যাব খুলুন। পাঁচটি অংশ: “Colours”, “Sizes”, “Categories”, “Brands” ও “Warehouses”।",
          image: {
            id: "products-setup-1",
            caption: "“Setup” ট্যাবের পাঁচটি অংশ",
          },
        },
        {
          text: "রং যোগ করতে “Add colour” চাপুন, “Name” (যেমন Navy) ও “Swatch” (রঙের নমুনা) দিন।",
        },
        {
          text: "সাইজ যোগ করতে “Add size” চাপুন। সাইজগুলো যে ক্রমে সাজানো, ছকে সেভাবেই পাশাপাশি দেখাবে।",
        },
        {
          text: "ক্যাটাগরি যোগ করতে “Add category” চাপুন। অন্য ক্যাটাগরির ভেতরে রাখতে “Inside” থেকে বেছে নিন (যেমন Tops-এর ভেতরে Polos)। উপরের স্তরের জন্য “Nothing (a top category)”।",
        },
        {
          text: "ব্র্যান্ড যোগ করতে “Add brand”। গুদাম যোগ করতে “Add a warehouse”, নাম ও “Address (optional)” দিন। কোনো গুদাম বাছা না হলে যেখানে মাল যাবে সেটিকে “Make it the default” করুন।",
        },
        {
          text: "প্রতিটি জিনিসের পাশে “Edit”, “Rename” বা “Delete” পাবেন।",
        },
      ],
      tips: [
        "যে রং, সাইজ, ক্যাটাগরি বা গুদাম ব্যবহার হচ্ছে তা মোছা যায় না।",
        "একই নাম দুবার দেওয়া যায় না, বড়-ছোট হাতের অক্ষর আলাদা হলেও না (maroon ও Maroon একই)।",
      ],
    },
  ],
};
