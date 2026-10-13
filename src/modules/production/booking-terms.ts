import type { BookingSource, DocumentLanguage, GarmentCategory } from "@prisma/client";

/*
 * The terms and conditions a new booking starts with, in English or Bengali:
 * strict on quality, the GSM / DIA / width tolerance, shade, the 4-point defect
 * policy and naps or hairy fabric, written for a mill making to our booking
 * (Supplier PO) or for ready stock bought on the open market and checked at the
 * shop (market purchase). Each condition is one line, "Heading: text", so the
 * PDF prints the heading in bold and numbers them. The booking keeps its own
 * copy, which can be changed before it is printed.
 */

type Lang = DocumentLanguage;
type Text = Record<Lang, string>;

const QUALITY: Text = {
  EN: "Quality: Every roll and piece must match the approved sample, swatch or lab dip and the specification on this booking. Anything that does not match is rejected.",
  BN: "মান: প্রতিটি রোল ও পিস অনুমোদিত স্যাম্পল, সোয়াচ বা ল্যাব ডিপ এবং এই বুকিংয়ের স্পেসিফিকেশনের সাথে হুবহু মিলতে হবে। না মিললে মাল বাতিল (রিজেক্ট) করা হবে।",
};

const BOOKING_NUMBER: Text = {
  EN: "Booking number: Quote this booking number on every challan, roll ticket and bill. Goods without it are not received.",
  BN: "বুকিং নম্বর: প্রতিটি চালান, রোল টিকেট ও বিলে এই বুকিং নম্বর লিখতে হবে। নম্বর ছাড়া মাল গ্রহণ করা হবে না।",
};

const QUANTITY: Text = {
  EN: "Quantity: Goods are counted and weighed at our store on arrival, net of tubes, cores and packing, and our count is final. Short quantities are taken off the bill.",
  BN: "পরিমাণ: মাল আমাদের স্টোরে পৌঁছালে গুনে ও ওজন করে নেওয়া হবে (টিউব, কোর ও প্যাকিং বাদে নিট ওজন), আমাদের গণনাই চূড়ান্ত। কম মাল বিল থেকে কেটে রাখা হবে।",
};

const TOLERANCE: Record<"KNIT" | "WOVEN" | "YARN", Text> = {
  KNIT: {
    EN: "GSM and DIA tolerance: GSM within ±5% of the booked GSM and DIA within ±1 inch, checked with a GSM cutter on every lot. Fabric outside the tolerance is rejected.",
    BN: "GSM ও DIA টলারেন্স: বুক করা GSM থেকে ±5% এবং DIA ±1 ইঞ্চির মধ্যে থাকতে হবে, প্রতিটি লটে GSM কাটার দিয়ে মাপা হবে। টলারেন্সের বাইরে হলে কাপড় বাতিল।",
  },
  WOVEN: {
    EN: "Width and weight tolerance: The cuttable width must not be less than the booked width, the weight within ±5%, and the construction (ends and picks) exactly as booked. Fabric outside the tolerance is rejected.",
    BN: "প্রস্থ ও ওজন টলারেন্স: কাটার উপযোগী প্রস্থ (cuttable width) বুক করা প্রস্থের চেয়ে কম হবে না, ওজন ±5% এর মধ্যে, আর কনস্ট্রাকশন (এন্ডস ও পিকস) হুবহু বুকিং অনুযায়ী। টলারেন্সের বাইরে হলে কাপড় বাতিল।",
  },
  YARN: {
    EN: "Yarn tolerance: Yarn count within ±3% of the booked count, even and the same across every lot and cone, for the gauge booked.",
    BN: "সুতার টলারেন্স: ইয়ার্ন কাউন্ট বুক করা কাউন্টের ±3% এর মধ্যে, প্রতিটি লট ও কোনে সমান ও একই রকম, বুক করা গেজের উপযোগী।",
  },
};

