/*
 * The restore guide (G6): every step to bring the whole ERP back on a new
 * server, for someone who has never used a server, in Bengali with an English
 * copy. One action per step. The PDF (restore-guide-pdf.ts) draws a picture for
 * most steps; the Help Center shows the same steps ("backups-new-server").
 *
 * Words in “curly quotes” are what the person sees on the screen (Azure,
 * PuTTY, the restore command, the ERP) and are printed in bold. Every
 * question the restore command asks and every error code it can print (R01,
 * W01...) is listed here: tests/unit/restore-guide.test.ts reads
 * deploy/bootstrap.sh and deploy/restore-tool.py and fails when one is missing.
 *
 * Pure data: no secrets, no server code (the Help Center imports it).
 */

export type GuideLang = "bn" | "en";
export type Text = Record<GuideLang, string>;

/** The pictures restore-guide-pdf.ts draws (illustrations, labelled as such). */
export type GuidePicture =
  | "azure-signin"
  | "azure-create"
  | "azure-vm-tile"
  | "azure-group"
  | "azure-name-region"
  | "azure-image"
  | "azure-size"
  | "azure-admin"
  | "azure-ports"
  | "azure-disk"
  | "azure-review"
  | "azure-done"
  | "azure-ip"
  | "putty-download"
  | "putty-open"
  | "putty-config"
  | "putty-alert"
  | "putty-login"
  | "putty-password"
  | "pdf-copy"
  | "putty-paste"
  | "putty-sudo"
  | "putty-client"
  | "phone-code"
  | "phone-account"
  | "phone-allow"
  | "putty-pick"
  | "putty-key"
  | "putty-dns"
  | "putty-wait"
  | "putty-done"
  | "browser-erp"
  | "erp-backups"
  | "cloudflare-dns";

export type GuideStep = {
  /** "A1": the part's letter and the step's number; the scripts name steps by it. */
  id: string;
  title: Text;
  /** One action. */
  text: Text;
  picture?: GuidePicture;
  /** What to watch for at this step. */
  tip?: Text;
  /** Show the one command here. */
  command?: boolean;
  /** Show "Your restore details" here. */
  details?: boolean;
};

export type GuidePart = { id: string; title: Text; intro: Text; steps: GuideStep[] };

/** The questions the restore command asks, exactly as printed, and what to answer. */
export type GuideQuestion = { prompt: string; answer: Text };

/** An error or note the restore command prints (its code), and what to do. */
export type GuideError = { code: string; shown: string; meaning: Text; todo: Text };

/** A message from something else (PuTTY, curl, Google, the browser), and what to do. */
export type OtherMessage = { shown: string; where: Text; todo: Text };

export const GUIDE_TITLE: Text = {
  bn: "Extas ERP: নতুন সার্ভারে সব ফেরত আনার গাইড",
  en: "Extas ERP: bring everything back on a new server",
};

export const GUIDE_INTRO: Text = {
  bn: "সার্ভার হারিয়ে গেলেও আপনার সব তথ্য Google Drive-এর ব্যাকআপে নিরাপদ আছে। এই গাইডের ধাপগুলো একটার পর একটা করলে নতুন সার্ভারে পুরো ERP আগের মতো ফিরে আসবে: সব রেকর্ড, সব ফাইল, সব সেটিং। প্রতিটি ধাপে একটাই কাজ। আগে কখনো সার্ভার না চালালেও চলবে; শুধু মাউস দিয়ে ক্লিক করা, কপি করা আর পেস্ট করা জানলেই হবে।",
  en: "Even if the server is gone, all your data is safe in the backups in Google Drive. Follow the steps in this guide one after another and the whole ERP comes back on a new server as it was: every record, every file, every setting. Each step is one action. You do not need to have used a server before: clicking, copying and pasting with the mouse is enough.",
};

export const GUIDE_NEEDS: Text[] = [
  {
    bn: "একটি কম্পিউটার (Windows), ইন্টারনেট সংযোগসহ।",
    en: "A computer (Windows) with internet.",
  },
  {
    bn: "আপনার ফোন, যাতে সেই Google অ্যাকাউন্ট আছে যেখানে ব্যাকআপ রাখা হয়।",
    en: "Your phone, with the Google account that keeps the backups.",
  },
  {
    bn: "Microsoft Azure অ্যাকাউন্ট (portal.azure.com), যেখানে নতুন সার্ভার বানাবেন।",
    en: "A Microsoft Azure account (portal.azure.com), where you make the new server.",
  },
  {
    bn: "এই গাইডের সেই কপি যেখানে “Your restore details” ঘর পূরণ করা আছে: Google Drive-এর “Extas ERP Backups” ফোল্ডারে থাকে।",
    en: "The copy of this guide with “Your restore details” filled in: it is in the “Extas ERP Backups” folder in Google Drive.",
  },
  {
    bn: "প্রায় 1 ঘণ্টা সময়। বেশিরভাগ সময় শুধু অপেক্ষা।",
    en: "About 1 hour. Most of it is waiting.",
  },
];

export const GUIDE_RULES: Text[] = [
  {
    bn: "ধাপগুলো ক্রম অনুযায়ী করুন, কোনোটা বাদ দেবেন না।",
    en: "Do the steps in order; do not skip one.",
  },
  {
    bn: "কোথাও আটকে গেলে স্ক্রিনে “Error R12” বা “Note W03” ধরনের কোড খুঁজুন, তারপর গাইডের শেষে ভুলের তালিকায় সেই কোডটি দেখুন।",
    en: "If you get stuck, look for a code like “Error R12” or “Note W03” on the screen, then find that code in the list of errors at the end of this guide.",
  },
  {
    bn: "কমান্ড আবার চালালে কোনো ক্ষতি হয় না: যেখানে থেমেছিল সেখান থেকে নিরাপদে আবার শুরু করে।",
    en: "Running the command again does no harm: it safely starts over from where it stopped.",
  },
];

export const DETAILS_TEXT = {
  title: { bn: "আপনার রিস্টোরের তথ্য", en: "Your restore details" } satisfies Text,
  intro: {
    bn: "রিস্টোরের সময় এগুলো লাগবে। এগুলো গোপন রাখুন: এই গাইড শুধু আপনার Google Drive-এ রাখুন, কাউকে পাঠাবেন না।",
    en: "The restore asks for these. Keep them private: keep this guide in your own Google Drive and send it to no one.",
  } satisfies Text,
  domain: { bn: "ERP-এর ওয়েব ঠিকানা", en: "The ERP's web address" } satisfies Text,
  clientId: { bn: "Google client ID", en: "Google client ID" } satisfies Text,
  clientSecret: { bn: "Google client secret", en: "Google client secret" } satisfies Text,
  recoveryKey: { bn: "রিকভারি কী", en: "Recovery key" } satisfies Text,
  keyKept: {
    bn: "Google Drive-এ রাখা আছে: রিস্টোর নিজেই পূরণ করে নেবে, টাইপ করতে হবে না।",
    en: "Kept in Google Drive: the restore fills it in by itself; you do not type it.",
  } satisfies Text,
  keyNotKept: {
    bn: "এখানে লেখা নেই। এটি সেই কী যা আপনি নিজে Backups পাতায় ঠিক করেছিলেন; রিস্টোর জিজ্ঞেস করলে টাইপ করবেন।",
    en: "Not written here. It is the key you set yourself on the Backups screen; type it when the restore asks.",
  } satisfies Text,
  empty: {
    bn: "এই কপিতে আপনার তথ্য নেই। Google Drive-এর “Extas ERP Backups” ফোল্ডার থেকে “Extas ERP restore guide (Bangla).pdf” খুলুন: সেই কপিতে সব পূরণ করা থাকে। ERP চালু থাকলে Settings > Backups পাতার “Download the restore guide” থেকেও নামানো যায়।",
    en: "This copy has no details. Open “Extas ERP restore guide (English).pdf” in the “Extas ERP Backups” folder in Google Drive: that copy has them filled in. While the ERP runs, “Download the restore guide” on Settings > Backups gives it too.",
  } satisfies Text,
  missing: { bn: "জানা নেই", en: "not known" } satisfies Text,
  commandTitle: { bn: "এক লাইনের কমান্ড", en: "The one command" } satisfies Text,
  commandNote: {
    bn: "কমান্ডটি রিস্টোর স্ক্রিপ্টটি নামিয়ে তার চেকসাম (SHA-256) মিলিয়ে দেখে, তারপর চালায়। স্ক্রিপ্টে কোনো পাসওয়ার্ড বা কী নেই।",
    en: "The command downloads the restore script, checks its checksum (SHA-256) and then runs it. The script holds no password and no key.",
  } satisfies Text,
  commandMissing: {
    bn: "সার্ভার একবার আপডেট হলে কমান্ডটি এখানে আসে। তার আগে Google Drive-এর গাইডের কপিটি দেখুন।",
    en: "The command appears here once the server has been updated. Until then, see the copy of this guide in Google Drive.",
  } satisfies Text,
  checksum: { bn: "স্ক্রিপ্টের চেকসাম", en: "The script's checksum" } satisfies Text,
  version: { bn: "সংস্করণ (commit)", en: "Version (commit)" } satisfies Text,
};

