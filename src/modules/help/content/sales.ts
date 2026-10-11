import type { HelpSection } from "../types";

/** Sales: orders, quotations, proforma invoices, invoices, payments and refunds. */
export const salesHelp: HelpSection = {
  id: "sales",
  title: "বিক্রয় (Sales)",
  description:
    "অর্ডার, কোটেশন, প্রোফর্মা ইনভয়েস, ইনভয়েস, চালান, পেমেন্ট ও রিফান্ড, সব এক জায়গায়। পাইকারি, কাউন্টার ও অনলাইন (সোশ্যাল) বিক্রি এখান থেকেই হয়।",
  href: "/sales",
  articles: [
    {
      slug: "sales-overview",
      title: "বিক্রয়ের আজকের চিত্র (Overview) দেখবেন যেভাবে",
      summary:
        "আজকের অর্ডার, ইনভয়েস, আদায়, ডেলিভারির অপেক্ষা ও বকেয়া এক পাতায় দেখা, আর অর্ডার না খুলেই পাশের প্যানেলে দ্রুত দেখে নেওয়া।",
      keywords: [
        "sales overview",
        "overview",
        "dashboard",
        "today in sales",
        "kpi",
        "quick view",
        "ড্যাশবোর্ড",
        "আজকের বিক্রি",
        "বিক্রয়ের চিত্র",
        "দ্রুত দেখা",
        "বকেয়া",
      ],
      routes: ["/sales/overview"],
      who: "যাঁরা Sales দেখতে পারেন, সবাই। “New order” বোতাম শুধু যাঁরা অর্ডার নিতে পারেন তাঁরা পান।",
      steps: [
        {
          text: "মেনু থেকে “Sales” খুলুন। প্রথমেই “Overview” ট্যাবে “Today in sales” পাতা খুলবে।",
          image: {
            id: "sales-overview-1",
            caption: "“Today in sales” পাতার উপরে আজকের হিসাবের আটটি ঘর",
          },
        },
        {
          text: "উপরের ঘরগুলোতে আজকের হিসাব থাকে: “Orders today”, “Sales invoiced today”, “Collected today”, “Waiting to deliver”, “Dues outstanding”, “Overdue”, “Open quotations” ও “PIs waiting for advance”। কোনো ঘরে চাপলে সেই তালিকা খুলবে, যেমন “Overdue”-তে চাপলে মেয়াদ পেরোনো ইনভয়েসগুলো।",
        },
        {
          text: "পাতাটি প্রতি মিনিটে নিজে থেকেই হালনাগাদ হয়। শিরোনামের নিচে “Updated” ও সময় লেখা থাকে। সঙ্গে সঙ্গে হালনাগাদ করতে পাশের ঘোরানো তীরের বোতামে চাপুন।",
        },
        {
          text: "নিচে দুটি তালিকা: “Latest orders” (সবচেয়ে নতুন অর্ডার) ও “Due to ship” (যেগুলোর পাঠানোর দিন সবচেয়ে কাছে)। পাঠানোর দিন পেরিয়ে গেলে লাল করে “Late” লেখা থাকে।",
        },
        {
          text: "যেকোনো অর্ডারে চাপলে ডান পাশ থেকে “Quick view” প্যানেল খুলবে: ক্রেতা, স্টাইল ও পিস, মোট টাকা, বাকি, কার্টন, কে প্যাক করেছে ও কাগজপত্র। পুরো অর্ডার দেখতে “Open the order”, ইনভয়েস দেখতে “Open the invoice” চাপুন।",
          image: {
            id: "sales-overview-2",
            caption: "ডান পাশ থেকে খোলা “Quick view” প্যানেলে অর্ডারের সারাংশ",
          },
        },
        {
          text: "বড় পর্দায় “Orders” তালিকার প্রতিটি সারির শেষে চোখের চিহ্ন থাকে। সেটিতে চাপলেও একই প্যানেল খোলে, তালিকা ছেড়ে যেতে হয় না।",
        },
      ],
      tips: [
        "“Collected today”-তে আজ ফেরত দেওয়া টাকা বাদ দিয়ে দেখানো হয়, নিচে কত ফেরত গেছে লেখা থাকে।",
        "এই পাতা শুধু দেখার জন্য। কিছু বদলাতে অর্ডার বা ইনভয়েস খুলে নিন।",
      ],
    },
    {
      slug: "sales-new-order",
      title: "নতুন অর্ডার নেবেন যেভাবে",
      summary:
        "চার ধাপে অর্ডার: ক্রেতা, রং × সাইজ ছকে পিস (Magic Ratio দিয়ে এক চাপে), ছাড় ও ডেলিভারির তথ্য, শেষে যাচাই করে অর্ডার দেওয়া।",
      keywords: [
        "new order",
        "order",
        "sales order",
        "wholesale",
        "place the order",
        "checkout",
        "magic ratio",
        "ratio",
        "matrix",
        "round off",
        "cartons",
        "packed by",
        "credit limit",
        "অর্ডার",
        "নতুন অর্ডার",
        "বিক্রি",
        "পাইকারি",
        "অর্ডার নেওয়া",
        "অনুপাত",
        "কার্টন",
        "ছাড়",
        "order koro",
      ],
      routes: ["/sales/orders/new", "/sales/orders"],
      who: "যাঁদের অর্ডার তৈরির অনুমতি আছে, যেমন Sales Executive ও Super Admin। Accounts ও Warehouse Team অর্ডার শুধু দেখতে পারেন।",
      anyOf: ["sales.order.create"],
      steps: [
        {
          text: "মেনু থেকে “Sales” খুলুন। “Overview” বা “Orders” ট্যাবে “New order” বোতামে চাপুন। অর্ডার চার ধাপে হয়: “Customer”, “Products”, “Charges & delivery” ও “Review & place”। উপরের দাগগুলো দেখায় আপনি কোন ধাপে আছেন।",
          image: {
            id: "sales-new-order-1",
            caption: "নতুন অর্ডারের উপরে চার ধাপের দাগ ও প্রথম ধাপ “Customer”",
          },
        },
        {
          text: "প্রথম ধাপে “Channel” বেছে নিন: “Wholesale” (পাইকারি দামে ক্রেতার অর্ডার), “Counter sale” (দোকানে খুচরা দামে) বা “Social commerce” (Facebook, Instagram বা WhatsApp-এর অর্ডার, খুচরা দামে)।",
          image: {
            id: "sales-new-order-2",
            caption: "প্রথম ধাপে “Channel” বাছাই ও “Find a buyer” ঘর",
          },
        },
        {
          text: "“Find a buyer” ঘরে ক্রেতার নাম, কোড বা ফোন লিখে তালিকা থেকে বেছে নিন। পাইকারি অর্ডারে ক্রেতা লাগবেই। পাশে দেখাবে ক্রেতার কাছে কত পাওনা বা কত জমা (“Owes” / “Credit”)। “Order date”, দরকার হলে “Ship by (optional)” ও “Warehouse” দিয়ে নিচের “Next” বোতামে চাপুন।",
        },
        {
          text: "দ্বিতীয় ধাপ “Products”: “Find a style” ঘরে স্টাইলের কোড বা নাম লিখে বেছে নিন। স্টাইলটি একটি কার্ডে খুলবে, ভেতরে রং × সাইজের ছোট ছক। প্রতিটি ঘরে যত পিস চান লিখুন। ঘরের নিচের ছোট সংখ্যাটি কত পিস তৈরি আছে; একেবারে না থাকলে মোটা লাল “0” দেখায়।",
          image: {
            id: "sales-new-order-3",
            caption: "স্টাইলের কার্ডে রং × সাইজ ছক, প্রতিটি ঘরের নিচে তৈরি পিস ও লাল 0",
          },
        },
        {
          text: "সব রঙে একই অনুপাতে পিস দিতে “Magic Ratio” চাপুন। “Ratio for …” ঘরে প্রতিটি সাইজের জন্য একটি করে সংখ্যা লিখুন, যেমন 1:2:2:1 (কোনো সাইজ বাদ দিতে 0)। “Sets for each colour”-এ কত সেট লিখুন (10 সেট 1:2:2:1 মানে 10, 20, 20, 10 পিস)। কোন কোন রঙে বসবে বেছে “Fill the grid” চাপুন। Products-এ সংরক্ষিত অনুপাত থাকলে সেগুলো বোতাম হিসেবেও দেখায়।",
          image: {
            id: "sales-new-order-4",
            caption: "“Magic Ratio” প্যানেল: অনুপাত, সেটের সংখ্যা, রং বাছাই ও “Fill the grid”",
          },
        },
        {
          text: "দাম ফাঁকা রাখলে তালিকার দাম বসবে (পাইকারিতে wholesale, খুচরায় retail)। পুরো স্টাইলের জন্য অন্য দাম চাইলে কার্ডের দামের ঘরে লিখুন। আরও স্টাইল যোগ করতে “Add another style” ঘরে খুঁজুন। একবারে একটি কার্ড খোলা থাকে; বাকিগুলো ভাঁজ হয়ে শুধু মোট পিস ও টাকা দেখায়, চাপলে আবার খোলে।",
        },
        {
          text: "তৃতীয় ধাপ “Charges & delivery”: “Discount” হলো পুরো বিলের উপর একসাথে ছাড়, যেমন দরদাম করে ঠিক করা দাম বা খুচরা টাকা বাদ। “Round to 10” বা “Round to 100” চাপলে মোট টাকা নিচের গোল অঙ্কে নামিয়ে ছাড়টি নিজেই বসে যায়। দরকার হলে “Delivery charge” ও “Tax / VAT” দিন।",
        },
        {
          text: "একই ধাপে “Total cartons (optional)”-এ কত কার্টনে মাল যাবে আর “Packed by (optional)”-এ কে প্যাক করেছেন (HR-এর কর্মীদের তালিকা থেকে) বেছে নিন। দুটোই প্যাকিং লিস্ট ও চালানে ছাপা হয়, পরে অর্ডারের পাতা থেকেও দেওয়া যায়।",
        },
        {
          text: "শেষ ধাপ “Review & place”: পুরো অর্ডারের সারাংশ দেখুন। ক্রেতার ক্রেডিট লিমিট নিজে থেকেই যাচাই হয়: “Within the buyer's credit limit” লেখা এলে ঠিক আছে; “This order cannot go on the buyer's credit” এলে কিছু টাকা এখনই নিন, অর্ডার কমান বা Accounts-কে লিমিট বাড়াতে বলুন।",
        },
        {
          text: "“At checkout” অংশে বেছে নিন এখনই কী হবে: “Issue the invoice”, “Make the packing list”, “Hand the goods over now (delivery challan)”, আর অনুমতি থাকলে “Payment received now”। তারপর “Place the order” চাপুন। অর্ডারের পাতা খুলবে, সেখানে ইনভয়েস, প্যাকিং লিস্ট ও চালানের PDF পাবেন।",
          image: {
            id: "sales-new-order-5",
            caption: "শেষ ধাপে সারাংশ, ক্রেডিট লিমিটের বার্তা, “At checkout” টিকবক্স ও মোট টাকা",
          },
        },
      ],
      tips: [
        "নিচের বারে সবসময় মোট পিস ও মোট টাকা দেখায়। “Back” চেপে আগের ধাপে ফিরে কিছু বদলালেও লেখা হারায় না।",
        "কোনো ধাপে ভুল থাকলে অর্ডার দেওয়ার সময় সেই ধাপটি নিজেই খুলে যায় এবং ঘরটি লাল দেখায়।",
        "অর্ডার সংরক্ষণের সময় স্টকে থাকা পিস অর্ডারের জন্য আটকে রাখা হয়।",
        "স্টকের চেয়ে বেশি পিস লিখলে ঘরটি চিহ্নিত হয়। অর্ডার দেওয়ার সময় “Not enough stock” জানালা আসে, যার কথা “স্টকের চেয়ে বেশি বিক্রি” গাইডে আছে।",
        "আর্কাইভ করা স্টাইল শুধু বাকি স্টক থেকেই বিক্রি করা যায়।",
      ],
    },
    {
      slug: "sales-counter-sale",
      title: "কাউন্টার বা অনলাইন বিক্রি (ক্রেতার প্রোফাইল ছাড়া) করবেন যেভাবে",
      summary:
        "দোকানের হঠাৎ আসা ক্রেতা বা Facebook-এর অর্ডার, ক্রেতার প্রোফাইল না খুলেই নাম, ফোন ও ঠিকানা দিয়ে বিক্রি করা।",
      keywords: [
        "counter sale",
        "pos",
        "walk-in customer",
        "social commerce",
        "facebook order",
        "retail",
        "কাউন্টার",
        "দোকান",
        "খুচরা",
        "ফেসবুক অর্ডার",
        "ওয়াক-ইন",
      ],
      routes: ["/sales/orders/new"],
      who: "যাঁদের অর্ডার তৈরির অনুমতি আছে, যেমন Sales Executive ও Super Admin।",
      anyOf: ["sales.order.create"],
      steps: [
        {
          text: "“Sales” > “Orders” > “New order” খুলুন এবং “Channel”-এ “Counter sale” বা “Social commerce” বেছে নিন।",
        },
        {
          text: "“Buyer (optional)” ফাঁকা রাখুন। তখন অর্ডারটি “Walk-in customer” নামে হবে।",
        },
        {
          text: "“Customer name (optional)”, “Customer phone (optional)” ও “Delivery address (optional)” লিখুন, যাতে ডেলিভারি ও পরে খোঁজার সময় কাজে লাগে।",
          image: {
            id: "sales-counter-sale-1",
            caption:
              "ক্রেতা ছাড়া অর্ডারে “Customer name”, “Customer phone” ও “Delivery address” ঘর",
          },
        },
        {
          text: "স্টাইল ও পিস লিখুন। খুচরা দাম নিজে থেকেই বসবে।",
        },
        {
          text: "দোকানে হাতে হাতে মাল দিলে “At checkout”-এ “Issue the invoice” ও “Hand the goods over now (delivery challan)” টিক দিন। টাকা নেওয়ার অনুমতি থাকলে “Payment received now” টিক দিয়ে “Paid by” (Cash, bKash, Nagad ইত্যাদি) বেছে নিন।",
        },
        { text: "“Place the order” চাপুন এবং দরকার হলে ইনভয়েসের PDF ছাপুন।" },
      ],
      tips: [
        "তালিকায় ক্রেতার ফোন নম্বর দিয়েও অর্ডার খোঁজা যায়।",
        "Courier-এ বুকিং ও ওয়েবসাইটের অর্ডার নিজে থেকে আসা এখনো চালু হয়নি।",
      ],
    },
    {
      slug: "sales-force-override",
      title: "স্টকের চেয়ে বেশি বিক্রি (Force Allow) করবেন যেভাবে",
      summary:
        "স্টক কম থাকলেও বিশেষ কারণে অর্ডার নিতে হলে “Not enough stock” জানালায় কারণ লিখে “Force Allow” করা।",
      keywords: [
        "force allow",
        "force override",
        "sell beyond stock",
        "oversell",
        "negative stock",
        "override",
        "not enough stock",
        "স্টকের বেশি",
        "স্টক নেই",
        "ওভাররাইড",
        "জোর করে বিক্রি",
      ],
      routes: ["/sales/orders/new"],
      who: "শুধু যাঁদের “sell beyond stock” অনুমতি আছে। শুরুতে শুধু Super Admin।",
      anyOf: ["sales.force_override"],
      steps: [
        {
          text: "অর্ডারের ছকে স্টকের চেয়ে বেশি পিস লিখলে সেই ঘর চিহ্নিত হয়, স্টাইলের কার্ডে “short of stock” লেখা আসে এবং শেষ ধাপে সতর্কবার্তা দেখায়।",
        },
        {
          text: "“Place the order” চাপলে “Not enough stock” জানালা খুলবে, কোন কোন SKU-তে কত পিস চাওয়া আর কত তৈরি আছে তার তালিকাসহ।",
          image: {
            id: "sales-force-override-1",
            caption: "“Not enough stock” জানালা: কম পড়া SKU, “Why” ঘর ও “Force Allow” বোতাম",
          },
        },
        {
          text: "অনুমতি থাকলে “Why” ঘরে কারণ লিখুন, যেমন “কাল ফ্যাক্টরি থেকে মাল আসছে”, তারপর “Force Allow” চাপুন। কারণটি অর্ডারে ও কাজের খাতায় (activity log) স্থায়ীভাবে থেকে যায়।",
        },
        {
          text: "পিস কমাতে চাইলে “Change the pieces” চাপুন; পণ্যের ধাপ খুলে যাবে। অর্ডার দেওয়ার পরে তালিকা ও পাতায় “Force override” চিহ্ন দেখাবে।",
        },
      ],
      tips: [
        "অনুমতি না থাকলে জানালায় শুধু “Change the pieces” থাকে। পিস কমিয়ে দিন অথবা Super Admin-কে বলুন।",
        "Force Allow করলে স্টক শূন্যের নিচে যায়, মাল তৈরি হয়ে এলে ঠিক হয়ে যায়।",
      ],
    },
    {
      slug: "sales-order-documents",
      title: "অর্ডারের ইনভয়েস, প্যাকিং লিস্ট ও চালান তৈরি করবেন যেভাবে",
      summary:
        "অর্ডার নেওয়ার পরে ইনভয়েস দেওয়া, প্যাকিং লিস্ট বানানো, পুরো বা আংশিক মাল চালান দিয়ে পাঠানো আর পাঠানোর দিন ঠিক করা।",
      keywords: [
        "invoice",
        "packing list",
        "challan",
        "delivery challan",
        "deliver goods",
        "partial delivery",
        "ship by",
        "pdf",
        "ইনভয়েস",
        "চালান",
        "প্যাকিং লিস্ট",
        "ডেলিভারি",
        "মাল পাঠানো",
      ],
      routes: ["/sales/orders"],
      who: "যাঁদের অর্ডার তৈরির অনুমতি আছে, যেমন Sales Executive ও Super Admin। PDF সবাই ছাপতে পারেন যাঁরা Sales দেখতে পারেন।",
      anyOf: ["sales.order.create"],
      steps: [
        {
          text: "“Sales” > “Orders” তালিকা থেকে অর্ডারে চাপুন। উপরে কাজের বোতামগুলো থাকে।",
          image: {
            id: "sales-order-documents-1",
            caption: "অর্ডারের পাতার উপরে “Issue the invoice”, “Deliver goods” ও অন্যান্য বোতাম",
          },
        },
        {
          text: "ইনভয়েস দিতে “Issue the invoice” চাপুন, “Invoice date” ও দরকার হলে “Due by (optional)” (কবের মধ্যে টাকা দেবে) দিয়ে নিশ্চিত করুন।",
        },
        {
          text: "প্যাকিং লিস্ট বানাতে “Make the packing list” চাপুন। “Cartons (optional)”, “Gross weight, kg (optional)” ও নোট দিয়ে নিশ্চিত করুন। অর্ডারে কার্টনের সংখ্যা দেওয়া থাকলে তা আগে থেকেই বসানো থাকে।",
        },
        {
          text: "কত কার্টন ও কে প্যাক করেছেন দিতে বা বদলাতে উপরের মেনু (তিন বিন্দু) থেকে “Cartons and packer” চাপুন। “Total cartons” লিখে “Packed by” থেকে কর্মী বেছে “Save” চাপুন। পাতার “Delivery” অংশে দুটোই দেখাবে, আর প্যাকিং লিস্ট ও চালানের PDF-এ ছাপা হবে।",
          image: {
            id: "sales-order-documents-3",
            caption: "“Cartons and packer” জানালা: “Total cartons” ও “Packed by”",
          },
        },
        {
          text: "মাল পাঠাতে “Deliver goods” চাপুন। “What goes out”-এ প্রতিটি লাইনের কত পিস যাচ্ছে লিখুন (আংশিকও পাঠানো যায়)। “Delivered on”, এবং চাইলে “Received by”, “Vehicle number”, “Driver” ও “Driver's phone” দিন। “Make the challan” চাপুন।",
          image: {
            id: "sales-order-documents-2",
            caption: "“Deliver goods” জানালা: পিসের ঘর, “Delivered on”, গাড়ি ও ড্রাইভারের তথ্য",
          },
        },
        {
          text: "গুদাম থেকে কবে মাল বের হবে ঠিক করতে “Set a ship-by day” (বা “Change the ship-by day”) চাপুন। ফাঁকা রেখে সংরক্ষণ করলে দিনটি মুছে যায়।",
        },
        {
          text: "পাতার “Documents” অংশে ইনভয়েস, প্যাকিং লিস্ট ও প্রতিটি চালানের “PDF” বোতাম পাবেন। কোম্পানির নিজস্ব টেমপ্লেট থাকলে পাশে “Template” বোতামও থাকে।",
        },
      ],
      tips: [
        "“Delivery” অংশে প্রতিটি লাইনের “Pieces”, “Delivered” ও “Left” দেখে বুঝবেন কত পিস বাকি।",
        "একটি অর্ডারে একটিই চালু ইনভয়েস ও একটিই প্যাকিং লিস্ট থাকে, কিন্তু চালান একাধিক হতে পারে।",
        "চালান বা ইনভয়েস WhatsApp বা ইমেইলে পাঠানো এখনো চালু হয়নি। PDF নামিয়ে পাঠাতে পারেন।",
      ],
    },
    {
      slug: "sales-receive-payment",
      title: "ক্রেতার কাছ থেকে টাকা গ্রহণ রেকর্ড করবেন যেভাবে",
      summary:
        "অর্ডার, ইনভয়েস, প্রোফর্মা বা ক্রেতার হিসাবে আসা টাকা রেকর্ড করা এবং মানি রিসিট ছাপা।",
      keywords: [
        "payment",
        "receive a payment",
        "money receipt",
        "collection",
        "on account",
        "bkash",
        "cash",
        "টাকা গ্রহণ",
        "পেমেন্ট",
        "টাকা জমা",
        "মানি রিসিট",
        "কালেকশন",
        "বকেয়া আদায়",
      ],
      routes: ["/sales/payments", "/sales/orders", "/sales/invoices"],
      who: "শুধু Accounts ও Super Admin (টাকা গ্রহণের অনুমতি)। Sales Executive টাকা রেকর্ড করতে পারেন না।",
      anyOf: ["accounts.receipts.record"],
      steps: [
        {
          text: "যে অর্ডার, ইনভয়েস বা প্রোফর্মার টাকা, তার পাতা খুলে “Receive a payment” চাপুন। কোনো একটি অর্ডারের নয়, ক্রেতার মোট বকেয়ার টাকা হলে “Payments” ট্যাবে “Receive a payment” চাপুন।",
          image: {
            id: "sales-receive-payment-1",
            caption: "অর্ডারের পাতায় “Receive a payment” বোতাম",
          },
        },
        {
          text: "ক্রেতার হিসাবে নিলে “Buyer” বেছে নিন। তারপর টাকার পরিমাণ লিখুন।",
        },
        {
          text: "“Paid by”-এ কীভাবে দিয়েছে বেছে নিন: “Cash”, “Bank transfer”, “Cheque”, “bKash”, “Nagad”, “Rocket”, “Card” ইত্যাদি। দরকার হলে “Reference (optional)”-এ লেনদেন নম্বর বা চেক নম্বর লিখুন।",
          image: {
            id: "sales-receive-payment-2",
            caption: "টাকা গ্রহণের জানালা: পরিমাণ, “Paid by”, “Reference” ও “Received on”",
          },
        },
        {
          text: "“Received on”-এ তারিখ দিন, দরকার হলে নোট লিখুন, তারপর “Record the payment” চাপুন।",
        },
        {
          text: "টাকার রসিদ দেখতে “Payments” ট্যাবে সেই পেমেন্টে চাপুন। “Money receipt” পাতায় “Receipt PDF” থেকে মানি রিসিট ছাপুন।",
        },
      ],
      tips: [
        "একটি অর্ডারে যত বাকি তার বেশি টাকা নেওয়া যায় না। বাড়তি টাকা ক্রেতার হিসাবে (on account) নিন।",
        "নতুন অর্ডারের সময়ই “Payment received now” টিক দিয়েও টাকা নেওয়া যায়।",
      ],
    },
    {
      slug: "sales-edit-cancel-order",
      title: "অর্ডার বদলাবেন, বাতিল করবেন বা ইনভয়েস বাতিল (Void) করবেন যেভাবে",
      summary:
        "মাল যাওয়ার আগে অর্ডারের পিস বা দাম বদলানো, পুরো অর্ডার বাতিল করা আর ভুল ইনভয়েস বাতিল করা।",
      keywords: [
        "edit order",
        "cancel order",
        "void invoice",
        "change order",
        "mistake",
        "অর্ডার বদল",
        "অর্ডার বাতিল",
        "ইনভয়েস বাতিল",
        "ভুল সংশোধন",
        "এডিট",
      ],
      routes: ["/sales/orders"],
      who: "অর্ডার বদলাতে ও বাতিল করতে অর্ডার তৈরির অনুমতি লাগে। ইনভয়েস বাতিল (এবং ইনভয়েস হওয়া অর্ডার বাতিল) শুধু যাঁদের অনুমতি আছে, শুরুতে শুধু Super Admin।",
      anyOf: ["sales.order.create"],
      steps: [
        {
          text: "অর্ডারের পাতা খুলে “Edit” চাপুন। পিস, দাম, চার্জ বা নোট বদলে সংরক্ষণ করুন। সংরক্ষণের সময় আটকে রাখা স্টক নতুন করে হিসাব হয়।",
        },
        {
          text: "ইনভয়েস হয়ে গেলে আগে ইনভয়েস বাতিল করতে হবে: “Void the invoice” চাপুন, “Reason”-এ কারণ লিখে নিশ্চিত করুন। তারপর “Edit” আবার দেখা যাবে।",
          image: {
            id: "sales-edit-cancel-order-1",
            caption: "“Void the invoice” জানালা ও “Reason” ঘর",
          },
        },
        {
          text: "পুরো অর্ডার বাতিল করতে “Cancel the order” চাপুন, “Reason”-এ কারণ লিখে আবার “Cancel the order” চাপুন। আটকে রাখা স্টক আবার বিক্রির জন্য খালি হবে।",
        },
      ],
      tips: [
        "কিছু মাল চালান দিয়ে চলে গেলে অর্ডার আর বদলানো বা বাতিল করা যায় না।",
        "বাতিল (Void) ইনভয়েস মোছা হয় না, রেকর্ড হিসেবে থেকে যায়; ক্রেতার কাছে আর পাওনা থাকে না।",
        "অর্ডারে টাকা নেওয়া থাকলে বাতিলের জানালাতেই বলে দিতে হয় সেই টাকা ফেরত যাবে, ক্রেতার হিসাবে জমা থাকবে, না বাতিলের চার্জ হবে।",
      ],
    },
    {
      slug: "sales-refund",
      title: "ক্রেতার টাকা ফেরত দেবেন বা জমা রাখবেন যেভাবে",
      summary:
        "অর্ডার বা প্রোফর্মায় নেওয়া টাকা ফেরত দেওয়া, ক্রেতার হিসাবে জমা রাখা বা বাতিলের চার্জ হিসেবে রাখা।",
      keywords: [
        "refund",
        "refund money paid",
        "paid back",
        "kept as credit",
        "cancellation charge",
        "refund voucher",
        "টাকা ফেরত",
        "রিফান্ড",
        "জমা রাখা",
        "বাতিলের চার্জ",
        "ফেরত",
      ],
      routes: ["/sales/payments", "/sales/orders", "/sales/proformas"],
      who: "শুধু Accounts ও Super Admin। টাকা ফেরত দিতে টাকা পরিশোধের অনুমতি, জমা রাখতে টাকা গ্রহণের অনুমতি, আর বাতিলের চার্জ রাখতে হিসাব সামলানোর অনুমতি লাগে।",
      anyOf: ["accounts.payments.record", "accounts.receipts.record", "accounts.manage"],
      steps: [
        {
          text: "অর্ডারের পাতায় “Refund money paid” অথবা প্রোফর্মার পাতায় “Refund the advance” চাপুন।",
        },
        {
          text: "কী হবে বেছে নিন: “Paid back” (ক্যাশ, ব্যাংক বা ওয়ালেট থেকে ফেরত), “Kept as credit” (ক্রেতার হিসাবে জমা, পরের অর্ডারে কাজে লাগবে) অথবা “Cancellation charge” (কোম্পানি চার্জ হিসেবে রাখবে)।",
          image: {
            id: "sales-refund-1",
            caption:
              "রিফান্ডের জানালায় তিনটি বিকল্প: “Paid back”, “Kept as credit”, “Cancellation charge”",
          },
        },
        {
          text: "“Paid back” হলে “Paid back by” ও দরকার হলে “Reference (optional)” দিন।",
        },
        {
          text: "পরিমাণ, “Refunded on” ও “Reason” লিখে “Record the refund” চাপুন।",
        },
        {
          text: "“Payments” ট্যাবে “Refunds” বেছে নিলে সব রিফান্ড দেখবেন। প্রতিটির “Voucher PDF” ছাপা যায়, আর ভুল হলে “Void” করা যায়।",
        },
      ],
      tips: [
        "ইনভয়েস হয়ে যাওয়া অর্ডারের টাকা ফেরত দিতে আগে ইনভয়েস বাতিল (Void) করতে হয়।",
        "প্রোফর্মা অর্ডারে পরিণত হলে তার অগ্রিম অর্ডারে চলে যায়, তখন রিফান্ড অর্ডারের পাতা থেকে করুন।",
      ],
    },
    {
      slug: "sales-quotation",
      title: "কোটেশন তৈরি করবেন যেভাবে",
      summary:
        "ক্রেতাকে দাম জানাতে ক্যাটালগের স্টাইল বা নিজের লেখা পণ্য, কাপড়, রং, পিস ও দাম দিয়ে কোটেশন বানানো।",
      keywords: [
        "quotation",
        "quote",
        "new quotation",
        "price offer",
        "styling rules",
        "terms",
        "কোটেশন",
        "দরপত্র",
        "দাম জানানো",
        "কোট",
        "quotation banao",
      ],
      routes: ["/sales/quotations/new", "/sales/quotations"],
      who: "যাঁদের কোটেশন সামলানোর অনুমতি আছে, যেমন Sales Executive ও Super Admin।",
      anyOf: ["sales.quotation.manage"],
      steps: [
        {
          text: "“Sales” > “Quotations” ট্যাবে “New quotation” চাপুন।",
          image: {
            id: "sales-quotation-1",
            caption: "“Quotations” ট্যাবে তালিকা ও “New quotation” বোতাম",
          },
        },
        {
          text: "“Buyer and dates” অংশে “Buyer”, “Date” ও দরকার হলে “Valid until (optional)” (কোটেশন কতদিন চলবে) দিন।",
        },
        {
          text: "“Items” অংশে প্রতিটি পণ্যের জন্য ক্যাটালগ থেকে “Style (optional)” বেছে নিন, অথবা “Description”-এ নিজে লিখুন। “Fabric (optional)”, “Colours (optional)”, “Pieces” আর দাম দিন। পিস মোট সংখ্যায় বা সাইজ অনুযায়ী ভাগ করে লেখা যায়।",
          image: {
            id: "sales-quotation-2",
            caption: "কোটেশনের একটি পণ্যের ঘর: স্টাইল, বর্ণনা, কাপড়, রং, পিস ও দাম",
          },
        },
        { text: "আরও পণ্য যোগ করতে “Add an item” চাপুন।" },
        {
          text: "ফ্যাক্টরির জন্য বিশেষ নির্দেশ থাকলে “Styling rules”-এ “Add a styling rule” চাপুন, জায়গা (কলার, প্ল্যাকেট…) ও কী করতে হবে লিখুন।",
        },
        {
          text: "“Totals and terms” অংশে ছাড়, ট্যাক্স, “Terms (optional)” ও “Notes (optional)” দিন। “More details”-এ কোম্পানির নিজস্ব ঘর থাকলে পূরণ করুন।",
        },
        {
          text: "“Save the quotation” চাপুন। কোটেশনটি “Draft” অবস্থায় সংরক্ষণ হবে এবং এর পাতা খুলবে।",
        },
      ],
      tips: [
        "কোটেশন ছাপতে বা ক্রেতাকে পাঠাতে পরের নির্দেশিকা দেখুন।",
        "তালিকায় কোটেশন নম্বর বা ক্রেতার নামের অংশ দিয়ে খোঁজা যায়, অবস্থা (“Status”) দিয়েও ছাঁকা যায়।",
      ],
    },
    {
      slug: "sales-quotation-status",
      title: "কোটেশন ছাপবেন, পাঠানো বা গৃহীত হিসেবে চিহ্নিত করবেন যেভাবে",
      summary:
        "কোটেশনের PDF ছাপা, “Sent”, “Accepted” বা “Rejected” চিহ্ন দেওয়া, বদলানো আর খসড়া মুছে ফেলা।",
      keywords: [
        "quotation pdf",
        "mark as sent",
        "mark as accepted",
        "mark as rejected",
        "edit quotation",
        "delete draft",
        "print",
        "কোটেশন ছাপা",
        "কোটেশন পাঠানো",
        "গৃহীত",
        "বাতিল",
        "প্রিন্ট",
      ],
      routes: ["/sales/quotations"],
      who: "যাঁদের কোটেশন সামলানোর অনুমতি আছে। PDF সবাই নামাতে পারেন যাঁরা Sales দেখতে পারেন।",
      anyOf: ["sales.quotation.manage"],
      steps: [
        {
          text: "“Quotations” তালিকা থেকে কোটেশনে চাপুন।",
        },
        {
          text: "ছাপতে বা ক্রেতাকে পাঠাতে “PDF” চাপুন। কোম্পানির লেটারহেডে PDF তৈরি হবে। নিজস্ব টেমপ্লেট থাকলে “Template” বোতামও পাবেন।",
          image: {
            id: "sales-quotation-status-1",
            caption: "কোটেশনের পাতায় “PDF”, “Mark as sent” ও “Make a proforma invoice” বোতাম",
          },
        },
        {
          text: "ক্রেতাকে পাঠানোর পর “Mark as sent” চাপুন। ক্রেতা রাজি হলে “Mark as accepted”, রাজি না হলে “Mark as rejected”।",
        },
        {
          text: "“Draft” বা “Sent” কোটেশন বদলাতে “Edit” চাপুন, বদলে “Save the changes” চাপুন।",
        },
        {
          text: "কখনো পাঠানো হয়নি এমন খসড়া দরকার না হলে “Delete the draft” চাপুন। এর নম্বর আর ব্যবহার হবে না।",
        },
      ],
      tips: [
        "গৃহীত, বাতিল বা প্রোফর্মা হয়ে যাওয়া কোটেশন আর বদলানো যায় না।",
        "পাঠানো কোটেশন মোছা যায় না, দরকার হলে “Mark as rejected” করুন।",
        "“Valid until” পেরিয়ে গেলে কোটেশনে “Expired” লেখা দেখাবে।",
      ],
    },
    {
      slug: "sales-proforma",
      title: "প্রোফর্মা ইনভয়েস বানিয়ে অগ্রিম নেবেন ও অর্ডারে পরিণত করবেন যেভাবে",
      summary:
        "কোটেশন থেকে অগ্রিম চেয়ে প্রোফর্মা ইনভয়েস বানানো, অগ্রিম নেওয়া, তারপর অর্ডার তৈরি করা, অথবা প্রোফর্মা বাতিল করা।",
      keywords: [
        "proforma",
        "proforma invoice",
        "advance",
        "make the order",
        "b2b pre-order",
        "cancel the proforma",
        "প্রোফর্মা",
        "অগ্রিম",
        "অ্যাডভান্স",
        "প্রি-অর্ডার",
        "পিআই",
      ],
      routes: ["/sales/proformas", "/sales/quotations"],
      who: "প্রোফর্মা বানাতে ও অর্ডার করতে কোটেশন ও অর্ডারের অনুমতি লাগে (Sales Executive, Super Admin)। অগ্রিম টাকা নেন শুধু Accounts ও Super Admin।",
      anyOf: ["sales.quotation.manage", "accounts.receipts.record"],
      steps: [
        {
          text: "কোটেশনের পাতায় “Make a proforma invoice” চাপুন। “Advance (%)”-এ কত শতাংশ অগ্রিম চাইবেন দিন (কোম্পানির সাধারণ হার আগে থেকে বসানো থাকে), তারপর “Make the proforma” চাপুন।",
          image: {
            id: "sales-proforma-1",
            caption: "“Make a proforma invoice” জানালা ও “Advance (%)” ঘর",
          },
        },
        {
          text: "প্রোফর্মার “PDF” ছেপে ক্রেতাকে দিন। “Proformas” ট্যাবে এটি “Awaiting advance” অবস্থায় দেখাবে।",
        },
        {
          text: "ক্রেতা অগ্রিম দিলে Accounts প্রোফর্মার পাতায় “Receive the advance” চেপে টাকা রেকর্ড করবেন। “Advance” অংশে চাওয়া, পাওয়া ও বাকি অগ্রিম দেখা যায়।",
          image: {
            id: "sales-proforma-2",
            caption:
              "প্রোফর্মার পাতায় “Advance” অংশ: “Advance asked”, “Advance paid”, “Advance still due”",
          },
        },
        {
          text: "অগ্রিম পুরো পাওয়ার পর মাল তৈরি হলে “Make the order” চাপুন। অর্ডারের ফর্ম “B2B pre-order” হিসেবে খুলবে, পণ্য ও দাম আগে থেকে বসানো থাকবে। গুদাম ও পিস মিলিয়ে “Make the order” চাপুন। অগ্রিম অর্ডারে চলে যাবে।",
        },
        {
          text: "ক্রেতা পিছিয়ে গেলে “Cancel the proforma” চাপুন। আগে নেওয়া অগ্রিম কী হবে (ফেরত, জমা বা চার্জ) তা বলে দিতে হবে।",
        },
      ],
      tips: [
        "অগ্রিম পুরো না পাওয়া পর্যন্ত “Make the order” কাজ করবে না।",
        "অর্ডার হয়ে যাওয়া প্রোফর্মা বাতিল করা যায় না, তখন অর্ডারটি বাতিল করুন।",
      ],
    },
    {
      slug: "sales-invoices",
      title: "ইনভয়েস ও বকেয়া (Overdue) দেখবেন যেভাবে",
      summary:
        "সব ইনভয়েস, কত টাকা পাওয়া গেছে ও কত বাকি, আর সময় পেরিয়ে যাওয়া বকেয়া ইনভয়েস খুঁজে বের করা।",
      keywords: [
        "invoices",
        "overdue",
        "due",
        "unpaid",
        "part paid",
        "invoice pdf",
        "ইনভয়েস",
        "বকেয়া",
        "বাকি টাকা",
        "মেয়াদোত্তীর্ণ",
        "পাওনা",
      ],
      routes: ["/sales/invoices"],
      who: "যাঁরা Sales দেখতে পারেন।",
      steps: [
        {
          text: "“Sales” > “Invoices” ট্যাব খুলুন। প্রতিটি ইনভয়েসের “Buyer”, “Due day”, “Status”, “Total” ও “Due” দেখবেন।",
          image: {
            id: "sales-invoices-1",
            caption: "“Invoices” ট্যাবের তালিকা ও “Status” বাছাই",
          },
        },
        {
          text: "বকেয়া খুঁজতে “Status” থেকে “Overdue” বেছে নিন। এগুলোর টাকা দেওয়ার দিন পেরিয়ে গেছে কিন্তু পুরো টাকা আসেনি। “Unpaid”, “Part paid” বা “Paid” দিয়েও ছাঁকা যায়।",
        },
        {
          text: "ইনভয়েস বা অর্ডার নম্বর, বা ক্রেতার নাম দিয়ে খুঁজুন।",
        },
        {
          text: "ইনভয়েসে চাপলে তার পাতা খুলবে: হিসাব (“Billed”), ক্রেতার তথ্য (“Billed to”), আর কী কী পেমেন্ট এসেছে। “PDF” থেকে ছাপুন।",
        },
        {
          text: "Accounts এখান থেকেই “Receive a payment” দিয়ে টাকা নিতে পারেন। অনুমতি থাকলে “Void” দিয়ে ইনভয়েস বাতিল করা যায়।",
        },
      ],
      tips: [
        "অর্ডার নেওয়ার সময় ইনভয়েস দেওয়া হলে সেটি এখানে আসে। ইনভয়েস ছাড়া অর্ডার তালিকায় “Not invoiced” লেখা থাকে।",
      ],
    },
    {
      slug: "sales-payments-list",
      title: "পাওয়া টাকা ও রিফান্ডের তালিকা দেখবেন যেভাবে",
      summary: "কোন দিন কার কাছ থেকে কত টাকা এসেছে এবং কাকে কত ফেরত দেওয়া হয়েছে তা দেখা।",
      keywords: [
        "payments",
        "money received",
        "refunds",
        "receipt",
        "collection report",
        "টাকা পাওয়া",
        "আদায়",
        "রিফান্ড তালিকা",
        "রসিদ",
      ],
      routes: ["/sales/payments"],
      who: "যাঁরা Sales দেখতে পারেন।",
      steps: [
        {
          text: "“Sales” > “Payments” ট্যাব খুলুন। “Money received” বেছে নিলে পাওয়া টাকা, “Refunds” বেছে নিলে ফেরত দেওয়া টাকা দেখাবে।",
          image: {
            id: "sales-payments-list-1",
            caption: "“Payments” ট্যাব: “Money received” / “Refunds” বাছাই ও তারিখের ঘর",
          },
        },
        {
          text: "“From” ও “To” তারিখ দিয়ে নির্দিষ্ট দিনগুলো দেখুন। “Clear filters” দিয়ে আবার সব দেখুন।",
        },
        {
          text: "তালিকায় “Receipt” নম্বর, কার কাছ থেকে (“From”), কিসের জন্য (“For”), “Method” ও “Amount” থাকে। কোনো সারিতে চাপলে মানি রিসিটের পাতা খুলবে।",
        },
      ],
    },
  ],
};