const SHADE: Text = {
  EN: "Shade: Shade must match the approved lab dip under D65 light. No shade variation within a roll or between the rolls of a lot (grey scale 4-5), and every lot comes with a shade band. Mixed lots in one delivery are refused.",
  BN: "শেড: D65 আলোতে অনুমোদিত ল্যাব ডিপের সাথে শেড মিলতে হবে। এক রোলের ভেতরে বা এক লটের রোলগুলোর মধ্যে শেডের পার্থক্য চলবে না (গ্রে স্কেল 4-5), প্রতিটি লটের সাথে শেড ব্যান্ড দিতে হবে। এক ডেলিভারিতে মিশ্র লট গ্রহণ করা হবে না।",
};

const SHRINKAGE: Text = {
  EN: "Shrinkage and fastness: Shrinkage within ±5% in length and width after washing; colour fastness to washing, rubbing and light grade 4 or better.",
  BN: "সংকোচন ও রং পাকা: ধোয়ার পর দৈর্ঘ্য ও প্রস্থে সংকোচন ±5% এর মধ্যে; ধোয়া, ঘষা ও আলোতে রং পাকা গ্রেড 4 বা তার বেশি।",
};

const DEFECTS: Record<"FABRIC" | "YARN", Text> = {
  FABRIC: {
    EN: "Defect policy: Fabric is inspected by the 4-point system. A lot averaging more than 20 points per 100 square yards fails and may be rejected in full. Holes, oil or rust spots, needle lines, barre, slubs, dye patches and crease marks all count.",
    BN: "ত্রুটি নীতি: কাপড় 4-পয়েন্ট পদ্ধতিতে পরীক্ষা করা হবে। কোনো লটে প্রতি 100 বর্গগজে গড়ে 20 পয়েন্টের বেশি হলে লট ফেল, পুরো লট বাতিল হতে পারে। ফুটো, তেল বা মরিচার দাগ, নিডল লাইন, ব্যারে, স্লাব, রঙের ছোপ ও ভাঁজের দাগ সবই গোনা হবে।",
  },
  YARN: {
    EN: "Defect policy: Yarn with knots, slubs, uneven twist, contamination or mixed lots is rejected.",
    BN: "ত্রুটি নীতি: গিঁট, স্লাব, অসম পাক, ময়লা মেশানো বা মিশ্র লটের সুতা বাতিল।",
  },
};

const NAPS: Text = {
  EN: "Naps and hairiness: No naps, hairiness, pilling or loose fibre. The goods must be singed or bio-washed where needed and reach pilling grade 3.5 or better. Napped or hairy goods are rejected outright, whatever the quantity.",
  BN: "ন্যাপ ও লোমশ ভাব: কোনো ন্যাপ, লোমশ ভাব (হেয়ারি), পিলিং বা আলগা আঁশ থাকা চলবে না। প্রয়োজনে সিঙ্গিং বা বায়ো-ওয়াশ করতে হবে এবং পিলিং গ্রেড 3.5 বা তার বেশি হতে হবে। ন্যাপ বা লোমশ মাল পরিমাণ যা-ই হোক সরাসরি বাতিল।",
};

const COLLAR: Text = {
  EN: "Collar and cuff: Knitted to the colour and size matrix in this booking, measurements within ±0.5 cm, colours and tipping as approved. Each bundle is tied and tagged with its colour, size group and quantity.",
  BN: "কলার ও কাফ: এই বুকিংয়ের রং ও সাইজ ম্যাট্রিক্স অনুযায়ী বুনতে হবে, মাপ ±0.5 সেমি এর মধ্যে, রং ও টিপিং অনুমোদিত নমুনা অনুযায়ী। প্রতিটি বান্ডেলে রং, সাইজ গ্রুপ ও পরিমাণ লেখা ট্যাগ বেঁধে দিতে হবে।",
};

const REJECTED: Text = {
  EN: "Rejected goods: Rejected goods go back at the supplier's cost and are replaced within 7 days. Production losses caused by late or rejected goods may be charged to the supplier.",
  BN: "বাতিল মাল: বাতিল মাল সরবরাহকারীর খরচে ফেরত যাবে এবং 7 দিনের মধ্যে বদলে দিতে হবে। দেরি বা বাতিল মালের কারণে উৎপাদনের ক্ষতি সরবরাহকারীর কাছ থেকে আদায় করা হতে পারে।",
};