/** The PDF's own headings and labels. */
export const GUIDE_WORDS = {
  guideName: { bn: "রিস্টোর গাইড", en: "Restore guide" },
  needs: { bn: "যা লাগবে", en: "What you need" },
  rules: { bn: "শুরু করার আগে", en: "Before you start" },
  glance: { bn: "ধাপগুলো এক নজরে", en: "The steps at a glance" },
  stepsCount: { bn: "টি ধাপ", en: " steps" },
  tip: { bn: "খেয়াল রাখুন", en: "Good to know" },
  picture: {
    bn: "ছবি (আঁকা নমুনা): আপনার স্ক্রিন সামান্য অন্যরকম দেখাতে পারে।",
    en: "Picture (a drawing): your screen may look a little different.",
  },
  questions: { bn: "কমান্ড যে প্রশ্নগুলো করে", en: "The questions the command asks" },
  questionsIntro: {
    bn: "স্ক্রিনে যেভাবে লেখা আসে, আর তখন কী করবেন।",
    en: "As they show on the screen, and what to do then.",
  },
  errors: {
    bn: "কিছু ভুল হলে: ভুল ও নোটের তালিকা",
    en: "If something goes wrong: errors and notes",
  },
  errorsIntro: {
    bn: "স্ক্রিনে Error R12 বা Note W03 ধরনের লেখা এলে নিচে সেই কোডটি খুঁজুন। Error মানে কমান্ড থেমে গেছে: যা করবেন তা করে কমান্ড আবার চালান, কোনো ক্ষতি হয় না। Note মানে কাজ চলছে, শুধু জানিয়ে রাখা।",
    en: "When the screen shows something like Error R12 or Note W03, find that code below. Error means the command stopped: do what it says, then run the command again; that does no harm. Note means the work goes on; it only tells you something.",
  },
  meaning: { bn: "মানে", en: "What it means" },
  todo: { bn: "যা করবেন", en: "What to do" },
  others: { bn: "অন্য জায়গার বার্তা", en: "Messages from elsewhere" },
  othersIntro: {
    bn: "PuTTY, ব্রাউজার বা ফোনে এগুলো এলে।",
    en: "When PuTTY, the browser or the phone shows one of these.",
  },
  where: { bn: "কোথায়", en: "Where" },
  page: { bn: "পাতা", en: "Page" },
  made: { bn: "তৈরি", en: "Made" },
  otherCopy: {
    bn: "এই গাইডের একটি ইংরেজি কপিও আছে (Extas ERP restore guide (English).pdf)।",
    en: "This guide also comes in Bangla (Extas ERP restore guide (Bangla).pdf).",
  },
  keyPrinted: {
    bn: "রিস্টোর এটি Google Drive থেকে নিজেই পড়ে নেয়। কোনো কারণে জিজ্ঞেস করলে ঠিক এভাবেই টাইপ করুন।",
    en: "The restore reads it from Google Drive by itself. If it ever asks, type it exactly like this.",
  },
  keyOdd: {
    bn: "আপনার কী-তে এমন অক্ষর বা ফাঁকা জায়গা আছে যা এই PDF ঠিকমতো দেখাতে পারে না; রিস্টোর Google Drive থেকে কী-টি নিজেই পড়ে নেয়।",
    en: "Your key has letters or spaces this PDF cannot show exactly; the restore reads the key from Google Drive by itself.",
  },
  keep2Step: {
    bn: "এই গাইডে আপনার রিকভারি কী আছে: ওই Google অ্যাকাউন্টে 2-Step Verification সবসময় চালু রাখুন।",
    en: "This guide holds your recovery key: keep 2-Step Verification on for that Google account.",
  },
} satisfies Record<string, Text>;

