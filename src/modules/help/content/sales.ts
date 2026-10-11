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
        "previous due",
        "use credit",
        "advance balance",
        "cheque",
        "অর্ডার",
        "নতুন অর্ডার",
        "আগের বকেয়া",
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
        {
          text: "ক্রেতা বাছাই করা থাকলে আর “Issue the invoice” টিক দেওয়া থাকলে নিচে ক্রেতার আগের হিসাবও আসে। “Include previous due (…)” টিক দিলে ক্রেতার আগের বকেয়া এই ইনভয়েসে ছাপা হয়, সঙ্গে “Total payable” (আগের বকেয়া + এই বিল)। শুধু এই অর্ডারটিই বিক্রি হিসেবে গোনা হয়, আগের বকেয়া আবার বিক্রিতে যোগ হয় না।",
          image: {
            id: "sales-new-order-6",
            caption:
              "“At checkout”-এ “Include previous due (…)” টিক ও “Use credit balance (…)” ঘর, নিচে “Total payable”",
          },
        },
        {
          text: "ক্রেতার জমা টাকা (advance balance) থাকলে Accounts “Use credit balance (…)” ঘরে কতটা এই বিলে লাগাবেন লিখতে পারেন, পুরোটা বা অল্প। “Use the most” চাপলে যতটা লাগানো যায় ততটা বসে যায়। মোট টাকার ঘরে “Credit used”, “Paid now” ও “Balance due” দেখাবে।",
        },
        {
          text: "“Payment received now”-এ বিলের চেয়ে বেশি টাকা নিলে বাড়তি টাকা ক্রেতার হিসাবে যায়: আগের বকেয়া টিক দেওয়া থাকলে আগে পুরনো বকেয়া (সবচেয়ে পুরনোটা আগে) শোধ হয়, বাকিটা “Kept as advance balance” হিসেবে জমা থাকে। “Paid by”-তে “Cheque” বাছলে “Cheque number”, “Bank (optional)” ও “Date on the cheque” দিন; চেক ক্লিয়ার না হওয়া পর্যন্ত অর্ডারের বাকি থেকেই যায়। চাইলে “Proof photo (optional)”-এ রসিদ বা চেকের ছবি দিন।",
        },
      ],
      tips: [
        "নিচের বারে সবসময় মোট পিস ও মোট টাকা দেখায়। “Back” চেপে আগের ধাপে ফিরে কিছু বদলালেও লেখা হারায় না।",
        "কোনো ধাপে ভুল থাকলে অর্ডার দেওয়ার সময় সেই ধাপটি নিজেই খুলে যায় এবং ঘরটি লাল দেখায়।",
        "অর্ডার সংরক্ষণের সময় স্টকে থাকা পিস অর্ডারের জন্য আটকে রাখা হয়।",
        "স্টকের চেয়ে বেশি পিস লিখলে ঘরটি চিহ্নিত হয়। অর্ডার দেওয়ার সময় “Not enough stock” জানালা আসে, যার কথা “স্টকের চেয়ে বেশি বিক্রি” গাইডে আছে।",
        "আর্কাইভ করা স্টাইল শুধু বাকি স্টক থেকেই বিক্রি করা যায়।",
        "বিলের চেয়ে বেশি টাকা নেওয়া যায় শুধু ইনভয়েস দেওয়া হলে ও ক্রেতা বাছাই থাকলে; চেকে কখনো নয়।",
        "জমা টাকা লাগানো ও টাকা নেওয়া শুধু Accounts ও Super Admin পারেন।",
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
        "oldest first",
        "fifo",
        "advance balance",
        "cheque",
        "proof",
        "টাকা গ্রহণ",
        "পেমেন্ট",
        "টাকা জমা",
        "মানি রিসিট",
        "কালেকশন",
        "বকেয়া আদায়",
        "অগ্রিম জমা",
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
          text: "ক্রেতার হিসাবে নিলে নিচে “What it pays” অংশে তাঁর বাকি থাকা ইনভয়েসগুলো আসে, সবচেয়ে পুরনোটা উপরে। “Oldest first” বাছাই থাকলে টাকা নিজে থেকেই সবচেয়ে পুরনো বকেয়া থেকে শোধ হয়। নিজে ভাগ করতে “Choose amounts” চাপুন আর প্রতিটি ইনভয়েসের পাশের ঘরে কত দেবেন লিখুন। যা বাকি থাকে তা “advance balance” হিসেবে ক্রেতার হিসাবে জমা থাকে।",
          image: {
            id: "sales-receive-payment-3",
            caption:
              "“What it pays” অংশ: “Oldest first” ও “Choose amounts”, প্রতিটি ইনভয়েসের পাশে টাকার ঘর",
          },
        },
        {
          text: "“Paid by”-এ কীভাবে দিয়েছে বেছে নিন: “Cash”, “Bank transfer”, “Cheque”, “bKash”, “Nagad”, “Rocket”, “Card” ইত্যাদি। দরকার হলে “Reference (optional)”-এ লেনদেন নম্বর লিখুন।",
          image: {
            id: "sales-receive-payment-2",
            caption: "টাকা গ্রহণের জানালা: পরিমাণ, “Paid by”, “Reference” ও “Received on”",
          },
        },
        {
          text: "“Cheque” বাছলে “Cheque number”, “Bank (optional)” ও “Date on the cheque” দিন। চেকটি “Pending” হিসেবে রাখা হয়: ব্যাংক টাকা না দেওয়া পর্যন্ত হিসাবের খাতায় কিছু ওঠে না, বকেয়াও কমে না। বোতামটির নাম তখন “Record the cheque”।",
        },
        {
          text: "রসিদের স্ক্রিনশট বা চেকের ছবি রাখতে “Drop a photo here, or tap to choose”-এ ছবি টেনে আনুন বা চেপে বেছে নিন (মোবাইলে ক্যামেরাও খোলে)। পাঠানোর আগে ছবিটি নিজে থেকেই প্রায় 100 KB-তে ছোট হয়।",
        },
        {
          text: "“Received on”-এ তারিখ দিন, দরকার হলে নোট লিখুন, তারপর “Record the payment” চাপুন।",
        },
        {
          text: "টাকার রসিদ দেখতে “Payments” ট্যাবে সেই পেমেন্টে চাপুন। “Money receipt” পাতায় “Receipt PDF” থেকে মানি রিসিট ছাপুন।",
        },
      ],
      tips: [
        "ইনভয়েস হওয়া অর্ডারে বাকির চেয়ে বেশি টাকা নিলে অর্ডারটি পুরো শোধ হয়, বাড়তিটা ক্রেতার advance balance-এ জমা থাকে। ইনভয়েসের আগে বা খুচরা ক্রেতার বেলায় বাকির বেশি নেওয়া যায় না।",
        "নতুন অর্ডারের সময়ই “Payment received now” টিক দিয়েও টাকা নেওয়া যায়।",
        "টাকা কোন কোন ইনভয়েসে গেল আর কত জমা রইল, মানি রিসিটের পাতায় “Invoices paid” ও “Kept as advance balance”-এ দেখা যায়।",
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
          text: "আগের বকেয়াসহ দেওয়া ইনভয়েসে হিসাবের নিচে “Previous due”, “Total payable” ও “Balance due” থাকে। ক্রেতার জমা টাকা এই ইনভয়েসে লাগানো হলে পেমেন্টের অংশে “Credit used” দেখায়।",
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
      title: "পেমেন্টের ড্যাশবোর্ড, পাওয়া টাকা ও রিফান্ডের তালিকা দেখবেন যেভাবে",
      summary:
        "আজ কত টাকা এল, কত বকেয়া, কত চেক ক্লিয়ারের অপেক্ষায় বা বাউন্স হলো, আর কোন দিন কার কাছ থেকে কত টাকা এসেছে বা কাকে কত ফেরত গেছে তা দেখা।",
      keywords: [
        "payments",
        "payments dashboard",
        "money received",
        "refunds",
        "receipt",
        "collection report",
        "pending dues",
        "bounced cheques",
        "টাকা পাওয়া",
        "আদায়",
        "আজকের আদায়",
        "রিফান্ড তালিকা",
        "রসিদ",
      ],
      routes: ["/sales/payments"],
      who: "যাঁরা Sales দেখতে পারেন।",
      steps: [
        {
          text: "“Sales” > “Payments” ট্যাব খুলুন। উপরে চারটি ঘর: “Collected today” (আজ পাওয়া টাকা, ফেরত বাদে), “Pending dues” (ইনভয়েসে মোট কত বাকি), “Cheques to clear” (যে চেক এখনো ব্যাংকে ক্লিয়ার হয়নি) ও “Bounced cheques” (এই মাসে বাউন্স হওয়া চেক)। কোনো ঘরে চাপলে তার তালিকা খোলে।",
          image: {
            id: "sales-payments-list-2",
            caption:
              "“Payments” পাতার উপরে “Collected today”, “Pending dues”, “Cheques to clear” ও “Bounced cheques”",
          },
        },
        {
          text: "নিচে “Money received” বেছে নিলে পাওয়া টাকা, “Refunds” বেছে নিলে ফেরত দেওয়া টাকা, আর “Cheques” বেছে নিলে পাওয়া চেকগুলো দেখাবে।",
          image: {
            id: "sales-payments-list-1",
            caption:
              "“Payments” ট্যাব: “Money received” / “Refunds” / “Cheques” বাছাই ও তারিখের ঘর",
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
    {
      slug: "sales-cheques",
      title: "চেক ক্লিয়ার বা বাউন্স হিসেবে চিহ্নিত করবেন যেভাবে",
      summary:
        "ক্রেতার দেওয়া চেক “Pending”, “Cleared” ও “Bounced” হিসেবে রাখা। চেক ক্লিয়ার হলে তবেই টাকা ব্যাংকের খাতায় ওঠে।",
      keywords: [
        "cheque",
        "check",
        "pending cheque",
        "cleared",
        "bounced",
        "mark cleared",
        "mark bounced",
        "bank",
        "চেক",
        "চেক ক্লিয়ার",
        "চেক বাউন্স",
        "ব্যাংক",
      ],
      routes: ["/sales/payments"],
      who: "চেকের তালিকা দেখতে পারেন যাঁরা Sales দেখতে পারেন। চেক নেওয়া, ক্লিয়ার বা বাউন্স করা শুধু Accounts ও Super Admin পারেন।",
      steps: [
        {
          text: "চেক নিতে অর্ডার, ইনভয়েস, প্রোফর্মা বা “Payments” পাতা থেকে “Receive a payment” চাপুন, “Paid by”-তে “Cheque” বেছে “Cheque number”, “Bank (optional)” ও “Date on the cheque” দিন, তারপর “Record the cheque” চাপুন। নতুন অর্ডারের শেষ ধাপেও “Payment received now”-এ চেক নেওয়া যায়।",
        },
        {
          text: "“Sales” > “Payments”-এ “Cheques” বেছে নিন। প্রতিটি চেকের কার্ডে চেক নম্বর, তারিখ, ক্রেতা, ব্যাংক, কিসের জন্য, টাকা ও অবস্থা থাকে। “Every cheque” থেকে “Pending”, “Cleared” বা “Bounced” বেছে ছাঁকা যায়।",
          image: {
            id: "sales-cheques-1",
            caption:
              "“Cheques” তালিকা: চেকের কার্ড, অবস্থার চিহ্ন, “Mark cleared” ও “Mark bounced”",
          },
        },
        {
          text: "ব্যাংক টাকা দিলে “Mark cleared” চাপুন। “Cleared on”-এ ক্লিয়ারের দিন দিন; একাধিক ব্যাংক হিসাব থাকলে “Deposited in” থেকে কোন হিসাবে জমা হলো বেছে নিন। নিশ্চিত করলে তখনই মানি রিসিট তৈরি হয় আর টাকা ব্যাংকের খাতায় ওঠে, অর্ডার বা ইনভয়েসের বাকি কমে।",
          image: {
            id: "sales-cheques-2",
            caption: "“Mark cleared” জানালা: “Cleared on” ও “Deposited in”",
          },
        },
        {
          text: "চেক ফেরত এলে “Mark bounced” চাপুন, “Why it bounced”-এ কারণ লিখে নিশ্চিত করুন। খাতায় কিছু ওঠে না, যে টাকার জন্য চেক ছিল তা বাকিই থাকে। চেকটি “Bounced” হিসেবে তালিকায় থেকে যায়।",
        },
      ],
      tips: [
        "অপেক্ষায় থাকা চেক অর্ডারের পাতাতেও “Pending” চিহ্নসহ দেখায়।",
        "অর্ডার ততদিনে অন্যভাবে শোধ হয়ে গেলে ক্লিয়ার হওয়া চেকের টাকা ক্রেতার হিসাবে যায়: আগে পুরনো বকেয়া শোধ হয়, বাকিটা advance balance হিসেবে জমা থাকে।",
        "চেকের ছবি রাখতে কার্ডে “Add a proof photo” চাপুন।",
      ],
    },
    {
      slug: "sales-use-credit",
      title: "ক্রেতার জমা টাকা (Credit) নতুন বিলে লাগাবেন যেভাবে",
      summary:
        "ক্রেতার advance balance বা জমা থাকা টাকা পুরোটা বা অল্প করে কোনো ইনভয়েস হওয়া অর্ডারের বিলে লাগানো।",
      keywords: [
        "use credit",
        "credit",
        "advance balance",
        "credit balance",
        "return credit",
        "adjust",
        "জমা টাকা",
        "ক্রেডিট",
        "অগ্রিম",
        "সমন্বয়",
      ],
      routes: ["/sales/orders"],
      who: "শুধু Accounts ও Super Admin (টাকা গ্রহণের অনুমতি)।",
      anyOf: ["accounts.receipts.record"],
      steps: [
        {
          text: "ক্রেতার জমা টাকা আসে বাড়তি পেমেন্ট, ক্রেতার হিসাবে নেওয়া টাকা বা “Kept as credit” রিফান্ড থেকে। নতুন অর্ডারের শেষ ধাপে “Use credit balance (…)” ঘরে কতটা লাগাবেন লিখুন (বন্ধনীতে কত জমা আছে লেখা থাকে)।",
        },
        {
          text: "আগের ইনভয়েস হওয়া কোনো অর্ডারে লাগাতে অর্ডারের পাতা খুলে উপরের মেনু (তিন বিন্দু) থেকে “Use credit” চাপুন। কত লাগাবেন লিখে “Use the credit” চাপুন। কত জমা বাকি রইল তা বার্তায় দেখাবে।",
          image: {
            id: "sales-use-credit-1",
            caption: "অর্ডারের মেনুতে “Use credit” ও টাকার ঘর",
          },
        },
        {
          text: "অর্ডারের “Payments” অংশে ও ইনভয়েসে লাগানো টাকা “Credit used” হিসেবে দেখায়, আর বাকি সেই পরিমাণ কমে যায়।",
        },
      ],
      tips: [
        "জমা টাকা লাগানোয় নতুন মানি রিসিট বা হিসাবের এন্ট্রি হয় না; টাকা তো আগেই এসেছে, শুধু কোন বিলে গেল তা লেখা থাকে।",
        "ইনভয়েস বাতিল (Void) করলে লাগানো জমা টাকা আবার ক্রেতার হিসাবে ফিরে যায়।",
        "খুচরা (walk-in) ক্রেতার জমা হিসাব থাকে না।",
      ],
    },
    {
      slug: "sales-previous-due",
      title: "ইনভয়েসে ক্রেতার আগের বকেয়া (Previous due) দেখাবেন যেভাবে",
      summary:
        "নতুন ইনভয়েসে ক্রেতার আগের বকেয়া ও “Total payable” ছাপা, যাতে ক্রেতা এক কাগজে মোট দেনা দেখেন; বিক্রি দুবার গোনা হয় না।",
      keywords: [
        "previous due",
        "total payable",
        "old due",
        "balance due",
        "আগের বকেয়া",
        "পুরনো বাকি",
        "মোট দেনা",
        "বকেয়া",
      ],
      routes: ["/sales/orders", "/sales/invoices"],
      who: "যাঁরা ক্রেতার হিসাব দেখতে পারেন বা টাকা নিতে পারেন, এবং ইনভয়েস দিতে পারেন।",
      anyOf: ["parties.view", "accounts.receipts.record"],
      steps: [
        {
          text: "নতুন অর্ডারের শেষ ধাপে “Issue the invoice” টিক দেওয়া থাকলে, ক্রেতার আগের বকেয়া থাকলে “Include previous due (…)” টিক দিন।",
        },
        {
          text: "পরে ইনভয়েস দিলে অর্ডারের পাতায় “Issue the invoice” চাপুন। জানালায় “Include the previous due of …” টিক দিয়ে নিশ্চিত করুন।",
          image: {
            id: "sales-previous-due-1",
            caption: "“Issue the invoice” জানালায় “Include the previous due of …” টিক",
          },
        },
        {
          text: "ইনভয়েসে ও তার PDF-এ “Previous due”, “Total payable” (আগের বকেয়া + এই বিল), “Paid” ও “Balance due” ছাপা হয়। সঙ্গে টাকা নিলে বাড়তি অংশ আগে পুরনো বকেয়া শোধ করে।",
        },
      ],
      tips: [
        "আগের বকেয়া শুধু দেখানোর জন্য: বিক্রির হিসাবে শুধু এই অর্ডারের টাকাই ওঠে, আগের ইনভয়েস আবার গোনা হয় না।",
        "আগের বকেয়া মানে ইনভয়েস দেওয়ার মুহূর্তে ক্রেতার নিট বাকি, জমা টাকা বাদ দিয়ে। পরে বদলায় না।",
      ],
    },
    {
      slug: "sales-payment-proof",
      title: "পেমেন্ট বা চেকের ছবি (Proof) রাখবেন ও দেখবেন যেভাবে",
      summary:
        "টাকা পাঠানোর স্ক্রিনশট বা চেকের ছবি পেমেন্টের সঙ্গে রাখা। ছবি পাঠানোর আগেই ফোন বা কম্পিউটারে প্রায় 100 KB-তে ছোট হয়, তাই সার্ভারে জায়গা কম লাগে।",
      keywords: [
        "proof",
        "payment proof",
        "screenshot",
        "photo",
        "cheque photo",
        "attachment",
        "ছবি",
        "প্রমাণ",
        "স্ক্রিনশট",
        "রসিদের ছবি",
      ],
      routes: ["/sales/payments"],
      who: "ছবি দেখতে পারেন যাঁরা Sales বা হিসাব দেখতে পারেন। ছবি যোগ বা বদলানো শুধু Accounts ও Super Admin পারেন।",
      steps: [
        {
          text: "টাকা নেওয়ার সময় (“Receive a payment” বা নতুন অর্ডারের “Payment received now”) “Proof photo (optional)” অংশে ছবি টেনে আনুন বা “Drop a photo here, or tap to choose” চেপে বেছে নিন। মোবাইলে ক্যামেরা দিয়ে সরাসরি তোলা যায়।",
          image: {
            id: "sales-payment-proof-1",
            caption: "ছবি দেওয়ার ঘর ও ছোট করার পরে “Made smaller: … → …” লেখা",
          },
        },
        {
          text: "ছবিটি নিজে থেকেই ছোট হয়, নিচে লেখা থাকে কত ছিল আর কত হলো (যেমন Made smaller: 3.2 MB → 96 KB)। ভুল ছবি হলে পাশের ক্রস চেপে সরিয়ে দিন।",
        },
        {
          text: "পরে ছবি দিতে মানি রিসিটের পাতায় “Proof” অংশে বা চেকের কার্ডে “Add a proof photo” চাপুন, ছবি দিয়ে “Save the photo” চাপুন। আগে ছবি থাকলে বোতামটি “Replace the proof”।",
        },
        {
          text: "ছবি দেখতে ছোট ছবিটিতে চাপুন: বড় করে খুলবে। “Open in a new tab” চাপলে আলাদা ট্যাবে খোলে।",
          image: {
            id: "sales-payment-proof-2",
            caption: "মানি রিসিটের “Proof” অংশে ছোট ছবি ও বড় করে দেখা",
          },
        },
      ],
      tips: [
        "শুধু ছবি (JPG, PNG বা WebP) বা স্ক্রিনশট দেওয়া যায়। PDF হলে তার স্ক্রিনশট নিন।",
        "টাকা রেকর্ড না করে শুধু ছবি তুলে রাখলে তা পরদিন নিজে থেকেই মুছে যায়।",
      ],
    },
  ],
};