const DELIVERY: Text = {
  EN: "Delivery: Deliver to the delivery place by the date on this booking. Each day late may cost 1% of the late goods' value (at most 10%), and goods more than 7 days late may be refused.",
  BN: "ডেলিভারি: বুকিংয়ে লেখা তারিখের মধ্যে ডেলিভারির স্থানে মাল পৌঁছাতে হবে। প্রতিদিন দেরির জন্য দেরিতে আসা মালের মূল্যের 1% (সর্বোচ্চ 10%) কাটা হতে পারে, আর 7 দিনের বেশি দেরির মাল ফেরত দেওয়া হতে পারে।",
};

const PACKING: Text = {
  EN: "Packing: Every roll is wrapped in polythene with a roll ticket showing the booking number, colour, lot, roll number, weight or length, and GSM or width.",
  BN: "প্যাকিং: প্রতিটি রোল পলিথিনে মোড়ানো থাকবে, সাথে রোল টিকেট: বুকিং নম্বর, রং, লট, রোল নম্বর, ওজন বা দৈর্ঘ্য এবং GSM বা প্রস্থ।",
};

const COMPLIANCE: Text = {
  EN: "Compliance: AZO-free dyes and chemicals, within the buyer's restricted substances list. No child or forced labour.",
  BN: "কমপ্লায়েন্স: AZO-মুক্ত রং ও কেমিক্যাল, বায়ারের নিষিদ্ধ রাসায়নিকের তালিকা মেনে। শিশুশ্রম বা জোরপূর্বক শ্রম চলবে না।",
};

const PAYMENT: Text = {
  EN: "Payment: Paid only on the bill for goods received and passed at our store; nothing is paid on this booking itself.",
  BN: "পেমেন্ট: শুধু আমাদের স্টোরে গৃহীত ও পাস হওয়া মালের বিলের বিপরীতে পেমেন্ট হবে; এই বুকিংয়ের উপর কোনো পেমেন্ট নয়।",
};

const ACCEPTANCE: Text = {
  EN: "Acceptance: Sign and return a copy within 48 hours. Delivering against this booking means its terms are accepted as written.",
  BN: "স্বীকৃতি: 48 ঘণ্টার মধ্যে একটি কপিতে সই করে ফেরত দিন। এই বুকিংয়ের বিপরীতে মাল পাঠানো মানেই এর শর্তগুলো লিখিতভাবে মেনে নেওয়া।",
};

// --- Ready stock on the open market --------------------------------------------------

const READY_STOCK: Text = {
  EN: "Ready stock: Bought from ready stock as seen and checked at the shop: one lot and one shade per colour, no mixed lots.",
  BN: "রেডি স্টক: দোকানে দেখে ও পরীক্ষা করে রেডি স্টক থেকে কেনা: প্রতিটি রঙে এক লট ও এক শেড, মিশ্র লট নয়।",
};

const ORDER_NUMBER: Text = {
  EN: "Order number: Write this order number on the cash memo, challan and bill of every delivery.",
  BN: "অর্ডার নম্বর: প্রতিটি ডেলিভারির ক্যাশ মেমো, চালান ও বিলে এই অর্ডার নম্বর লিখতে হবে।",
};

const SHOP_CHECK: Text = {
  EN: "Inspection at the shop: Our representative checks every roll before it leaves the shop. The seller allows a GSM check with a GSM cutter, weighing every roll and unrolling any roll.",
  BN: "দোকানে পরীক্ষা: দোকান থেকে বের হওয়ার আগে আমাদের প্রতিনিধি প্রতিটি রোল পরীক্ষা করবেন। বিক্রেতা GSM কাটার দিয়ে GSM মাপা, প্রতিটি রোল ওজন করা এবং যেকোনো রোল খুলে দেখতে দেবেন।",
};

const NET_WEIGHT: Text = {
  EN: "Weight: Weighed in front of our representative, with tubes, cores and packing taken off (net weight only).",
  BN: "ওজন: আমাদের প্রতিনিধির সামনে ওজন করা হবে, টিউব, কোর ও প্যাকিং বাদ দিয়ে (শুধু নিট ওজন)।",
};