export const GUIDE_PARTS: GuidePart[] = [
  {
    id: "A",
    title: { bn: "A. Azure-এ নতুন সার্ভার বানানো", en: "A. Make the new server in Azure" },
    intro: {
      bn: "নতুন সার্ভার হলো Azure-এর একটি Virtual machine (VM)। প্রায় 10 মিনিট লাগে।",
      en: "The new server is a Virtual machine (VM) in Azure. It takes about 10 minutes.",
    },
    steps: [
      {
        id: "A1",
        title: { bn: "Azure-এ সাইন ইন", en: "Sign in to Azure" },
        text: {
          bn: "কম্পিউটারের ব্রাউজারে portal.azure.com খুলুন এবং আপনার Azure অ্যাকাউন্ট দিয়ে সাইন ইন করুন।",
          en: "On your computer, open portal.azure.com in the browser and sign in with your Azure account.",
        },
        picture: "azure-signin",
      },
      {
        id: "A2",
        title: { bn: "নতুন কিছু বানানো শুরু", en: "Start making something new" },
        text: {
          bn: "উপরের দিকে “Create a resource” চাপুন।",
          en: "Near the top, click “Create a resource”.",
        },
        picture: "azure-create",
      },
      {
        id: "A3",
        title: { bn: "Virtual machine বেছে নেওয়া", en: "Choose Virtual machine" },
        text: {
          bn: "“Virtual machine” ঘরের নিচে “Create” চাপুন।",
          en: "Under “Virtual machine”, click “Create”.",
        },
        picture: "azure-vm-tile",
        tip: {
          bn: "“Virtual machine” না দেখলে উপরের খোঁজার ঘরে Virtual machine লিখে খুঁজুন।",
          en: "If you do not see “Virtual machine”, type Virtual machine in the search box at the top.",
        },
      },
      {
        id: "A4",
        title: { bn: "Resource group বানানো", en: "Make a resource group" },
        text: {
          bn: "“Resource group”-এর নিচে “Create new” চাপুন, নাম লিখুন extas-erp, তারপর “OK” চাপুন।",
          en: "Under “Resource group”, click “Create new”, type the name extas-erp, then click “OK”.",
        },
        picture: "azure-group",
      },
      {
        id: "A5",
        title: { bn: "সার্ভারের নাম ও জায়গা", en: "The server's name and region" },
        text: {
          bn: "“Virtual machine name” ঘরে লিখুন extas-erp। “Region”-এ বেছে নিন “(Asia Pacific) Central India” (বাংলাদেশের কাছে)।",
          en: "In “Virtual machine name”, type extas-erp. In “Region”, choose “(Asia Pacific) Central India” (close to Bangladesh).",
        },
        picture: "azure-name-region",
      },
      {
        id: "A6",
        title: { bn: "Ubuntu 24.04 বেছে নেওয়া", en: "Choose Ubuntu 24.04" },
        text: {
          bn: "“Image” ঘরে বেছে নিন “Ubuntu Server 24.04 LTS - x64 Gen2”।",
          en: "In “Image”, choose “Ubuntu Server 24.04 LTS - x64 Gen2”.",
        },
        picture: "azure-image",
        tip: {
          bn: "অন্য কোনো Image বেছে নিলে রিস্টোর শুরুতেই থেমে যাবে (R02)।",
          en: "With any other image the restore stops at once (R02).",
        },
      },
      {
        id: "A7",
        title: { bn: "সার্ভারের আকার", en: "The server's size" },
        text: {
          bn: "“Size”-এর পাশে “See all sizes” চাপুন, B2s খুঁজে “Standard_B2s” (2 vcpus, 4 GiB memory) বেছে নিন, তারপর “Select” চাপুন। বড় আকারও চলবে, ছোট নয়।",
          en: "Next to “Size”, click “See all sizes”, search B2s, pick “Standard_B2s” (2 vcpus, 4 GiB memory), then click “Select”. A larger size works too; a smaller one does not.",
        },
        picture: "azure-size",
      },
      {
        id: "A8",
        title: { bn: "সার্ভারে ঢোকার নাম ও পাসওয়ার্ড", en: "The server's user name and password" },
        text: {
          bn: "“Authentication type”-এ বেছে নিন “Password”। “Username”-এ লিখুন erpadmin। “Password” ও “Confirm password”-এ একটি শক্ত পাসওয়ার্ড দিন এবং কাগজে লিখে রাখুন: PuTTY-তে এটি লাগবে।",
          en: "In “Authentication type”, choose “Password”. In “Username”, type erpadmin. Give a strong password in “Password” and “Confirm password”, and write it on paper: PuTTY asks for it.",
        },
        picture: "azure-admin",
      },
      {
        id: "A9",
        title: { bn: "দরজা খোলা: SSH, HTTP, HTTPS", en: "Open the doors: SSH, HTTP, HTTPS" },
        text: {
          bn: "“Public inbound ports”-এ “Allow selected ports” বেছে নিন। “Select inbound ports”-এ তিনটিতেই টিক দিন: “SSH (22)”, “HTTP (80)” ও “HTTPS (443)”।",
          en: "In “Public inbound ports”, choose “Allow selected ports”. In “Select inbound ports”, tick all three: “SSH (22)”, “HTTP (80)” and “HTTPS (443)”.",
        },
        picture: "azure-ports",
        tip: {
          bn: "SSH না খুললে PuTTY ঢুকতে পারবে না; HTTP ও HTTPS না খুললে ওয়েব ঠিকানা খুলবে না।",
          en: "Without SSH, PuTTY cannot get in; without HTTP and HTTPS, the web address does not open.",
        },
      },
      {
        id: "A10",
        title: { bn: "ডিস্ক 64 GB", en: "A 64 GB disk" },
        text: {
          bn: "নিচে “Next : Disks >” চাপুন। “OS disk size”-এ বেছে নিন “64 GiB”, “OS disk type”-এ “Standard SSD”।",
          en: "At the bottom, click “Next : Disks >”. In “OS disk size”, choose “64 GiB”; in “OS disk type”, “Standard SSD”.",
        },
        picture: "azure-disk",
      },
      {
        id: "A11",
        title: { bn: "সার্ভার বানানো", en: "Make the server" },
        text: {
          bn: "নিচে “Review + create” চাপুন। উপরে “Validation passed” এলে “Create” চাপুন।",
          en: "At the bottom, click “Review + create”. When “Validation passed” shows at the top, click “Create”.",
        },
        picture: "azure-review",
      },
      {
        id: "A12",
        title: { bn: "তৈরি হওয়ার অপেক্ষা", en: "Wait until it is made" },
        text: {
          bn: "2 থেকে 5 মিনিট অপেক্ষা করুন। “Your deployment is complete” এলে “Go to resource” চাপুন।",
          en: "Wait 2 to 5 minutes. When “Your deployment is complete” shows, click “Go to resource”.",
        },
        picture: "azure-done",
      },
      {
        id: "A13",
        title: { bn: "সার্ভারের IP ঠিকানা কপি", en: "Copy the server's IP address" },
        text: {
          bn: "“Public IP address”-এর পাশের কপি চিহ্নে ক্লিক করুন। এই নম্বরটি (যেমন 20.193.10.25) কাগজেও লিখে রাখুন।",
          en: "Click the copy sign next to “Public IP address”. Write this number (like 20.193.10.25) on paper too.",
        },
        picture: "azure-ip",
      },
    ],
  },
  {
    id: "B",
    title: { bn: "B. PuTTY দিয়ে সার্ভারে ঢোকা", en: "B. Sign in to the server with PuTTY" },
    intro: {
      bn: "PuTTY হলো একটি ছোট প্রোগ্রাম, যা দিয়ে কম্পিউটার থেকে সার্ভারে কমান্ড দেওয়া যায়।",
      en: "PuTTY is a small program for giving the server commands from your computer.",
    },
    steps: [
      {
        id: "B1",
        title: { bn: "PuTTY নামানো ও ইনস্টল", en: "Download and install PuTTY" },
        text: {
          bn: "ব্রাউজারে putty.org খুলুন, “Download PuTTY” চাপুন, “64-bit x86” লাইনের .msi ফাইলটি নামান, খুলুন এবং “Next”, “Next”, “Install”, “Finish” চাপুন।",
          en: "Open putty.org in the browser, click “Download PuTTY”, download the .msi file on the “64-bit x86” line, open it and click “Next”, “Next”, “Install”, “Finish”.",
        },
        picture: "putty-download",
        tip: {
          bn: "আগে থেকেই PuTTY থাকলে এই ধাপ বাদ দিন।",
          en: "If PuTTY is already installed, skip this step.",
        },
      },
      {
        id: "B2",
        title: { bn: "PuTTY খোলা", en: "Open PuTTY" },
        text: {
          bn: "Windows-এর Start মেনুতে PuTTY লিখে “PuTTY” খুলুন।",
          en: "In the Windows Start menu, type PuTTY and open “PuTTY”.",
        },
        picture: "putty-open",
      },
      {
        id: "B3",
        title: { bn: "সার্ভারের ঠিকানা দেওয়া", en: "Give the server's address" },
        text: {
          bn: "“Host Name (or IP address)” ঘরে A13-এর IP ঠিকানা পেস্ট করুন। “Port” থাকবে 22, “SSH” বাছা থাকবে। তারপর “Open” চাপুন।",
          en: "Paste the IP address from A13 in “Host Name (or IP address)”. “Port” stays 22 and “SSH” stays chosen. Then click “Open”.",
        },
        picture: "putty-config",
      },
      {
        id: "B4",
        title: { bn: "প্রথমবারের সতর্কতা", en: "The first-time alert" },
        text: {
          bn: "“PuTTY Security Alert” এলে “Accept” চাপুন। নতুন সার্ভারে প্রথমবার এটি আসাই স্বাভাবিক।",
          en: "When “PuTTY Security Alert” shows, click “Accept”. It always shows the first time with a new server.",
        },
        picture: "putty-alert",
      },
      {
        id: "B5",
        title: { bn: "নাম দেওয়া", en: "Type the user name" },
        text: {
          bn: "কালো জানালায় “login as:” এলে erpadmin লিখে Enter চাপুন।",
          en: "When the black window shows “login as:”, type erpadmin and press Enter.",
        },
        picture: "putty-login",
      },
      {
        id: "B6",
        title: { bn: "পাসওয়ার্ড দেওয়া", en: "Type the password" },
        text: {
          bn: "“password:” এলে A8-এর পাসওয়ার্ড লিখে Enter চাপুন। লেখার সময় কিছুই দেখা যায় না: এটাই স্বাভাবিক। শেষে erpadmin@extas-erp:~$ দেখা গেলে আপনি সার্ভারে ঢুকে গেছেন।",
          en: "When “password:” shows, type the password from A8 and press Enter. Nothing shows while you type: that is normal. When you see erpadmin@extas-erp:~$ you are in the server.",
        },
        picture: "putty-password",
      },
    ],
  },
  {
    id: "C",
    title: { bn: "C. এক লাইনের কমান্ড চালানো", en: "C. Run the one command" },
    intro: {
      bn: "এই একটি কমান্ডই বাকি সব কাজ করে। কমান্ডটি নিচের ঘরে আছে।",
      en: "This one command does all the rest. It is in the box below.",
    },
    steps: [
      {
        id: "C1",
        title: { bn: "কমান্ড কপি", en: "Copy the command" },
        text: {
          bn: "নিচের ঘরে প্রথম লাইনের c= এর ঠিক আগে ক্লিক করুন, মাউসের বোতাম চেপে ধরে শেষ লাইনের শেষ পর্যন্ত টানুন, ছেড়ে দিন, তারপর Ctrl+C চাপুন।",
          en: "In the box below, click just before c= on the first line, hold the mouse button, drag to the end of the last line, let go, then press Ctrl+C.",
        },
        picture: "pdf-copy",
        command: true,
        tip: {
          bn: "চার লাইনই কপি হতে হবে। লাইনগুলো আলাদা হয়ে গেলেও সমস্যা নেই: প্রতিটি লাইন && দিয়ে শেষ হয়, তাই সার্ভার পরের লাইনের অপেক্ষা করে।",
          en: "All four lines must be copied. It is fine if they come as separate lines: each ends with &&, so the server waits for the next one.",
        },
      },
      {
        id: "C2",
        title: { bn: "PuTTY-তে পেস্ট", en: "Paste in PuTTY" },
        text: {
          bn: "PuTTY-র কালো জানালায় একবার মাউসের ডান বোতাম চাপুন: কমান্ড বসে যাবে। তারপর Enter চাপুন।",
          en: "Right-click once in PuTTY's black window: the command appears. Then press Enter.",
        },
        picture: "putty-paste",
        tip: {
          bn: "PuTTY-তে Ctrl+V কাজ করে না; ডান বোতামই পেস্ট।",
          en: "Ctrl+V does not work in PuTTY; the right-click pastes.",
        },
      },
      {
        id: "C3",
        title: { bn: "আবার পাসওয়ার্ড", en: "The password again" },
        text: {
          bn: "“[sudo] password for erpadmin:” এলে আবার A8-এর পাসওয়ার্ড লিখে Enter চাপুন (কিছু দেখা যাবে না)। এটি না এলে কিছু করতে হবে না।",
          en: "If “[sudo] password for erpadmin:” shows, type the password from A8 again and press Enter (nothing shows). If it does not show, there is nothing to do.",
        },
        picture: "putty-sudo",
        tip: {
          bn: "এর আগে “restore.sh: OK” দেখা যায়: মানে স্ক্রিপ্টটি ঠিকঠাক এসেছে। “FAILED” দেখলে ভুলের তালিকায় restore.sh: FAILED দেখুন।",
          en: "Before it, “restore.sh: OK” shows: the script arrived unchanged. If you see “FAILED”, see restore.sh: FAILED in the list of errors.",
        },
      },
    ],
  },
  {
    id: "D",
    title: { bn: "D. প্রশ্নগুলোর উত্তর", en: "D. Answer the questions" },
    intro: {
      bn: "কমান্ড কয়েকটি প্রশ্ন করবে। গোপন উত্তর পেস্ট বা টাইপ করার সময় কিছু দেখা যায় না: এটাই স্বাভাবিক।",
      en: "The command asks a few questions. Nothing shows while you paste or type a secret answer: that is normal.",
    },
    steps: [
      {
        id: "D1",
        title: { bn: "Google client ID দেওয়া", en: "Give the Google client ID" },
        text: {
          bn: "“Google client ID” প্রশ্ন এলে “Your restore details” থেকে Google client ID কপি করুন (Ctrl+C), PuTTY-তে ডান বোতাম চাপুন, তারপর Enter।",
          en: "When it asks “Google client ID”, copy the Google client ID from “Your restore details” (Ctrl+C), right-click in PuTTY, then press Enter.",
        },
        picture: "putty-client",
        details: true,
        tip: {
          bn: "ঠিকমতো এলে লেখা আসে “Got the client ID”, সঙ্গে কত অক্ষর তা।",
          en: "When it arrives, it says “Got the client ID” and how many characters.",
        },
      },
      {
        id: "D2",
        title: { bn: "Google client secret দেওয়া", en: "Give the Google client secret" },
        text: {
          bn: "“Google client secret” প্রশ্ন এলে একইভাবে Google client secret কপি করে PuTTY-তে ডান বোতাম চাপুন, তারপর Enter।",
          en: "When it asks “Google client secret”, copy the Google client secret the same way, right-click in PuTTY, then press Enter.",
        },
        picture: "putty-client",
      },
      {
        id: "D3",
        title: { bn: "ফোনে কোড দেওয়া", en: "Enter the code on your phone" },
        text: {
          bn: "PuTTY-তে একটি কোড আসবে (যেমন ABCD-EFGH)। ফোনের ব্রাউজারে google.com/device খুলুন, কোডটি লিখুন এবং “Next” চাপুন।",
          en: "PuTTY shows a code (like ABCD-EFGH). On your phone, open google.com/device in the browser, type the code and tap “Next”.",
        },
        picture: "phone-code",
        tip: {
          bn: "কোড 30 মিনিট চলে। দেরি হলে কমান্ড আবার চালান: নতুন কোড আসবে।",
          en: "The code lasts 30 minutes. If it runs out, run the command again: you get a new code.",
        },
      },
      {
        id: "D4",
        title: { bn: "Google অ্যাকাউন্ট বেছে নেওয়া", en: "Choose the Google account" },
        text: {
          bn: "যে Google অ্যাকাউন্টে ব্যাকআপ রাখা হয় সেটি বেছে নিন।",
          en: "Choose the Google account that keeps the backups.",
        },
        picture: "phone-account",
      },
      {
        id: "D5",
        title: { bn: "অনুমতি দেওয়া", en: "Allow it" },
        text: {
          bn: "“Continue” চাপুন, তারপর “Allow” চাপুন। “Google hasn't verified this app” এলে “Continue” চাপুন: অ্যাপটি আপনার নিজের।",
          en: "Tap “Continue”, then “Allow”. If “Google hasn't verified this app” shows, tap “Continue”: the app is your own.",
        },
        picture: "phone-allow",
      },
      {
        id: "D6",
        title: { bn: "কোন ব্যাকআপ", en: "Which backup" },
        text: {
          bn: "PuTTY-তে ব্যাকআপের তালিকা আসবে, সবচেয়ে নতুনটি উপরে, তারিখ ও আকারসহ। সবচেয়ে নতুনটির জন্য শুধু Enter চাপুন।",
          en: "PuTTY lists the backups, newest first, with their date and size. For the newest, just press Enter.",
        },
        picture: "putty-pick",
        tip: {
          bn: "পুরনো একটি চাইলে তার নম্বর লিখে Enter চাপুন।",
          en: "For an older one, type its number and press Enter.",
        },
      },
      {
        id: "D7",
        title: { bn: "রিকভারি কী", en: "The recovery key" },
        text: {
          bn: "কী Google Drive-এ রাখা থাকলে কিছু করতে হয় না: লেখা আসে “Your recovery key is kept in Google Drive”। না থাকলে “Recovery key” প্রশ্নে আপনার কী টাইপ করে Enter চাপুন (কিছু দেখা যাবে না)।",
          en: "If the key is kept in Google Drive there is nothing to do: it says “Your recovery key is kept in Google Drive”. Otherwise type your key at “Recovery key” and press Enter (nothing shows).",
        },
        picture: "putty-key",
      },
      {
        id: "D8",
        title: { bn: "ওয়েব ঠিকানা এই সার্ভারে", en: "The web address to this server" },
        text: {
          bn: "“Point ... to this server” প্রশ্ন এলে Enter চাপুন: ওয়েব ঠিকানা Cloudflare-এ নতুন সার্ভারের দিকে ঘুরে যাবে।",
          en: "When it asks “Point ... to this server”, press Enter: the web address is pointed at the new server in Cloudflare.",
        },
        picture: "putty-dns",
        tip: {
          bn: "Backups পাতায় Cloudflare টোকেন রাখা না থাকলে এই প্রশ্ন আসে না; তখন শেষে F6 ধাপটি করুন।",
          en: "Without a Cloudflare token saved on the Backups screen this question does not come; then do step F6 at the end.",
        },
      },
    ],
  },
  {
    id: "E",
    title: { bn: "E. অপেক্ষা", en: "E. Wait" },
    intro: {
      bn: "বাকি সব কাজ কমান্ড নিজেই করে: দরকারি প্রোগ্রাম বসানো, ব্যাকআপ ফেরত আনা, ERP চালু করা, HTTPS, পরীক্ষা।",
      en: "The command does all the rest by itself: installing what is needed, bringing the backup back, starting the ERP, HTTPS, the checks.",
    },
    steps: [
      {
        id: "E1",
        title: { bn: "চলতে দিন", en: "Let it run" },
        text: {
          bn: "20 থেকে 40 মিনিট অপেক্ষা করুন। “==> Step 9: ...” এমন লাইন একটার পর একটা আসবে। PuTTY বন্ধ করবেন না, কম্পিউটার ঘুমাতে দেবেন না।",
          en: "Wait 20 to 40 minutes. Lines like “==> Step 9: ...” come one after another. Do not close PuTTY and do not let the computer sleep.",
        },
        picture: "putty-wait",
        tip: {
          bn: "সংযোগ কেটে গেলেও রিস্টোর নিজে নিজে চলতে থাকে। B2 থেকে আবার ঢুকে কমান্ডটি আবার পেস্ট করুন: লেখা আসবে “A restore is already running on this server”, আর শেষ না হওয়া পর্যন্ত সেটি দেখাবে। রিস্টোর থেমে গিয়ে থাকলে আবার শুরু হবে; তখন জিজ্ঞেস করতে পারে “Type the web address of the ERP on this server”: আপনার ওয়েব ঠিকানা লিখে Enter চাপুন।",
          en: "If the connection drops, the restore goes on by itself. Sign in again from B2 and paste the command again: it says “A restore is already running on this server” and shows it until it ends. If the restore had stopped, it starts again; it may then ask “Type the web address of the ERP on this server”: type your web address and press Enter.",
        },
      },
      {
        id: "E2",
        title: { bn: "শেষ হওয়া", en: "The end" },
        text: {
          bn: "শেষে লেখা আসবে “All ... records and ... files are back.” আর “The ERP is running at https://...”। কত সময় লেগেছে তাও লেখা থাকে।",
          en: "At the end it says “All ... records and ... files are back.” and “The ERP is running at https://...”, and how long it took.",
        },
        picture: "putty-done",
      },
    ],
  },
  {
    id: "F",
    title: { bn: "F. ERP খুলে দেখা", en: "F. Open the ERP and check it" },
    intro: {
      bn: "এখন দেখে নিন সব আগের মতো আছে কি না।",
      en: "Now check that everything is as before.",
    },
    steps: [
      {
        id: "F1",
        title: { bn: "ERP খোলা", en: "Open the ERP" },
        text: {
          bn: "কম্পিউটারের ব্রাউজারে আপনার ওয়েব ঠিকানা খুলুন (যেমন https://erp.extasbd.com) এবং আগের ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করুন।",
          en: "Open your web address in the browser (like https://erp.extasbd.com) and sign in with the same email and password as before.",
        },
        picture: "browser-erp",
      },
      {
        id: "F2",
        title: { bn: "কয়েকটি জিনিস মিলিয়ে দেখা", en: "Check a few things" },
        text: {
          bn: "Dashboard-এ আজকের সংখ্যা, সবচেয়ে নতুন একটি বুকিং আর তার PDF খুলে দেখুন: হারানোর আগের দিনের কাজ পর্যন্ত সব থাকার কথা।",
          en: "Look at the Dashboard's numbers, open the newest booking and its PDF: everything up to the last backup should be there.",
        },
      },
      {
        id: "F3",
        title: { bn: "প্রথম ব্যাকআপ", en: "The first backup" },
        text: {
          bn: "Settings > Backups খুলে “Back up now” চাপুন। উপরের বড় লাইনে “safe in Google Drive” এলে নতুন সার্ভারও ব্যাকআপ রাখছে।",
          en: "Open Settings > Backups and click “Back up now”. When the big line at the top says “safe in Google Drive”, the new server is backing up too.",
        },
        picture: "erp-backups",
      },
      {
        id: "F4",
        title: {
          bn: "Google Drive আবার যুক্ত করা (যদি বলে)",
          en: "Connect Google Drive again (if it asks)",
        },
        text: {
          bn: "Backups পাতায় “Connect Google Drive” বোতাম দেখালে সেটি চাপুন এবং ফোনে কোড দিন, ঠিক D3 থেকে D5-এর মতো।",
          en: "If the Backups screen shows a “Connect Google Drive” button, click it and enter the code on your phone, as in D3 to D5.",
        },
      },
      {
        id: "F5",
        title: { bn: "GitHub থেকে আপডেট আবার চালু", en: "Let GitHub update the server again" },
        text: {
          bn: "যিনি ERP-এর আপডেট দেখাশোনা করেন তাঁকে বলুন নতুন সার্ভারে sudo ./deploy/setup-auto-deploy.sh চালিয়ে GitHub-এর secrets-এ নতুন IP ও কী বসাতে। এটা না করা পর্যন্ত ERP চলবে, শুধু নতুন আপডেট আসবে না।",
          en: "Ask whoever looks after the ERP's updates to run sudo ./deploy/setup-auto-deploy.sh on the new server and put the new IP and key in GitHub's secrets. Until then the ERP runs; only new updates do not arrive.",
        },
      },
      {
        id: "F6",
        title: {
          bn: "ওয়েব ঠিকানা হাতে বদলানো (শুধু দরকার হলে)",
          en: "Change the web address by hand (only if needed)",
        },
        text: {
          bn: "ওয়েব ঠিকানা না খুললে (W01 বা W03): Cloudflare-এ আপনার ডোমেইন খুলে “DNS” > “Records”-এ erp (আর demo) লাইনের “Edit” চাপুন, “IPv4 address”-এ A13-এর IP দিন, “Save” চাপুন। কয়েক মিনিটে খুলবে।",
          en: "If the web address does not open (W01 or W03): in Cloudflare open your domain, go to “DNS” > “Records”, click “Edit” on the erp (and demo) line, put the IP from A13 in “IPv4 address”, click “Save”. It opens within a few minutes.",
        },
        picture: "cloudflare-dns",
      },
    ],
  },
];

