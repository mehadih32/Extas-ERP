import type { HelpSection } from "../types";

/**
 * Products: styles and their stock matrix, SKUs, inward batches (lots), stock
 * counts and the Bulk update grid, Damage & QC Rejects (bad stock) and the
 * catalogue setup.
 */
export const productsHelp: HelpSection = {
  id: "products",
  title: "পণ্য ও স্টক (Products)",
  description:
    "প্রতিটি স্টাইল, তার রং ও সাইজ অনুযায়ী স্টক (SKU), স্টক গণনা, নষ্ট ও QC-তে বাতিল মাল (Damage & QC Rejects), আর রং, সাইজ, ক্যাটাগরি, ব্র্যান্ড ও গুদামের সেটআপ।",
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
        "category tree",
        "units sold",
        "total revenue",
        "ক্যাটাগরি গাছ",
        "কত বিক্রি হয়েছে",
        "stock sheet",
        "whatsapp",
        "স্টক শিট",
      ],
      routes: ["/products"],
      who: "যাঁরা স্টক দেখতে পারেন: Super Admin, Production Manager, Warehouse Team ও Sales Executive।",
      steps: [
        {
          text: "মেনু থেকে “Products” খুলুন। “Styles” ট্যাবে প্রতিটি স্টাইলের কার্ডে ছবির জায়গা, বিক্রির জন্য তৈরি পিস (“Available”), “B-grade” ও “SKUs”-এর সংখ্যা থাকে। কোণের রঙিন চিহ্নে অবস্থা দেখায়: সবুজ “Active” মানে স্টক আছে, লাল “Out of stock” মানে বিক্রির মাল নেই, “No SKUs yet” মানে রং-সাইজ এখনো যোগ হয়নি।",
          image: {
            id: "products-find-style-1",
            caption: "“Styles” ট্যাবে স্টাইলের কার্ড, খোঁজার ঘর ও ক্যাটাগরি",
          },
        },
        {
          text: "খোঁজার ঘরে স্টাইলের নাম বা কোড লিখুন। পুরো SKU কোড বা বারকোড লিখলে সরাসরি সেই SKU খুলবে (“SKU found”)।",
        },
        {
          text: "কম্পিউটারে বাঁ পাশের “Categories” গাছ থেকে ক্যাটাগরি বেছে নিন। পাশের তীর চিহ্নে চাপলে ভেতরের ক্যাটাগরি খোলে বা বন্ধ হয়, আর প্রতিটির পাশে কয়টি স্টাইল আছে তা লেখা থাকে। ফোনে তালিকার ওপরে “Category” চাপলে একই গাছ খুলবে। “Brand” দিয়ে ছাঁকুন। আর্কাইভ করা স্টাইল আলাদা “Archived styles” ট্যাবে থাকে।",
        },
        {
          text: "স্টাইলে চাপলে তার পাতা খুলবে। “Stock matrix”-এ রং নিচে নিচে, সাইজ পাশাপাশি সাজানো। “Warehouse”-এ “All warehouses” বা একটি গুদাম বেছে নিন। লাল ঘর মানে কম স্টক।",
          image: {
            id: "products-find-style-2",
            caption: "স্টাইলের পাতায় “Stock matrix”: রং × সাইজ, গুদাম বাছাই ও লাল ঘর",
          },
        },
        {
          text: "বিক্রি দেখার অনুমতি থাকলে স্টাইলের পাতার ওপরে দুটি কার্ড থাকে: “Units sold” (মোট কত পিস বিক্রি হয়েছে) ও “Total revenue” (ছাড় বাদে মোট বিক্রির টাকা)। প্রতিটিতে “Wholesale” (পাইকারি ও B2B প্রি-অর্ডার) আর “Retail” (দোকান, সোশ্যাল ও ওয়েবসাইট) আলাদা করে দেখায়, দাগের গাঢ় অংশ পাইকারি।",
          image: {
            id: "products-find-style-3",
            caption: "স্টাইলের পাতায় “Units sold” ও “Total revenue”, পাইকারি ও খুচরা আলাদা",
          },
        },
        {
          text: "ছকের কোনো ঘরে চাপলে সেই SKU খুলবে: দাম, বারকোড, প্রতিটি গুদামে “Available”, “Set aside” (অর্ডারের জন্য আটকে রাখা) ও “B-grade”।",
        },
        {
          text: "নিচে “Stock history”-তে দুটি ট্যাব: “Inward batches”-এ প্রতিটি আসা মালের লট (নিচে “লট” গাইড দেখুন), আর “All movements”-এ প্রতিটি পিস আসা-যাওয়ার ইতিহাস (শুরুর স্টক, উৎপাদন থেকে আসা, বিক্রি, গণনা), সর্বশেষটি আগে।",
        },
        {
          text: "“Stock sheet (PDF)” চাপলে দাম ছাড়া স্টকের তালিকা তৈরি হয়, ক্রেতাকে সরাসরি পাঠানো যায়। প্রতিটি রং-সাইজে একটি সংখ্যাই থাকে: মোট স্টক, মানে বিক্রির জন্য তৈরি ভালো পিস আর B-grade পিস একসাথে। নষ্ট মাল ধরা হয় না। পাশের “Share to WhatsApp” এখনো চালু হয়নি (“Integration Pending”), ততদিন PDF নামিয়ে ফোন থেকে পাঠান।",
          image: {
            id: "products-find-style-4",
            caption: "“Stock sheet (PDF)” ও তার পাশে “Share to WhatsApp” বোতাম",
          },
        },
      ],
      tips: [
        "খরচ দেখার অনুমতি থাকলে SKU-তে “Average cost per piece” এবং ইতিহাসে “Value” দেখাবে।",
        "একটি ব্র্যান্ডের সব স্টাইলের স্টক তালিকা ছাপতে ব্র্যান্ড বেছে স্টক শিট বোতাম চাপুন।",
        "বিক্রির হিসাবে শুধু ইনভয়েস হওয়া অর্ডার ধরা হয়, বাতিল অর্ডার বাদ।",
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
        "colours and sizes",
        "remove a colour",
        "wholesale price",
        "retail price",
        "নতুন স্টাইল",
        "নতুন পণ্য",
        "পণ্য যোগ",
        "দাম",
        "রং সাইজ",
        "রং বাদ",
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
          text: "স্টাইলের পাতায় “Colours and sizes” চাপুন। “Colours” ও “Sizes” থেকে যেগুলো এই স্টাইলে বানানো হয় টিক দিন। সব সাইজ একবারে নিতে “Tick all sizes” চাপুন। প্রতিটি রং-সাইজের জোড়া একটি SKU হবে। লম্বা নাম (যেমন Black & White Stripes) পুরোটা দুই লাইনে দেখায়।",
          image: {
            id: "products-new-style-2",
            caption: "“Colours and sizes” জানালায় রং ও সাইজের টিকবক্স",
          },
        },
        {
          text: "ভুল করে যোগ হওয়া রং বা সাইজ বাদ দিতে তার টিক তুলে দিন। কোনো রং বা সাইজে স্টক থাকলে (যেকোনো গুদামে) বা সেটি খোলা অর্ডার বা ডেলিভারিতে থাকলে তার টিক তোলা যায় না: পাশে তালার চিহ্ন আর কত পিস আছে লেখা থাকে। আগে সেই পিস বিক্রি, গণনা বা নষ্ট মালে সরান।",
          image: {
            id: "products-new-style-3",
            caption: "স্টক থাকা রং ও সাইজে তালার চিহ্ন ও পিসের সংখ্যা",
          },
        },
        {
          text: "নিচে কয়টি SKU যোগ হবে ও কয়টি বাদ যাবে লেখা থাকে। “Save” চাপুন। ছকে নতুন SKU-গুলো দেখাবে, স্টক তখন শূন্য। স্টক আসবে উৎপাদনের ডেলিভারি বা শুরুর স্টক (Opening stock) থেকে।",
        },
      ],
      tips: [
        "রং বা সাইজ তালিকায় না থাকলে আগে “Setup” ট্যাবে যোগ করুন।",
        "পরে নতুন রং বা সাইজ যোগ করা যায়, পুরোনো SKU ঠিক থাকে।",
        "যে SKU-র ইতিহাস আছে, বাদ দিলেও তা মোছে না: ছক থেকে সরে যায়, রিপোর্টে থাকে। আবার টিক দিলে আগের SKU ফিরে আসে।",
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
        "unarchive",
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
          text: "পুরো স্টাইল বিক্রি বন্ধ করতে “Archive” চাপুন, আবার চালু করতে “Unarchive” (নিচে “আর্কাইভ করা স্টাইল” গাইড দেখুন)। যে স্টাইলের কোনো ইতিহাস নেই (ভুল করে যোগ করা), সেটি “Delete” দিয়ে মোছা যায়।",
        },
      ],
      tips: [
        "আর্কাইভ করা স্টাইল নতুন অর্ডার বা উৎপাদনের তালিকায় আসে না, তবে সব রিপোর্টে তার ইতিহাস থাকে।",
        "স্টক বা বিক্রির ইতিহাস থাকলে স্টাইল মোছা যায় না, আর্কাইভ করুন।",
      ],
    },
    {
      slug: "products-archived-styles",
      title: "আর্কাইভ করা স্টাইল দেখবেন ও আবার চালু করবেন যেভাবে",
      summary:
        "যে স্টাইল আর বিক্রি হয় না তা আর্কাইভ করে তালিকা ছোট রাখা, “Archived styles” ট্যাবে দেখা, এক চাপে আবার চালু করা, আর ছয় মাস স্টক নেই এমন স্টাইলের পরামর্শ।",
      keywords: [
        "archived styles",
        "archive",
        "unarchive",
        "archive all",
        "no stock for 6 months",
        "আর্কাইভ",
        "আবার চালু",
        "পুরোনো স্টাইল",
        "স্টক নেই",
      ],
      routes: ["/products/archived", "/products"],
      who: "দেখতে পারেন যাঁরা স্টক দেখতে পারেন। আর্কাইভ ও আবার চালু করতে পারেন যাঁদের স্টক সামলানোর অনুমতি আছে: Super Admin, Production Manager ও Warehouse Team।",
      steps: [
        {
          text: "“Products” > “Archived styles” ট্যাবে আর্কাইভ করা সব স্টাইল থাকে। এগুলো বিক্রি ও উৎপাদনের তালিকায় আসে না, কিন্তু সব রিপোর্টে ইতিহাস থেকে যায়। খোঁজা, ক্যাটাগরি ও ব্র্যান্ড দিয়ে ছাঁকা “Styles” ট্যাবের মতোই।",
          image: {
            id: "products-archived-styles-1",
            caption: "“Archived styles” ট্যাবে কার্ডের নিচে “Unarchive” বোতাম",
          },
        },
        {
          text: "কোনো স্টাইল আবার বিক্রি করতে কার্ডের “Unarchive” চাপুন। এক চাপেই সেটি “Styles” ট্যাবে ফিরে যাবে। স্টাইলের পাতা থেকেও “Unarchive” চাপা যায়।",
        },
        {
          text: "কোনো স্টাইলে ছয় মাস ধরে একটি পিসও স্টক না থাকলে (আর সেটি উৎপাদনে বা খোলা অর্ডারে না থাকলে) “Styles” ট্যাবের ওপরে একটি পরামর্শ দেখাবে। সেটিতে চাপলে তালিকা খুলবে, প্রতিটির পাশে “Archive”, আর সব একসাথে করতে “Archive all” চাপুন।",
          image: {
            id: "products-archived-styles-2",
            caption: "ছয় মাস স্টক নেই এমন স্টাইলের পরামর্শ, “Archive” ও “Archive all” সহ",
          },
        },
      ],
      tips: [
        "আর্কাইভ করলে কিছু মোছে না: SKU, স্টক ও ইতিহাস যেমন ছিল তেমনই থাকে।",
        "পরামর্শটি শুধু তাঁরা দেখেন যাঁদের স্টক সামলানোর অনুমতি আছে।",
      ],
    },
    {
      slug: "products-stock-count",
      title: "স্টক গণনা (Stock count) করে মিলাবেন যেভাবে",
      summary:
        "সফটওয়্যারের স্টক (System stock) পাশে রেখে তাকে গুনে পাওয়া পিস (Physical count) লেখা। পার্থক্য নিজে থেকে হিসাব হয়, কম পাওয়া পিসের দাম Accounts-এর Inventory Loss-এ যায়।",
      keywords: [
        "stock count",
        "count",
        "physical count",
        "system stock",
        "stock take",
        "shelf",
        "difference",
        "shortage",
        "inventory loss",
        "স্টক গণনা",
        "স্টক মেলানো",
        "গোনা",
        "মজুদ যাচাই",
        "স্টক টেক",
        "ঘাটতি",
        "কম পাওয়া",
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
          text: "“Style”, “Warehouse” ও “Grade” (“A-grade” বা “B-grade”) বেছে নিন। প্রতিটি রঙের জন্য একটি ছক খুলবে।",
        },
        {
          text: "ছকের প্রতিটি সারি একটি সাইজ: “System stock”-এ সফটওয়্যারে যত পিস আছে, পাশে “Physical count” ঘরে তাকে গুনে যত পিস পেলেন তা লিখুন। “Difference” নিজে থেকেই হিসাব হয়: মিললে “Matches”, কম হলে লাল “short”, বেশি হলে “extra”।",
          image: {
            id: "products-stock-count-2",
            caption: "গণনার ছক: “System stock”, “Physical count” ও “Difference”",
          },
        },
        {
          text: "যেগুলো গোনেননি সেগুলোতে সফটওয়্যারের সংখ্যা বসাতে “Fill the rest”, সব মুছতে “Clear”।",
        },
        {
          text: "কোনো সাইজে কম পাওয়া গেলে নিচে লাল “Shortage found” নোট আসে। এতে চাপলে খুলে দেখায় কোন রং-সাইজে কত পিস কম, কোন গুদাম, কোন তারিখে গোনা, আর (যাঁরা খরচ দেখেন তাঁদের জন্য) কত টাকার মাল।",
          image: {
            id: "products-stock-count-3",
            caption: "খোলা “Shortage found” নোট: কম পাওয়া সাইজ, তারিখ ও টাকার অঙ্ক",
          },
        },
        {
          text: "“Review and save” চাপুন, দরকার হলে নোট লিখে (যেমন October count) “Save the count” চাপুন। সংরক্ষণের পর নোটটি “Shortage recorded” হিসেবে থেকে যায়।",
        },
      ],
      tips: [
        "কম পাওয়া পিসের দাম (পিসপ্রতি খরচ × কম পিস) নিজে থেকেই Accounts-এর “Inventory Loss” হিসাবে যায়, তাই লাভ-ক্ষতির হিসাবে (Profit & loss) দেখা যায়। বেশি পাওয়া গেলে সেই ক্ষতি ততটা কমে।",
        "গণনার সময় স্টক বদলালে (বিক্রি বা অন্য গণনা) সংরক্ষণ আটকে যাবে। “Load the new shelf numbers, keeping what you typed” চাপুন, আপনার লেখা থেকে যাবে।",
        "একটি SKU-র স্টক দ্রুত ঠিক করতে SKU-র জানালায় “Correct stock” চাপুন, “Pieces counted on the shelf” লিখে “Save the count” চাপুন।",
        "একটি স্টাইলের ভালো ও B-grade দুটোই একসাথে ঠিক করতে স্টাইলের পাতায় “Bulk update” ব্যবহার করুন (নিচের গাইড দেখুন)।",
        "Sales Executive-এর জন্য এই ট্যাব থাকে না।",
      ],
    },
    {
      slug: "products-bulk-update",
      title: "সব রং-সাইজের স্টক একসাথে ঠিক করবেন যেভাবে (Bulk update)",
      summary:
        "একটি স্টাইলের সব রং ও সাইজের ভালো (Good) ও B-grade পিস এক ছকে লিখে একবারে সংরক্ষণ করা।",
      keywords: [
        "bulk update",
        "spreadsheet",
        "good",
        "b-grade",
        "update stock",
        "ai scan",
        "packing list",
        "একসাথে স্টক",
        "স্টক ঠিক করা",
        "ছক",
        "প্যাকিং লিস্ট",
      ],
      routes: ["/products"],
      who: "যাঁদের স্টক সামলানোর অনুমতি আছে: Super Admin, Production Manager ও Warehouse Team।",
      anyOf: ["inventory.manage"],
      steps: [
        {
          text: "স্টাইলের পাতায় “Stock matrix”-এর ওপরে “Bulk update” চাপুন। একাধিক গুদাম থাকলে “Warehouse” বেছে নিন।",
        },
        {
          text: "ছকে প্রতিটি রঙের দুটি সারি: “Good” (বিক্রির ভালো পিস) ও “B-grade”। প্রতিটি ঘরে এখন তাকে কত পিস আছে তা লেখা থাকে। যেগুলো মেলে না শুধু সেগুলো বদলান। Tab বা Enter চাপলে পরের ঘরে যায়।",
          image: {
            id: "products-bulk-update-1",
            caption: "“Bulk update” ছক: রং × সাইজ, প্রতিটি রঙে “Good” ও “B-grade” সারি",
          },
        },
        {
          text: "বদলানো ঘর সবুজ হয়। নিচে লেখা থাকে কয়টি ঘর বদলেছে, কত পিস বেশি পাওয়া গেল আর কত কম। কম পাওয়া পিসের দাম Accounts-এর “Inventory Loss” হিসাবে যায়।",
        },
        {
          text: "দরকার হলে “Note (optional)” লিখে “Save changes” চাপুন। মাঝে কেউ স্টক বদলালে সংরক্ষণ আটকে যাবে, নতুন সংখ্যা চলে আসবে আর আপনার লেখা থেকে যাবে। আবার দেখে “Save changes” চাপুন।",
        },
        {
          text: "“Upload packing list (AI scan)” দিয়ে কারখানার প্যাকিং লিস্টের ছবি থেকে পিস পড়ে নেওয়া যাবে। এটি এখনো চালু হয়নি (“Integration Pending”), ততদিন হাতে লিখুন বা উৎপাদনের ডেলিভারি থেকে মাল তুলুন।",
        },
      ],
      tips: [
        "একটি ঘর ঠিক করতে আগের মতো ছকের ঘরে চাপুন, তারপর “Correct stock”।",
        "এটি স্টক গণনার মতোই কাজ করে: প্রতিটি পার্থক্য ইতিহাসে “Stock count correction” হিসেবে থাকে।",
      ],
    },
    {
      slug: "products-inward-batches",
      title: "আসা মালের লট (Inward batches) দেখবেন যেভাবে",
      summary:
        "উৎপাদন থেকে আসা প্রতিটি ডেলিভারি ও শুরুর স্টক নিজে থেকেই একটি লট নম্বর পায়। কোথা থেকে এলো, কত ভালো ও B-grade পিস, আর পিসপ্রতি খরচ দেখা।",
      keywords: [
        "inward batches",
        "lot",
        "lot number",
        "batch",
        "supplier",
        "unit cost",
        "লট",
        "লট নম্বর",
        "ব্যাচ",
        "কোথা থেকে এলো",
      ],
      routes: ["/products"],
      who: "যাঁরা স্টক দেখতে পারেন। পিসপ্রতি খরচ দেখেন শুধু যাঁদের খরচ দেখার অনুমতি আছে।",
      steps: [
        {
          text: "লট নম্বর কাউকে লিখতে হয় না। উৎপাদনের ডেলিভারি নিশ্চিত হলে বা শুরুর স্টক তুললে প্রতিটি স্টাইলের জন্য একটি লট নিজে থেকে তৈরি হয় (যেমন LOT-2026-00001)।",
        },
        {
          text: "স্টাইলের পাতায় নিচে “Stock history” > “Inward batches” খুলুন। সর্বশেষ লট আগে, সময়রেখার মতো সাজানো।",
          image: {
            id: "products-inward-batches-1",
            caption: "“Inward batches” সময়রেখা: লট নম্বর, কোথা থেকে, ভালো ও B-grade পিস",
          },
        },
        {
          text: "প্রতিটি লটে থাকে: কবে এলো, কোন গুদামে, ডেলিভারি ও প্রজেক্টের নম্বর আর কারখানার নাম (অনুমতি থাকলে চাপলে খোলে), “Fresh” (ভালো) ও “B-grade” পিস। খরচ দেখার অনুমতি থাকলে পিসপ্রতি খরচ ও মোট “Worth”।",
        },
        {
          text: "কোনো ডেলিভারি পরে বাতিল (undo) করা হলে তার লটে “Undone” লেখা থাকে, কারণ সেই পিস স্টক থেকে বেরিয়ে গেছে।",
        },
        {
          text: "“All movements” ট্যাবে প্রতিটি আসা পিসের পাশেও তার লট নম্বর লেখা থাকে।",
        },
      ],
      tips: [
        "খরচের হিসাব আগের মতো গড় খরচে (weighted average) চলে। লট শুধু দেখায় কোন মাল কবে, কোথা থেকে, কত খরচে এলো।",
        "পুরোনো ডেলিভারি ও শুরুর স্টকেও লট নম্বর বসানো হয়েছে।",
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
      title: "নষ্ট ও QC-তে বাতিল মাল (Damage & QC Rejects) আলাদা করবেন যেভাবে",
      summary:
        "দাগ লাগা, ছেঁড়া, হারানো বা মান যাচাইয়ে (QC) বাতিল পিস বিক্রির স্টক থেকে সরিয়ে কারণসহ লেখা। এর দাম Accounts-এর Inventory Loss-এ যায়।",
      keywords: [
        "damage",
        "qc rejects",
        "bad stock",
        "damaged",
        "defect",
        "reject",
        "lost",
        "write off",
        "inventory loss",
        "নষ্ট মাল",
        "ক্ষতিগ্রস্ত",
        "দাগ",
        "ছেঁড়া",
        "বাতিল মাল",
        "কিউসি",
      ],
      routes: ["/products/bad-stock"],
      who: "দেখতে পারেন যাঁরা স্টক দেখেন। লিখতে স্টক সামলানোর অনুমতি লাগে (Super Admin, Production Manager, Warehouse Team)।",
      steps: [
        {
          text: "“Products” > “Damage & QC Rejects” ট্যাবে “Record damage” চাপুন। (আগে এই ট্যাবের নাম ছিল Bad stock।)",
          image: {
            id: "products-bad-stock-1",
            caption: "“Damage & QC Rejects” ট্যাব: সময় বাছাই, তালিকা ও “Record damage” বোতাম",
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
        { text: "“Move to Damage & QC Rejects” চাপুন।" },
        {
          text: "তালিকায় “Period” বেছে নিয়ে কবে, কোন SKU, কত পিস, কেন, কোথা থেকে আর কে লিখেছেন দেখুন।",
        },
      ],
      tips: [
        "সরানো পিসের দাম (পিসপ্রতি খরচ × পিস) নিজে থেকেই Accounts-এর “Inventory Loss” হিসাবে যায়, তাই লাভ-ক্ষতির হিসাবে দেখা যায়।",
        "মোট কত টাকার মাল নষ্ট হলো তা ড্যাশবোর্ডের “Total bad stock value” কার্ডে দেখা যায় (যাঁরা টাকার হিসাব দেখেন তাঁদের জন্য)।",
        "অর্ডারের জন্য আটকে রাখা পিস সরালে সেই অর্ডারে পিস কম পড়বে, ফর্মে সতর্কবার্তা আসবে।",
        "SKU-র জানালার “Damage & QC” বোতাম থেকেও সরাসরি নষ্ট মাল লেখা যায়।",
        "ক্রেতার ফেরত পাঠানো মাল Accounts “Sales return” দিয়ে নিলে নিজে থেকেই এখানে আসে, “Sales return” কারণ ও ক্রেডিট নোট নম্বরসহ। সেগুলো এখান থেকে লিখতে হয় না।",
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
        "delete warehouse",
        "গুদাম মোছা",
        "drag",
        "rename",
        "quick pick",
        "সাইজের ক্রম",
        "নাম বদল",
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
          text: "রং যোগ করতে “Add colour” চাপুন। “Quick pick” থেকে একটি রঙের গোল নমুনায় চাপলে রং বসে যায়, নামের ঘর খালি থাকলে নামও বসে। নিজের রং হলে “Name” (যেমন Black & White Stripes) লিখে “Swatch”-এ রং বেছে নিন। নিচে নমুনাসহ নামটি কেমন দেখাবে তা দেখা যায়।",
        },
        {
          text: "সাইজ যোগ করতে “Add size” চাপুন। সাইজগুলো যে ক্রমে সাজানো, ছকে সেভাবেই পাশাপাশি দেখাবে। ক্রম বদলাতে সাইজের বাঁ পাশের ছয় বিন্দুর হাতল ধরে টেনে ওপরে বা নিচে ছেড়ে দিন। ফোনে আঙুল দিয়েও টানা যায়।",
          image: {
            id: "products-setup-2",
            caption: "“Sizes” অংশে হাতল ধরে টেনে সাইজের ক্রম বদলানো",
          },
        },
        {
          text: "ক্যাটাগরি যোগ করতে “Add category” চাপুন। অন্য ক্যাটাগরির ভেতরে রাখতে “Inside” থেকে বেছে নিন (যেমন Tops-এর ভেতরে Polos)। উপরের স্তরের জন্য “Nothing (a top category)”।",
        },
        {
          text: "ব্র্যান্ড যোগ করতে “Add brand”। গুদাম যোগ করতে “Add a warehouse”, নাম ও “Address (optional)” দিন। কোনো গুদাম বাছা না হলে যেখানে মাল যাবে সেটিকে “Make it the default” করুন।",
        },
        {
          text: "গুদাম মুছতে পারেন শুধু Super Admin। গুদামের পাশের মেনু থেকে “Delete” চাপুন। গুদামে একটিও পিস বা কাঁচামাল থাকলে, বা কোনো খোলা অর্ডার বা ডেলিভারি সেটি ব্যবহার করলে মোছা যায় না, কারণটি লেখা থাকে। খালি হলে “Your password” ঘরে নিজের পাসওয়ার্ড আবার লিখে “Delete warehouse” চাপুন।",
          image: {
            id: "products-setup-3",
            caption: "গুদাম মোছার আগে পাসওয়ার্ড চাওয়া হয়",
          },
        },
        {
          text: "ক্যাটাগরি বা ব্র্যান্ডের নাম বদলাতে নামের ওপর চাপুন, নতুন নাম লিখে Enter বা টিক চিহ্ন চাপুন। বাদ দিতে Esc বা ক্রস চাপুন। ক্যাটাগরি অন্য ক্যাটাগরির ভেতরে সরাতে পাশের মেনু থেকে “Move”। রং ও সাইজের পাশের মেনুতে “Edit”, “Rename” ও “Delete” থাকে।",
        },
      ],
      tips: [
        "যে রং, সাইজ বা ক্যাটাগরি ব্যবহার হচ্ছে তা মোছা যায় না। গুদামের নিচে লেখা থাকে এখন তাতে কত পিস ও কাঁচামাল আছে।",
        "মোছা গুদামের পুরোনো লেনদেন ইতিহাসে তার নামসহ থেকে যায়। একই নামে আবার গুদাম যোগ করলে পুরোনোটিই ফিরে আসে। শেষ গুদামটি মোছা যায় না, আর ডিফল্ট গুদাম মুছলে সবচেয়ে পুরোনো বাকি গুদামটি ডিফল্ট হয়।",
        "একই নাম দুবার দেওয়া যায় না, বড়-ছোট হাতের অক্ষর আলাদা হলেও না (maroon ও Maroon একই)।",
      ],
    },
  ],
};