const OLD_STOCK: Text = {
  EN: "Old stock: No old or faded stock: fold marks, faded edges, dust, damp or a musty smell mean the roll is refused.",
  BN: "পুরনো স্টক: পুরনো বা রং-জ্বলা স্টক চলবে না: ভাঁজের দাগ, কিনারায় রং ফিকে, ধুলা, স্যাঁতসেঁতে ভাব বা গন্ধ থাকলে রোল বাতিল।",
};

const MARKET_DEFECTS: Text = {
  EN: "Defects: Rolls with holes, oil spots, needle lines or patches are replaced by the seller at no cost.",
  BN: "ত্রুটি: ফুটো, তেলের দাগ, নিডল লাইন বা ছোপওয়ালা রোল বিক্রেতা বিনা খরচে বদলে দেবেন।",
};

const SHORTAGE: Text = {
  EN: "Shortage and faults: A shortage or fault found at our store within 3 days of delivery is replaced or refunded by the seller.",
  BN: "ঘাটতি ও ত্রুটি: ডেলিভারির 3 দিনের মধ্যে আমাদের স্টোরে কোনো ঘাটতি বা ত্রুটি পাওয়া গেলে বিক্রেতা মাল বদলে দেবেন বা টাকা ফেরত দেবেন।",
};

const MARKET_DELIVERY: Text = {
  EN: "Delivery: To our store by the agreed date; transport is at the seller's cost unless agreed otherwise in writing.",
  BN: "ডেলিভারি: নির্ধারিত তারিখের মধ্যে আমাদের স্টোরে; লিখিতভাবে অন্য কিছু ঠিক না হলে পরিবহন খরচ বিক্রেতার।",
};

const MARKET_PAYMENT: Text = {
  EN: "Payment: Only for goods received and passed at our store, against the seller's bill.",
  BN: "পেমেন্ট: শুধু আমাদের স্টোরে গৃহীত ও পাস হওয়া মালের জন্য, বিক্রেতার বিলের বিপরীতে।",
};

const toleranceFor = (category: GarmentCategory) =>
  category === "KNITWEAR"
    ? TOLERANCE.KNIT
    : category === "SWEATER"
      ? TOLERANCE.YARN
      : TOLERANCE.WOVEN;

/**
 * The standard terms for a booking, one "Heading: text" condition per line:
 * a mill's booking or a market purchase, with the tolerance of the garment
 * family and, when collars and cuffs are booked by matrix, their own clause.
 */
export function standardTerms(
  source: BookingSource,
  category: GarmentCategory,
  language: DocumentLanguage,
  options: { collar?: boolean } = {},
): string[] {
  const yarn = category === "SWEATER";
  const clauses: Text[] =
    source === "SUPPLIER_PO"
      ? [
          QUALITY,
          BOOKING_NUMBER,
          QUANTITY,
          toleranceFor(category),
          SHADE,
          SHRINKAGE,
          yarn ? DEFECTS.YARN : DEFECTS.FABRIC,
          NAPS,
          ...(options.collar ? [COLLAR] : []),
          REJECTED,
          DELIVERY,
          PACKING,
          COMPLIANCE,
          PAYMENT,
          ACCEPTANCE,
        ]
      : [
          READY_STOCK,
          ORDER_NUMBER,
          SHOP_CHECK,
          toleranceFor(category),
          NET_WEIGHT,
          NAPS,
          OLD_STOCK,
          yarn ? DEFECTS.YARN : MARKET_DEFECTS,
          ...(options.collar ? [COLLAR] : []),
          SHORTAGE,
          MARKET_DELIVERY,
          MARKET_PAYMENT,
        ];
  return clauses.map((c) => c[language]);
}

/** The terms as a booking keeps them: one condition per line. */
export const standardTermsText = (...args: Parameters<typeof standardTerms>) =>
  standardTerms(...args).join("\n");

/** A printed condition: its heading (before the first colon) and its text. */
export function splitTerm(line: string): { heading: string | null; text: string } {
  const match = /^([^:：]{2,48})[:：]\s+(.+)$/.exec(line.trim());
  return match
    ? { heading: match[1]!.trim(), text: match[2]!.trim() }
    : { heading: null, text: line.trim() };
}

/** The terms' lines, without empty ones. */
export const termLines = (terms: string) =>
  terms
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