/** Every question the restore command can ask, as printed ("..." stands for what it fills in). */
export const GUIDE_QUESTIONS: GuideQuestion[] = [
  {
    prompt:
      'Google client ID (from "Your restore details"; paste with a right-click, it stays hidden): ',
    answer: {
      bn: "গাইডের “Your restore details” থেকে Google client ID কপি করে ডান বোতামে পেস্ট, তারপর Enter (D1)।",
      en: "Copy the Google client ID from “Your restore details”, right-click to paste, press Enter (D1).",
    },
  },
  {
    prompt:
      'Google client secret (from "Your restore details"; paste with a right-click, it stays hidden): ',
    answer: {
      bn: "একইভাবে Google client secret পেস্ট করে Enter (D2)।",
      en: "Paste the Google client secret the same way and press Enter (D2).",
    },
  },
  {
    prompt: "Which backup? Press Enter for the newest, or type its number: ",
    answer: {
      bn: "সবচেয়ে নতুনটির জন্য শুধু Enter; পুরনোটির জন্য তার নম্বর (D6)।",
      en: "Just Enter for the newest; an older one's number for that one (D6).",
    },
  },
  {
    prompt: "Recovery key (it stays hidden as you type): ",
    answer: {
      bn: "Backups পাতায় যে রিকভারি কী আপনি ঠিক করেছিলেন সেটি টাইপ করে Enter; বড়-ছোট হাতের অক্ষর, ফাঁকা জায়গা ও চিহ্ন ঠিক যেমন ছিল (D7)।",
      en: "Type the recovery key you set on the Backups screen and press Enter, with capitals, spaces and signs exactly as they were (D7).",
    },
  },
  {
    prompt: "Old key card (56 letters and digits, from v6.3; it stays hidden as you type): ",
    answer: {
      bn: "শুধু v6.3-এর পুরনো ব্যাকআপে আসে: পুরনো কী-কার্ডের 56টি অক্ষর ও সংখ্যা টাইপ করুন (ফাঁকা বা ড্যাশ থাকলেও চলবে)।",
      en: "Only for an old v6.3 backup: type the 56 letters and digits from the old key card (spaces or dashes are fine).",
    },
  },
  {
    prompt: "Point ... to this server (...)? Press Enter for yes, or type no: ",
    answer: {
      bn: "“Point erp... to this server?”: Enter চাপলে হ্যাঁ। no লিখলে ওয়েব ঠিকানা বদলায় না; তখন F6 করুন (D8)।",
      en: "“Point erp... to this server?”: Enter means yes. Typing no leaves the web address as it is; then do F6 (D8).",
    },
  },
  {
    prompt:
      "Type the web address of the ERP on this server to replace its data, or press Enter to stop: ",
    answer: {
      bn: "এই সার্ভারে আগে থেকেই Extas ERP আছে (যেমন আগের চেষ্টা মাঝপথে থেমেছিল)। নিশ্চিত হলে আপনার ওয়েব ঠিকানা (যেমন erp.extasbd.com) লিখে Enter; না হলে শুধু Enter: কিছুই বদলাবে না।",
      en: "This server already has Extas ERP (for example, an earlier try stopped half way). If you are sure, type your web address (like erp.extasbd.com) and press Enter; otherwise just Enter: nothing changes.",
    },
  },
  {
    prompt: "Web address for the ERP (for example erp.extasbd.com): ",
    answer: {
      bn: "শুধু খুব পুরনো ব্যাকআপে আসে: ERP-এর ওয়েব ঠিকানা লিখে Enter।",
      en: "Only for a very old backup: type the ERP's web address and press Enter.",
    },
  },
  {
    prompt: "Email for HTTPS certificate notices [...]: ",
    answer: {
      bn: "শুধু পুরনো ব্যাকআপে আসে: বন্ধনীর ইমেইলটিই নিতে Enter চাপুন।",
      en: "Only for an old backup: press Enter to keep the email in brackets.",
    },
  },
];

const fix = (bn: string, en: string): Text => ({ bn, en });

/** Every error (R) and note (W) code the restore command prints. */
export const GUIDE_ERRORS: GuideError[] = [
  {
    code: "R01",
    shown: "run it with sudo",
    meaning: fix("কমান্ডটি sudo ছাড়া চালানো হয়েছে।", "The command ran without sudo."),
    todo: fix(
      "গাইডের পুরো কমান্ডটি আবার কপি করে পেস্ট করুন (C1, C2): তার শেষে sudo আছে।",
      "Copy and paste the whole command from the guide again (C1, C2): it has sudo in it.",
    ),
  },
  {
    code: "R02",
    shown: "this server runs ...",
    meaning: fix(
      "সার্ভারটি Ubuntu নয়, বা খুব পুরনো Ubuntu।",
      "The server is not Ubuntu, or a very old one.",
    ),
    todo: fix(
      "Azure-এ সার্ভারটি মুছে আবার বানান এবং A6 ধাপে “Ubuntu Server 24.04 LTS - x64 Gen2” বেছে নিন।",
      "Delete the VM in Azure and make it again, choosing “Ubuntu Server 24.04 LTS - x64 Gen2” at step A6.",
    ),
  },
  {
    code: "R03",
    shown: "the ERP needs 4 GB / at least 20 GB",
    meaning: fix("সার্ভারের মেমরি বা ডিস্ক খুব ছোট।", "The server's memory or disk is too small."),
    todo: fix(
      "সার্ভারটি আবার বানান: A7 ধাপে “Standard_B2s” বা বড়, A10 ধাপে “64 GiB”।",
      "Make the VM again: “Standard_B2s” or larger at A7, “64 GiB” at A10.",
    ),
  },
  {
    code: "R04",
    shown: "stopped: the web address typed is not the one of the ERP on this server",
    meaning: fix(
      "এই সার্ভারে আগে থেকেই Extas ERP আছে, আর টাইপ করা ওয়েব ঠিকানা মেলেনি। নিরাপত্তার জন্য কিছুই বদলানো হয়নি।",
      "This server already has Extas ERP and the web address typed did not match. For safety nothing was changed.",
    ),
    todo: fix(
      "সত্যিই এই সার্ভারের সব তথ্য ব্যাকআপ দিয়ে বদলাতে চাইলে কমান্ড আবার চালিয়ে ঠিক ওয়েব ঠিকানা লিখুন (স্ক্রিনে “Web address” লাইনে যা দেখায়)।",
      "If you really want this server's data replaced by the backup, run the command again and type the exact web address (the one on the “Web address” line).",
    ),
  },
  {
    code: "R05",
    shown: "the restore tools could not be installed",
    meaning: fix(
      "নতুন সার্ভার প্রথম কয়েক মিনিট নিজের আপডেট বসায়, তখন অন্য কিছু বসানো যায় না।",
      "A new server installs its own updates for its first minutes; nothing else can be installed meanwhile.",
    ),
    todo: fix(
      "5 মিনিট অপেক্ষা করে কমান্ড আবার চালান।",
      "Wait 5 minutes and run the command again.",
    ),
  },
  {
    code: "R06",
    shown: "the restore tool could not be downloaded from GitHub",
    meaning: fix("সার্ভার GitHub-এ পৌঁছাতে পারেনি।", "The server could not reach GitHub."),
    todo: fix(
      "কয়েক মিনিট পরে কমান্ড আবার চালান। বারবার হলে Azure-এ সার্ভারের ইন্টারনেট (Networking) ঠিক আছে কি না দেখুন।",
      "Run the command again in a few minutes. If it keeps happening, check the VM's internet (Networking) in Azure.",
    ),
  },
  {
    code: "R07",
    shown: "the restore tool downloaded is not the expected one",
    meaning: fix(
      "নামানো রিস্টোর টুলের চেকসাম মেলেনি: হয় নামাতে ভুল হয়েছে, নয় কেউ বদলেছে।",
      "The restore tool's checksum did not match: either the download went wrong or someone changed it.",
    ),
    todo: fix(
      "Google Drive-এর সবচেয়ে নতুন গাইড থেকে কমান্ডটি আবার কপি করে চালান। আবার হলে থামুন এবং ডেভেলপারকে জানান।",
      "Copy the command again from the newest guide in Google Drive and run it. If it happens again, stop and tell the developer.",
    ),
  },
  {
    code: "R08",
    shown: "Google did not accept the Google client ID / secret",
    meaning: fix(
      "Google client ID বা secret ভুল পেস্ট হয়েছে।",
      "The Google client ID or secret was pasted wrong.",
    ),
    todo: fix(
      "“Your restore details” থেকে আবার কপি করুন: client ID শেষ হয় .apps.googleusercontent.com দিয়ে। তারপর কমান্ড আবার চালান।",
      "Copy them again from “Your restore details”: the client ID ends in .apps.googleusercontent.com. Then run the command again.",
    ),
  },
  {
    code: "R09",
    shown: "the sign-in was not allowed / the code was not entered on the phone in time",
    meaning: fix(
      "ফোনে অনুমতি দেওয়া হয়নি, বা কোড সময়মতো দেওয়া হয়নি।",
      "The phone did not allow it, or the code was not entered in time.",
    ),
    todo: fix(
      "কমান্ড আবার চালান এবং D3 থেকে D5 ধাপ করুন।",
      "Run the command again and do steps D3 to D5.",
    ),
  },
  {
    code: "R10",
    shown: "there are no Extas ERP backups in this Google account's Drive",
    meaning: fix(
      "এই Google অ্যাকাউন্টে কোনো ব্যাকআপ পাওয়া যায়নি।",
      "No backups were found in this Google account.",
    ),
    todo: fix(
      "কমান্ড আবার চালিয়ে D4 ধাপে সেই অ্যাকাউন্ট বেছে নিন যেখানে ব্যাকআপ যেত। Google client-ও আগেরটাই হতে হবে (“Your restore details”-এর)।",
      "Run the command again and choose the account the backups went to at D4. The Google client must be the same one too (from “Your restore details”).",
    ),
  },
  {
    code: "R11",
    shown: "did not download whole / does not match its checksum / failed in Google Drive",
    meaning: fix(
      "ব্যাকআপের একটি ফাইল পুরো নামেনি বা নষ্ট।",
      "A file of the backup did not download whole, or is damaged.",
    ),
    todo: fix(
      "কমান্ড আবার চালান। আবার হলে D6 ধাপে এর আগের ব্যাকআপটি (নম্বর 2) বেছে নিন।",
      "Run the command again. If it happens again, pick the backup before it (number 2) at D6.",
    ),
  },
  {
    code: "R12",
    shown: "the recovery key does not open this backup",
    meaning: fix("টাইপ করা রিকভারি কী ভুল।", "The recovery key typed is not the right one."),
    todo: fix(
      "বড়-ছোট হাতের অক্ষর, ফাঁকা জায়গা ও চিহ্ন মিলিয়ে কমান্ড আবার চালান। কী বদলে থাকলে, এই ব্যাকআপ যখন বানানো হয়েছিল তখনকার কী লাগবে।",
      "Check capitals, spaces and signs, then run the command again. If you changed the key, this backup needs the key from when it was made.",
    ),
  },
  {
    code: "R13",
    shown: "the old key card does not open this backup",
    meaning: fix(
      "এই ব্যাকআপ v6.3-এর, যা পুরনো কী-কার্ড দিয়ে খোলে; টাইপ করা কী মেলেনি।",
      "This backup is from v6.3 and opens with the old key card; the key typed did not match.",
    ),
    todo: fix(
      "কার্ডের প্রতিটি 4 অক্ষরের দল মিলিয়ে আবার চালান, অথবা D6-এ নতুন (v6.4-এর) একটি ব্যাকআপ বেছে নিন।",
      "Check each group of 4 against the card and run it again, or pick a newer (v6.4) backup at D6.",
    ),
  },
  {
    code: "R14",
    shown: "the keys file for this backup ... is missing",
    meaning: fix(
      "এই ব্যাকআপ খোলার কী-ফাইল পাওয়া যায়নি।",
      "The keys file that opens this backup is missing.",
    ),
    todo: fix("D6 ধাপে আরেকটি নতুন ব্যাকআপ বেছে নিন।", "Pick another, newer backup at D6."),
  },
  {
    code: "R15",
    shown: "the code ... could not be read / downloaded / put in place",
    meaning: fix("ERP-এর কোড বসানো যায়নি।", "The ERP's code could not be put in place."),
    todo: fix(
      "কমান্ড আবার চালান; আবার হলে আরেকটি ব্যাকআপ বেছে নিন।",
      "Run the command again; if it happens again, pick another backup.",
    ),
  },
  {
    code: "R16",
    shown: "the server's settings could not be written",
    meaning: fix(
      "সার্ভারের সেটিং ফাইল লেখা যায়নি।",
      "The server's settings file could not be written.",
    ),
    todo: fix(
      "ওয়েব ঠিকানা ও ইমেইল ঠিকভাবে দিয়ে কমান্ড আবার চালান।",
      "Run the command again, giving the web address and the email correctly.",
    ),
  },
  {
    code: "R17",
    shown: "the server could not be prepared",
    meaning: fix(
      "Docker বা সিস্টেমের আপডেট বসানো যায়নি।",
      "Docker or the system updates could not be installed.",
    ),
    todo: fix("কয়েক মিনিট পরে কমান্ড আবার চালান।", "Run the command again in a few minutes."),
  },
  {
    code: "R18",
    shown: "the ERP could not be installed",
    meaning: fix("ERP বানানো বা চালু করা যায়নি।", "The ERP could not be built or started."),
    todo: fix(
      "কমান্ড আবার চালান: যেখানে থেমেছিল সেখান থেকে চলবে। আবার হলে PuTTY-র শেষ লাইনগুলোর ছবি তুলে ডেভেলপারকে পাঠান।",
      "Run the command again: it picks up where it stopped. If it happens again, take a picture of PuTTY's last lines and send it to the developer.",
    ),
  },
  {
    code: "R19",
    shown: "the backup could not be restored",
    meaning: fix(
      "ডাটাবেস বা ফাইল ফেরত আনা যায়নি। ERP চলছে, কিন্তু ব্যাকআপের তথ্য ছাড়া।",
      "The database or files could not be restored. The ERP runs, but without the backup's data.",
    ),
    todo: fix(
      "কমান্ড আবার চালান (ওয়েব ঠিকানা টাইপ করে নিশ্চিত করতে হবে)। আবার হলে আরেকটি ব্যাকআপ বেছে নিন।",
      "Run the command again (you confirm by typing the web address). If it happens again, pick another backup.",
    ),
  },
  {
    code: "R20",
    shown: "some records or files did not come back",
    meaning: fix(
      "ERP চলছে, কিন্তু ব্যাকআপের তালিকার সঙ্গে কিছু রেকর্ড বা ফাইল মেলেনি; কোনগুলো তা উপরে লেখা।",
      "The ERP runs, but some records or files do not match the backup's list; the ones that differ are listed above.",
    ),
    todo: fix(
      "তালিকার ছবি তুলে রাখুন। আরেকটি ব্যাকআপ দিয়ে কমান্ড আবার চালাতে পারেন, বা ডেভেলপারকে তালিকাটি পাঠান।",
      "Take a picture of the list. You can run the command again with another backup, or send the list to the developer.",
    ),
  },
  {
    code: "R22",
    shown: "the disk is full / too little free space",
    meaning: fix(
      "ব্যাকআপের জন্য ডিস্কে জায়গা নেই।",
      "There is no room on the disk for the backup.",
    ),
    todo: fix(
      "সার্ভারটি বড় ডিস্ক দিয়ে আবার বানান (A10: 64 GiB বা বেশি)।",
      "Make the VM again with a bigger disk (A10: 64 GiB or more).",
    ),
  },
  {
    code: "R23",
    shown: "another restore is already running on this server",
    meaning: fix(
      "এই সার্ভারে আরেকটি রিস্টোর চলছে।",
      "Another restore is running on this server.",
    ),
    todo: fix(
      "সেটি শেষ হতে দিন (40 মিনিট পর্যন্ত), তারপর কমান্ড আবার চালান।",
      "Let it finish (up to 40 minutes), then run the command again.",
    ),
  },
  {
    code: "R24",
    shown: "after restore.sh is not a version",
    meaning: fix(
      "কমান্ডের শেষ অংশ ঠিকমতো কপি হয়নি।",
      "The end of the command was not copied right.",
    ),
    todo: fix("C1 থেকে কমান্ডটি পুরোটা আবার কপি করুন।", "Copy the whole command again from C1."),
  },
  {
    code: "R25",
    shown: "there is no keyboard to answer",
    meaning: fix(
      "কমান্ডটি এমনভাবে চালানো হয়েছে যে প্রশ্নের উত্তর দেওয়া যায় না।",
      "The command was run in a way that cannot answer questions.",
    ),
    todo: fix(
      "PuTTY-র কালো জানালায় কমান্ডটি পেস্ট করে চালান (C2)।",
      "Paste and run the command in PuTTY's black window (C2).",
    ),
  },
  {
    code: "R26",
    shown: "has changes of its own / already has other files in it",
    meaning: fix(
      "সার্ভারের ERP ফোল্ডারে অন্য কিছু আছে, তাই কোড বসানো হয়নি। কিছুই বদলায়নি।",
      "The server's ERP folder has something else in it, so the code was not put there. Nothing was changed.",
    ),
    todo: fix(
      "নতুন একটি সার্ভার বানিয়ে সেখানে রিস্টোর করুন, অথবা ডেভেলপারকে জানান।",
      "Make a fresh VM and restore there, or tell the developer.",
    ),
  },
  {
    code: "R27",
    shown: "this server could not reach ...",
    meaning: fix(
      "সার্ভার ইন্টারনেটে Google বা Cloudflare-এ পৌঁছাতে পারেনি।",
      "The server could not reach Google or Cloudflare.",
    ),
    todo: fix("কয়েক মিনিট পরে কমান্ড আবার চালান।", "Run the command again in a few minutes."),
  },
  {
    code: "R28",
    shown: "the restore tool stopped unexpectedly",
    meaning: fix(
      "রিস্টোর টুলে অপ্রত্যাশিত সমস্যা হয়েছে।",
      "Something unexpected stopped the restore tool.",
    ),
    todo: fix(
      "কমান্ড আবার চালান। আবার হলে লেখাটির ছবি তুলে ডেভেলপারকে পাঠান।",
      "Run the command again. If it happens again, take a picture of the message and send it to the developer.",
    ),
  },
  {
    code: "R29",
    shown: "has Extas ERP data ... but not its program folder and settings",
    meaning: fix(
      "সার্ভারে পুরনো ERP-এর তথ্য আছে কিন্তু তার সেটিং নেই, তাই তার উপরে রিস্টোর নিরাপদ নয়।",
      "The server has old ERP data but not its settings, so restoring over it is not safe.",
    ),
    todo: fix(
      "নতুন একটি সার্ভার বানিয়ে সেখানে রিস্টোর করুন (সবচেয়ে সহজ)।",
      "Make a fresh VM and restore there (the easiest).",
    ),
  },
  {
    code: "W01",
    shown: "the web address was not changed",
    meaning: fix(
      "ওয়েব ঠিকানা নিজে নিজে নতুন সার্ভারে ঘোরানো যায়নি (Cloudflare টোকেন রাখা ছিল না, বা আপনি no বলেছেন)।",
      "The web address could not be pointed at the new server by itself (no Cloudflare token was saved, or you said no).",
    ),
    todo: fix("F6 ধাপটি করুন।", "Do step F6."),
  },
  {
    code: "W02",
    shown: "Cloudflare did not take the change",
    meaning: fix("Cloudflare টোকেন কাজ করেনি।", "The Cloudflare token did not work."),
    todo: fix(
      "F6 ধাপটি করুন। পরে Backups পাতায় নতুন Cloudflare টোকেন রাখুন।",
      "Do step F6. Later, save a new Cloudflare token on the Backups screen.",
    ),
  },
  {
    code: "W03",
    shown: "has no HTTPS certificate yet",
    meaning: fix(
      "ERP চলছে, কিন্তু ওয়েব ঠিকানা এখনো খুলছে না।",
      "The ERP runs, but the web address does not open yet.",
    ),
    todo: fix(
      "10 মিনিট অপেক্ষা করুন। তারপরও না খুললে F6 ধাপ করুন এবং Azure-এ HTTP ও HTTPS খোলা কি না দেখুন (A9)।",
      "Wait 10 minutes. If it still does not open, do step F6 and check that HTTP and HTTPS are open in Azure (A9).",
    ),
  },
  {
    code: "W04",
    shown: "the demo site did not start",
    meaning: fix(
      "ডেমো সাইট চালু হয়নি; আসল ERP ঠিক আছে।",
      "The demo site did not start; the real ERP is fine.",
    ),
    todo: fix(
      "কিছু করতে হবে না: পরের আপডেটে আবার চালু হবে।",
      "Nothing to do: it starts again with the next update.",
    ),
  },
  {
    code: "W05",
    shown: "screen(s) or PDF(s) did not open / Bug Guard found problems",
    meaning: fix(
      "ERP চলছে, কিন্তু পরীক্ষায় কয়েকটি স্ক্রিন বা PDF খোলেনি।",
      "The ERP runs, but a few screens or PDFs did not open in the check.",
    ),
    todo: fix(
      "তালিকাটির ছবি তুলে ডেভেলপারকে পাঠান।",
      "Take a picture of the list and send it to the developer.",
    ),
  },
  {
    code: "W06",
    shown: "HTTPS stays as before",
    meaning: fix(
      "Cloudflare-এর DNS পরীক্ষা দিয়ে HTTPS চালু করা যায়নি, তাই সাধারণ পদ্ধতিতে (পোর্ট 80) চলছে।",
      "HTTPS through Cloudflare's DNS check could not be set up, so it runs the usual way (port 80).",
    ),
    todo: fix(
      "Cloudflare-এ ওয়েব ঠিকানার কমলা মেঘ (Proxy) বন্ধ থাকলে কিছু করতে হবে না। চালু থাকলে এবং ঠিকানা না খুললে কিছুক্ষণের জন্য বন্ধ করুন।",
      "If the orange cloud (Proxy) of the address is off in Cloudflare, nothing to do. If it is on and the address does not open, turn it off for a while.",
    ),
  },
  {
    code: "W08",
    shown: "also has an AAAA (IPv6) record",
    meaning: fix(
      "ওয়েব ঠিকানার একটি IPv6 রেকর্ড পুরনো সার্ভারের দিকে থাকতে পারে।",
      "An IPv6 record of the web address may point at the old server.",
    ),
    todo: fix(
      "Cloudflare-এ “DNS” > “Records”-এ সেই AAAA লাইনটি মুছে দিন।",
      "In Cloudflare, under “DNS” > “Records”, delete that AAAA line.",
    ),
  },
  {
    code: "W09",
    shown: "this backup was not checked in Google Drive",
    meaning: fix(
      "এই ব্যাকআপ Drive-এ রাখার পর মিলিয়ে দেখা হয়নি; এখন প্রতিটি ফাইল আবার মিলানো হচ্ছে।",
      "This backup was not checked after it reached Drive; every file is checked again now.",
    ),
    todo: fix("কিছু করতে হবে না।", "Nothing to do."),
  },
];

/** Messages from PuTTY, curl, sudo, Google and the browser, and what to do. */
export const OTHER_MESSAGES: OtherMessage[] = [
  {
    shown: "Network error: Connection timed out",
    where: fix("PuTTY", "PuTTY"),
    todo: fix(
      "IP ঠিকানা ঠিক আছে কি না দেখুন (A13), আর Azure-এ SSH (22) খোলা কি না (A9)।",
      "Check the IP address (A13) and that SSH (22) is open in Azure (A9).",
    ),
  },
  {
    shown: "Access denied",
    where: fix("PuTTY", "PuTTY"),
    todo: fix(
      "নাম erpadmin আর পাসওয়ার্ড A8-এর মতো হতে হবে। ভুলে গেলে Azure-এ সার্ভারের “Reset password” দিয়ে নতুন দিন।",
      "The name is erpadmin and the password the one from A8. If forgotten, use “Reset password” on the VM in Azure.",
    ),
  },
  {
    shown: "Sorry, try again.",
    where: fix("sudo (PuTTY)", "sudo (PuTTY)"),
    todo: fix(
      "পাসওয়ার্ড ভুল হয়েছে; আবার A8-এর পাসওয়ার্ড টাইপ করুন।",
      "The password was wrong; type the password from A8 again.",
    ),
  },
  {
    shown: "curl: (6) Could not resolve host",
    where: fix("PuTTY, কমান্ডের শুরুতে", "PuTTY, at the start of the command"),
    todo: fix(
      "সার্ভারের ইন্টারনেট এখনো তৈরি নয়; 2 মিনিট পরে আবার চালান।",
      "The VM's internet is not ready yet; run it again in 2 minutes.",
    ),
  },
  {
    shown: "curl: (22) The requested URL returned error: 404",
    where: fix("PuTTY, কমান্ডের শুরুতে", "PuTTY, at the start of the command"),
    todo: fix(
      "কমান্ডটি পুরো কপি হয়নি; C1 থেকে আবার কপি করুন। আবার হলে Google Drive-এর সবচেয়ে নতুন গাইড থেকে কমান্ড নিন।",
      "The command was not copied whole; copy it again from C1. If it happens again, take the command from the newest guide in Google Drive.",
    ),
  },
  {
    shown: "restore.sh: FAILED",
    where: fix(
      "PuTTY, কমান্ডের শুরুতে (sha256sum)",
      "PuTTY, at the start of the command (sha256sum)",
    ),
    todo: fix(
      "নামানো স্ক্রিপ্টের চেকসাম মেলেনি, তাই কিছুই চালানো হয়নি। কমান্ডটি আবার পুরো কপি করে চালান; আবার হলে থামুন এবং ডেভেলপারকে জানান।",
      "The downloaded script's checksum did not match, so nothing ran. Copy the whole command again and run it; if it happens again, stop and tell the developer.",
    ),
  },
  {
    shown: "Access blocked: ... has not completed the Google verification process",
    where: fix("ফোনে, Google", "On the phone, Google"),
    todo: fix(
      "Google Cloud-এ আপনার অ্যাপের “OAuth consent screen”-এ “Test users”-এ এই Google অ্যাকাউন্টটি যোগ করুন, অথবা অ্যাপটি “In production” করুন। তারপর কমান্ড আবার চালান।",
      "In Google Cloud, add this Google account under “Test users” on your app's “OAuth consent screen”, or set the app “In production”. Then run the command again.",
    ),
  },
  {
    shown: "ERR_TOO_MANY_REDIRECTS",
    where: fix("ব্রাউজার", "The browser"),
    todo: fix(
      "Cloudflare-এ আপনার ডোমেইনের “SSL/TLS” পাতায় মোড “Full (strict)” করুন।",
      "In Cloudflare, set the mode to “Full (strict)” on your domain's “SSL/TLS” page.",
    ),
  },
  {
    shown: "This site can't be reached",
    where: fix("ব্রাউজার", "The browser"),
    todo: fix(
      "ওয়েব ঠিকানা এখনো নতুন সার্ভারের দিকে যায়নি: F6 করুন, তারপর 10 মিনিট অপেক্ষা করুন।",
      "The web address does not point at the new server yet: do F6, then wait 10 minutes.",
    ),
  },
];

/** Every step's id, for the scripts' "step A6" and the tests. */
export const GUIDE_STEP_IDS = GUIDE_PARTS.flatMap((part) => part.steps.map((step) => step.id));

/** The words in “curly quotes” of a text: what the person sees on the screen. */
export function quotedLabels(text: string): string[] {
  return [...text.matchAll(/“([^”]+)”/g)].map((m) => m[1]!);
}

/** A version of the guide's words: the guide is built again whenever it changes (G7). */
export function guideContentVersion(): string {
  const text = JSON.stringify([
    GUIDE_TITLE,
    GUIDE_INTRO,
    GUIDE_NEEDS,
    GUIDE_RULES,
    GUIDE_WORDS,
    DETAILS_TEXT,
    GUIDE_PARTS,
    GUIDE_QUESTIONS,
    GUIDE_ERRORS,
    OTHER_MESSAGES,
  ]);
  // FNV-1a, 32 bits: enough to notice a change, and works in the browser too.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
