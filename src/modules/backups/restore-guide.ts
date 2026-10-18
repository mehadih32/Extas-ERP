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

/**
 * The pictures of the steps: a real screenshot when one is in
 * public/restore-guide/<picture>.png, else a drawing (restore-guide-pictures.ts,
 * labelled as one). SCREENSHOT_SLOTS there says what each screenshot shows.
 */
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
  | "puttygen-load"
  | "puttygen-save"
  | "putty-key-file"
  | "putty-config"
  | "putty-alert"
  | "putty-login"
  | "pdf-copy"
  | "putty-paste"
  | "putty-start"
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

/** When nothing comes from GitHub (G17): the steps at the end of the guide. */
const NO_GITHUB: Text = {
  bn: "GitHub থেকে কিছুতেই না নামলে (GitHub বন্ধ, বা রিপোজিটরি আর খোলা নেই): গাইডের শেষে “GitHub না খুললে” অংশের ধাপগুলো করুন।",
  en: "If nothing comes from GitHub (GitHub is down, or the repository is no longer open): do the steps in “If GitHub cannot be reached” near the end of this guide.",
};

/**
 * When GitHub cannot be reached (G17): restore.sh and restore-tool.py from the
 * Drive backup folder, copied to the server with WinSCP (a free program that
 * copies files to a server, like dragging files between two folders), then the
 * command without its download line. The PDF prints that command below these.
 */
export const NO_GITHUB_PART = {
  title: { bn: "GitHub না খুললে", en: "If GitHub cannot be reached" } satisfies Text,
  intro: {
    bn: "শুধু তখনই করুন যখন কমান্ড GitHub থেকে কিছু নামাতে পারে না (R06, বা curl: (6) বা (22) বারবার আসে)। রিস্টোরের দুটি ফাইল Google Drive-এর “Extas ERP Backups” ফোল্ডারেও থাকে; WinSCP নামের একটি বিনা পয়সার প্রোগ্রাম দিয়ে সেগুলো সার্ভারে রাখবেন। WinSCP দেখতে দুই ভাগের জানালা: বাঁ দিকে আপনার কম্পিউটার, ডান দিকে সার্ভার; ফাইল টেনে এক দিক থেকে অন্য দিকে রাখা যায়।",
    en: "Do this only when the command cannot download anything from GitHub (R06, or curl: (6) or (22) again and again). The restore's two files are also in the “Extas ERP Backups” folder in Google Drive; you put them on the server with WinSCP, a free program. WinSCP is a window in two halves: your computer on the left, the server on the right; you drag files from one side to the other.",
  } satisfies Text,
  steps: [
    {
      bn: "কম্পিউটারের ব্রাউজারে drive.google.com খুলুন, “Extas ERP Backups” ফোল্ডারে restore.sh-এ ডান বোতাম চেপে “Download” চাপুন। restore-tool.py-এর জন্যও একই কাজ করুন। দুটি ফাইলই Downloads ফোল্ডারে আসবে।",
      en: "On your computer, open drive.google.com, right-click restore.sh in the “Extas ERP Backups” folder and click “Download”. Do the same for restore-tool.py. Both files go to your Downloads folder.",
    },
    {
      bn: "ব্রাউজারে winscp.net খুলুন, “Download WinSCP” চাপুন, নামানো ফাইলটি খুলুন এবং প্রতিটি পাতায় “Accept”, “Next” আর শেষে “Install” ও “Finish” চাপুন।",
      en: "Open winscp.net in the browser, click “Download WinSCP”, open the downloaded file and click “Accept”, “Next” on each page, then “Install” and “Finish”.",
    },
    {
      bn: "WinSCP খুলুন। “Login” জানালায় “File protocol”-এ SFTP থাকবে; “Host name”-এ A13-এর IP ঠিকানা, “User name”-এ erpadmin লিখুন। “Advanced...” চেপে বাঁ দিকে “SSH” > “Authentication” খুলুন, “Private key file”-এর পাশের “...” চেপে B3-এর extas-erp-key.ppk বেছে নিন, “OK” চাপুন।",
      en: "Open WinSCP. In the “Login” window, “File protocol” stays SFTP; type the IP address from A13 in “Host name” and erpadmin in “User name”. Click “Advanced...”, open “SSH” > “Authentication” on the left, click “...” next to “Private key file”, pick extas-erp-key.ppk from B3 and click “OK”.",
    },
    {
      bn: "“Login” চাপুন। প্রথমবার “Continue connecting to an unknown server...” এলে “Accept” চাপুন।",
      en: "Click “Login”. The first time, when “Continue connecting to an unknown server...” shows, click “Accept”.",
    },
    {
      bn: "বাঁ দিকে আপনার Downloads ফোল্ডার খুলুন। restore.sh আর restore-tool.py টেনে ডান দিকে (সার্ভারের /home/erpadmin) ছেড়ে দিন, “Upload” জানালায় “OK” চাপুন। তারপর WinSCP বন্ধ করুন।",
      en: "On the left, open your Downloads folder. Drag restore.sh and restore-tool.py to the right side (the server's /home/erpadmin) and click “OK” in the “Upload” window. Then close WinSCP.",
    },
    {
      bn: "নিচের ঘরের কমান্ডটি (এতে GitHub থেকে নামানোর লাইন নেই) C1 ও C2-এর মতো কপি করে PuTTY-তে পেস্ট করুন এবং Enter চাপুন। তারপর C3 থেকে গাইড ধরে এগোন।",
      en: "Copy the command in the box below (it has no line that downloads from GitHub) as in C1 and C2, paste it in PuTTY and press Enter. Then go on with the guide from C3.",
    },
  ] satisfies Text[],
  commandMissing: {
    bn: "কমান্ডটি এখানে আসে সার্ভার একবার আপডেট হলে। তার আগে Google Drive-এর গাইডের কপিটি দেখুন।",
    en: "The command appears here once the server has been updated. Until then, see the copy of this guide in Google Drive.",
  } satisfies Text,
};

/**
 * Practice: a restore drill on a small test server (v6.4.1), never touching the
 * real web address. The command ends with --drill: it asks for a test address,
 * points only that one at the test server, and the copy runs in test mode (no
 * emails, bot messages, Google Drive backups or scheduled jobs; the restored
 * copy reads BACKUP_DIR/.drill, src/modules/backups/standby.ts). The PDF prints
 * the drill command below these steps; the Help Center shows them in Bengali.
 */
export const DRILL_PART = {
  title: { bn: "অনুশীলন: রিস্টোরের মহড়া", en: "Practice: a restore drill" } satisfies Text,
  intro: {
    bn: "বছরে অন্তত একবার, আর গাইড বদলালে, একটি ছোট পরীক্ষার সার্ভারে পুরো রিস্টোর একবার করে দেখুন। আসল ERP চলতেই থাকে। মহড়ার কপি টেস্ট মোডে চলে: কোনো ইমেইল বা বটের বার্তা পাঠায় না, Google Drive-এ ব্যাকআপ রাখে না, নিজে থেকে কোনো কাজ চালায় না। আসল ওয়েব ঠিকানার (যেমন erp.extasbd.com) DNS কখনো ছোঁয় না। প্রায় 1 ঘণ্টা লাগে; Azure-এর খরচ সামান্য।",
    en: "At least once a year, and when the guide changes, do the whole restore once on a small test server. The real ERP keeps running. The drill copy runs in test mode: it sends no emails or bot messages, makes no Google Drive backups and runs no jobs by itself. It never touches the DNS of your real web address (like erp.extasbd.com). It takes about 1 hour and costs a little in Azure.",
  } satisfies Text,
  steps: [
    {
      bn: "মহড়ার জন্য আপনার ডোমেইনের ভিতরে একটি নতুন ঠিকানা ঠিক করুন যা কেউ ব্যবহার করে না: যেমন drill.extasbd.com। আসল ERP বা ডেমো সাইটের ঠিকানা কখনো নয়।",
      en: "Pick a new address for the drill inside your domain that nobody uses: like drill.extasbd.com. Never the real ERP's or the demo site's address.",
    },
    {
      bn: "পার্ট A করুন, শুধু এই বদলগুলো: A4-এ Resource group-এর নাম extas-drill, A5-এ সার্ভারের নাম extas-drill, A8-এ “Key pair name” extas-drill-key। আকার “Standard_B2s” আর ডিস্ক “64 GiB”-ই রাখুন, গাইডের সার্ভারের মতো।",
      en: "Do part A with only these changes: at A4 name the resource group extas-drill, at A5 name the VM extas-drill, at A8 make the “Key pair name” extas-drill-key. Keep the size “Standard_B2s” and the disk “64 GiB”, as for the guide's server.",
    },
    {
      bn: "পার্ট B করুন extas-drill-key ফাইল দিয়ে; B5-এ “Saved Sessions”-এ নাম দিন extas-drill।",
      en: "Do part B with the extas-drill-key file; at B5, under “Saved Sessions”, save it as extas-drill.",
    },
    {
      bn: "নিচের ঘরের মহড়ার কমান্ডটি (শেষে --drill আছে) C1 ও C2-এর মতো কপি করে PuTTY-তে পেস্ট করুন এবং Enter চাপুন।",
      en: "Copy the drill command in the box below (it ends with --drill) as in C1 and C2, paste it in PuTTY and press Enter.",
    },
    {
      bn: "“Test web address for this drill” প্রশ্নে ধাপ 1-এর ঠিকানাটি লিখে Enter চাপুন। বাকি প্রশ্নগুলোর উত্তর পার্ট D-র মতো। “To point ... to this server” প্রশ্নে শুধু মহড়ার ঠিকানাটিই আসে: সেটিই লিখে Enter চাপুন। এই প্রশ্ন না এলে (W01) Cloudflare-এ “DNS” > “Records”-এ “Add record” চেপে Type A, Name drill, “IPv4 address”-এ মহড়ার সার্ভারের IP দিয়ে “Save” চাপুন।",
      en: "At “Test web address for this drill”, type the address from step 1 and press Enter. Answer the other questions as in part D. “To point ... to this server” offers only the drill address: type it and press Enter. If that question does not come (W01), in Cloudflare go to “DNS” > “Records”, click “Add record”, choose Type A, Name drill, put the drill server's IP in “IPv4 address” and click “Save”.",
    },
    {
      bn: "অপেক্ষা করুন। শেষে লেখা আসে “Restore drill finished in ...”, সঙ্গে ফল। এটাই মহড়ার সময়।",
      en: "Wait. At the end it says “Restore drill finished in ...” with the result. That is the drill's time.",
    },
    {
      bn: "ব্রাউজারে https://drill.extasbd.com (আপনার মহড়ার ঠিকানা) খুলে আগের ইমেইল ও পাসওয়ার্ড দিয়ে সাইন ইন করুন, আর F2-এর মতো কয়েকটি জিনিস মিলিয়ে দেখুন। Backups পাতার উপরের বড় লাইনে লেখা থাকে “Restore drill copy (test mode)”।",
      en: "Open https://drill.extasbd.com (your drill address) in the browser, sign in with the same email and password, and check a few things as in F2. The big line at the top of the Backups screen says “Restore drill copy (test mode)”.",
    },
    {
      bn: "আসল ERP-তে Settings > Backups খুলে “Record a drill” চাপুন, মহড়ার ঠিকানাটি লিখে “Record” চাপুন। “Last new-server drill” ঘরে তারিখ, কত সময় লেগেছে আর ফল দেখাবে।",
      en: "On your real ERP, open Settings > Backups, click “Record a drill”, type the drill address and click “Record”. “Last new-server drill” shows the date, the time it took and the result.",
    },
    {
      bn: "মহড়া মুছে ফেলুন: Azure-এ শুধু extas-drill Resource group খুলে “Delete resource group” চাপুন (নাম লিখে নিশ্চিত করুন), আর Cloudflare-এ drill লাইনটি মুছুন। আসল সার্ভারের group-এ কখনো হাত দেবেন না। মহড়ায় F5 করবেন না।",
      en: "Remove the drill: in Azure open only the extas-drill resource group and click “Delete resource group” (type its name to confirm), and in Cloudflare delete the drill line. Never touch the real server's group. Do not do F5 in a drill.",
    },
  ] satisfies Text[],
  commandMissing: {
    bn: "মহড়ার কমান্ড এখানে আসে সার্ভার একবার আপডেট হলে।",
    en: "The drill command appears here once the server has been updated.",
  } satisfies Text,
};

/** The one command for a drill: the restore command with --drill at its end. */
export function drillCommandLines(lines: string[] | null): string[] | null {
  if (!lines?.length) return null;
  return [...lines.slice(0, -1), `${lines[lines.length - 1]} --drill`];
}

/** The one command without its line that downloads from GitHub (the copy beside it is used). */
export function noGithubCommandLines(lines: string[] | null): string[] | null {
  return lines ? lines.filter((line) => !line.startsWith("curl ")) : null;
}

/**
 * The overwrite question (bootstrap.sh's A6 decision): when, and only when, to
 * type the web address there. Everywhere the guide speaks of that question it
 * says this, never "type your web address" by itself.
 */
export const REPLACE_RULE: Text = {
  bn: "এখানে ওয়েব ঠিকানা টাইপ করবেন শুধু তখনই যখন তিনটি কথাই সত্যি: এটি সেই নতুন সার্ভার যা আপনি এই রিস্টোরের জন্য পার্ট A-তে বানিয়েছেন (PuTTY খুলেছেন A13-এর IP দিয়ে); এই সার্ভারেই কমান্ড আগে চলেছিল আর মাঝপথে থেমেছে; আর এই সার্ভারের ERP-তে এখনো কেউ কাজ করেনি। তখন “Web address” লাইনে যে ঠিকানা দেখায় ঠিক সেটি লিখে Enter চাপুন। অন্য সব ক্ষেত্রে, বিশেষ করে যে সার্ভারে আপনার ERP রোজ চলে সেখানে, শুধু Enter চাপুন: কিছুই বদলাবে না।",
  en: "Type the web address here only when all three are true: this is the new server you made in part A for this restore (you opened PuTTY with the IP address from A13); the command ran on this same server before and stopped part way; and nobody has worked in the ERP on this server yet. Then type exactly the address on the “Web address” line and press Enter. In every other case, above all on the server your ERP runs on every day, just press Enter: nothing changes.",
};

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
  {
    bn: "অনুশীলনের জন্য (পুরনো ERP চালু রেখে) এই গাইডের শেষের “অনুশীলন: রিস্টোরের মহড়া” অংশটি করুন: তাতে কমান্ড টেস্ট মোডে চলে, আসল ওয়েব ঠিকানায় হাত দেয় না।",
    en: "To practise (with the old ERP still running), follow “Practice: a restore drill” at the end of this guide: the command then runs in test mode and never touches your real web address.",
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
  screenshot: {
    bn: "ছবি (আসল স্ক্রিনের): আপনার স্ক্রিন সামান্য অন্যরকম দেখাতে পারে।",
    en: "Picture (a real screenshot): your screen may look a little different.",
  },
  noGithubCommand: { bn: "GitHub ছাড়া কমান্ড", en: "The command without GitHub" },
  drillCommand: { bn: "মহড়ার কমান্ড", en: "The drill command" },
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
          bn: "“Ubuntu Server 22.04 LTS - x64 Gen2”-ও চলবে। এর চেয়ে পুরনো Ubuntu বা অন্য কোনো Image বেছে নিলে রিস্টোর শুরুতেই থেমে যাবে (R02)।",
          en: "“Ubuntu Server 22.04 LTS - x64 Gen2” works too. With an older Ubuntu, or any image that is not Ubuntu, the restore stops at once (R02).",
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
        title: { bn: "সার্ভারে ঢোকার নাম ও চাবি", en: "The server's user name and key" },
        text: {
          bn: "“Authentication type”-এ “SSH public key” বাছা থাকবে। “Username”-এ লিখুন erpadmin। “SSH public key source”-এ “Generate new key pair” থাকবে; “Key pair name”-এ লিখুন extas-erp-key।",
          en: "“Authentication type” stays “SSH public key”. In “Username”, type erpadmin. “SSH public key source” stays “Generate new key pair”; in “Key pair name”, type extas-erp-key.",
        },
        picture: "azure-admin",
        tip: {
          bn: "চাবি (key) একটি ছোট ফাইল, যা পাসওয়ার্ডের কাজ করে আর পাসওয়ার্ডের চেয়ে নিরাপদ। Azure এটি A11-এ একবারই দেয়। এই চাবি থাকলে পরে F5-এ GitHub থেকে আপডেট আবার আপনি নিজেই চালু করতে পারবেন।",
          en: "The key is a small file that works like a password and is safer than one. Azure gives it to you once, at A11. With it you can also let GitHub update the server again yourself at F5.",
        },
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
          bn: "নিচে “Review + create” চাপুন। উপরে “Validation passed” এলে “Create” চাপুন। “Generate new key pair” জানালা এলে “Download private key and create resource” চাপুন: extas-erp-key.pem ফাইলটি কম্পিউটারের Downloads ফোল্ডারে আসবে।",
          en: "At the bottom, click “Review + create”. When “Validation passed” shows at the top, click “Create”. When the “Generate new key pair” window shows, click “Download private key and create resource”: the file extas-erp-key.pem comes to your computer's Downloads folder.",
        },
        picture: "azure-review",
        tip: {
          bn: "এই ফাইলটি সার্ভারের চাবি, Azure এটি আর কখনো দেয় না: মুছবেন না, কাউকে পাঠাবেন না। হারালে Azure-এ সার্ভারের “Reset password” পাতায় “Reset SSH public key” দিয়ে নতুন চাবি বানানো যায়।",
          en: "This file is the key to the server and Azure never gives it again: do not delete it and send it to no one. If it is lost, “Reset SSH public key” on the VM's “Reset password” page in Azure makes a new one.",
        },
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
      bn: "PuTTY হলো একটি ছোট প্রোগ্রাম, যা দিয়ে কম্পিউটার থেকে সার্ভারে কমান্ড দেওয়া যায়। সঙ্গে আসে PuTTYgen, যা A11-এর চাবির ফাইলটিকে PuTTY-র উপযোগী করে।",
      en: "PuTTY is a small program for giving the server commands from your computer. It comes with PuTTYgen, which turns the key file from A11 into the kind PuTTY uses.",
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
        title: { bn: "চাবির ফাইল PuTTYgen-এ খোলা", en: "Open the key file in PuTTYgen" },
        text: {
          bn: "Windows-এর Start মেনুতে PuTTYgen লিখে “PuTTYgen” খুলুন। “Load” চাপুন। ফাইল বাছার জানালার নিচে ডান দিকে “All Files (*.*)” বেছে নিন, Downloads ফোল্ডারের extas-erp-key.pem বেছে “Open” চাপুন, তারপর “OK”।",
          en: "In the Windows Start menu, type PuTTYgen and open “PuTTYgen”. Click “Load”. At the bottom right of the file window choose “All Files (*.*)”, pick extas-erp-key.pem in your Downloads folder and click “Open”, then “OK”.",
        },
        picture: "puttygen-load",
      },
      {
        id: "B3",
        title: { bn: "PuTTY-র চাবি রাখা", en: "Save PuTTY's key file" },
        text: {
          bn: "“Save private key” চাপুন, প্রশ্ন এলে “Yes”। নাম লিখুন extas-erp-key, “Save” চাপুন। তারপর PuTTYgen বন্ধ করুন।",
          en: "Click “Save private key”, and “Yes” when it asks. Type the name extas-erp-key and click “Save”. Then close PuTTYgen.",
        },
        picture: "puttygen-save",
        tip: {
          bn: "এখন দুটি চাবির ফাইল আছে: extas-erp-key.pem আর extas-erp-key.ppk। দুটিই কম্পিউটারে রাখুন, কাউকে পাঠাবেন না।",
          en: "You now have two key files: extas-erp-key.pem and extas-erp-key.ppk. Keep both on your computer and send them to no one.",
        },
      },
      {
        id: "B4",
        title: { bn: "PuTTY খুলে চাবি দেখানো", en: "Open PuTTY and give it the key" },
        text: {
          bn: "Start মেনুতে PuTTY লিখে “PuTTY” খুলুন। বাঁ দিকে “Connection” > “SSH” > “Auth” > “Credentials” খুলুন, “Private key file for authentication”-এর পাশে “Browse...” চেপে extas-erp-key.ppk বেছে নিন।",
          en: "In the Start menu, type PuTTY and open “PuTTY”. On the left, open “Connection” > “SSH” > “Auth” > “Credentials”, click “Browse...” next to “Private key file for authentication” and pick extas-erp-key.ppk.",
        },
        picture: "putty-key-file",
      },
      {
        id: "B5",
        title: { bn: "সার্ভারের ঠিকানা দেওয়া", en: "Give the server's address" },
        text: {
          bn: "বাঁ দিকে একদম উপরের “Session” চাপুন। “Host Name (or IP address)” ঘরে A13-এর IP ঠিকানা পেস্ট করুন; “Port” থাকবে 22। “Saved Sessions”-এ লিখুন extas-erp, “Save” চাপুন, তারপর “Open”।",
          en: "On the left, click “Session” at the very top. Paste the IP address from A13 in “Host Name (or IP address)”; “Port” stays 22. Under “Saved Sessions” type extas-erp, click “Save”, then click “Open”.",
        },
        picture: "putty-config",
        tip: {
          bn: "পরে আবার ঢুকতে: PuTTY খুলে “Saved Sessions”-এ extas-erp-এ দুবার ক্লিক করুন, তারপর B7-এর মতো নাম দিন।",
          en: "To sign in again later: open PuTTY, double-click extas-erp under “Saved Sessions”, then type the user name as in B7.",
        },
      },
      {
        id: "B6",
        title: { bn: "প্রথমবারের সতর্কতা", en: "The first-time alert" },
        text: {
          bn: "“PuTTY Security Alert” এলে “Accept” চাপুন। নতুন সার্ভারে প্রথমবার এটি আসাই স্বাভাবিক।",
          en: "When “PuTTY Security Alert” shows, click “Accept”. It always shows the first time with a new server.",
        },
        picture: "putty-alert",
      },
      {
        id: "B7",
        title: { bn: "নাম দেওয়া", en: "Type the user name" },
        text: {
          bn: "কালো জানালায় “login as:” এলে erpadmin লিখে Enter চাপুন। PuTTY চাবি দিয়ে নিজেই ঢুকে যায়, পাসওয়ার্ড লাগে না। erpadmin@extas-erp:~$ দেখা গেলে আপনি সার্ভারে ঢুকে গেছেন।",
          en: "When the black window shows “login as:”, type erpadmin and press Enter. PuTTY signs in with the key by itself; no password is needed. When you see erpadmin@extas-erp:~$ you are in the server.",
        },
        picture: "putty-login",
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
        title: { bn: "শুরুটা দেখে নেওয়া", en: "Check that it started" },
        text: {
          bn: "প্রথমে “restore.sh: OK” আসে: স্ক্রিপ্টটি ঠিকঠাক এসেছে। তারপর “==> Extas ERP: bringing the ERP back from a Google Drive backup” আর “==> Step 1: Checking this server”। এখন কিছু টাইপ করতে হবে না।",
          en: "First “restore.sh: OK” shows: the script arrived unchanged. Then “==> Extas ERP: bringing the ERP back from a Google Drive backup” and “==> Step 1: Checking this server”. There is nothing to type yet.",
        },
        picture: "putty-start",
        tip: {
          bn: "“FAILED” দেখলে ভুলের তালিকায় restore.sh: FAILED দেখুন। পাসওয়ার্ড চাইলে (“[sudo] password for erpadmin:”) গাইডের শেষে অন্য জায়গার বার্তার তালিকায় সেটি দেখুন।",
          en: "If you see “FAILED”, see restore.sh: FAILED in the list of errors. If it asks for a password (“[sudo] password for erpadmin:”), see it in the messages from elsewhere at the end of this guide.",
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
          bn: "“Google hasn't verified this app” এলে নিচে ছোট করে লেখা “Advanced” চাপুন, তারপর “Go to Extas ERP (unsafe)” চাপুন: অ্যাপটি আপনার নিজের, আপনিই Google Cloud-এ বানিয়েছিলেন। তারপর “Continue” আর “Allow” চাপুন।",
          en: "If “Google hasn't verified this app” shows, tap “Advanced” (small, near the bottom), then “Go to Extas ERP (unsafe)”: the app is your own; you made it in Google Cloud. Then tap “Continue” and “Allow”.",
        },
        picture: "phone-allow",
        tip: {
          bn: "“Go to ... (unsafe)”-এ Google আপনার অ্যাপের নামটি দেখায়, যা আপনি Google Cloud-এ দিয়েছিলেন (সাধারণত Extas ERP)। “BACK TO SAFETY” চাপবেন না: তাহলে সাইন-ইন বাতিল হয় (R09)। শেষে ফোনে লেখা আসে যে এবার জানালাটি বন্ধ করতে পারেন।",
          en: "In “Go to ... (unsafe)” Google shows your app's name, the one you gave it in Google Cloud (usually Extas ERP). Do not tap “BACK TO SAFETY”: that stops the sign-in (R09). At the end the phone says you can close the window.",
        },
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
          bn: "“To point ... to this server” প্রশ্ন এলে আপনার ওয়েব ঠিকানা (যেমন erp.extasbd.com) টাইপ করে Enter চাপুন: ওয়েব ঠিকানা Cloudflare-এ নতুন সার্ভারের দিকে ঘুরে যাবে। শুধু Enter চাপলে ঠিকানা যেমন ছিল তেমনই থাকে, আর নতুন ERP অপেক্ষায় (standby) থাকে: কোনো ব্যাকআপ নেয় না, কোনো রিমাইন্ডার পাঠায় না।",
          en: "When it asks “To point ... to this server”, type your web address (for example erp.extasbd.com) and press Enter: the web address is pointed at the new server in Cloudflare. Just Enter leaves the address as it is, and the new ERP waits on standby: it makes no backups and sends no reminders.",
        },
        picture: "putty-dns",
        tip: {
          bn: "পুরনো ERP এখনো চললে কমান্ড তা বলে দেয় (“still answers from another server”): তখন শুধু Enter চাপুন, যদি না পুরনো সার্ভার বন্ধ বা আর ব্যবহার হবে না। অনুশীলনের জন্য এই গাইডের শেষের মহড়ার অংশটি করুন। Backups পাতায় Cloudflare টোকেন রাখা না থাকলে এই প্রশ্ন আসে না; তখন শেষে F6 ধাপটি করুন।",
          en: "If the old ERP still runs, the command says so (“still answers from another server”): then just press Enter, unless the old server is off or will not be used again. To practise, follow the drill at the end of this guide instead. Without a Cloudflare token saved on the Backups screen this question does not come; then do step F6 at the end.",
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
          bn: `সংযোগ কেটে গেলেও রিস্টোর নিজে নিজে চলতে থাকে। B5-এর “Saved Sessions” দিয়ে আবার ঢুকে কমান্ডটি আবার পেস্ট করুন: লেখা আসবে “A restore is already running on this server”, আর শেষ না হওয়া পর্যন্ত সেটি দেখাবে। রিস্টোর থেমে গিয়ে থাকলে আবার শুরু হয়, আর জিজ্ঞেস করতে পারে “Type the web address of the ERP on this server”। ${REPLACE_RULE.bn}`,
          en: `If the connection drops, the restore goes on by itself. Sign in again with “Saved Sessions” as in B5 and paste the command again: it says “A restore is already running on this server” and shows it until it ends. If the restore had stopped, it starts again and may ask “Type the web address of the ERP on this server”. ${REPLACE_RULE.en}`,
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
          bn: "PuTTY-তে লিখুন cd /opt/extras-erp && sudo ./deploy/setup-auto-deploy.sh আর Enter চাপুন। এটি চারটি জিনিস দেখায়: USERNAME, SSH_HOST_KEY, SSH_PRIVATE_KEY আর SERVER_IP। ব্রাউজারে github.com-এ Extas-ERP রিপোজিটরি খুলে “Settings” > “Secrets and variables” > “Actions” খুলুন। প্রতিটির পাশের পেনসিল চিহ্ন চেপে PuTTY থেকে তার নতুন মান বসান (SERVER_IP-এ A13-এর IP), তারপর “Update secret” চাপুন।",
          en: "In PuTTY, type cd /opt/extras-erp && sudo ./deploy/setup-auto-deploy.sh and press Enter. It shows four things: USERNAME, SSH_HOST_KEY, SSH_PRIVATE_KEY and SERVER_IP. In the browser, open the Extas-ERP repository on github.com, then “Settings” > “Secrets and variables” > “Actions”. Click the pencil sign next to each one, put in its new value from PuTTY (for SERVER_IP, the IP from A13), then click “Update secret”.",
        },
        tip: {
          bn: "PuTTY-তে মাউস দিয়ে লেখা টেনে বাছলেই কপি হয়ে যায়; SSH_PRIVATE_KEY-এর BEGIN লাইন থেকে END লাইন পর্যন্ত পুরোটা নিন। এটা না করা পর্যন্ত ERP চলে, শুধু নতুন আপডেট আসে না; পরেও করা যায়। শুধু সেই সার্ভারে করুন যা আপনি রোজ ব্যবহার করবেন, মহড়ার সার্ভারে কখনো নয়।",
          en: "In PuTTY, selecting text with the mouse copies it; for SSH_PRIVATE_KEY take everything from the BEGIN line to the END line. Until you do this the ERP runs; only new updates do not arrive, and you can do it later. Do it only on the server you will use every day, never on a drill server.",
        },
      },
      {
        id: "F6",
        title: {
          bn: "ওয়েব ঠিকানা হাতে বদলানো (শুধু দরকার হলে)",
          en: "Change the web address by hand (only if needed)",
        },
        text: {
          bn: "ওয়েব ঠিকানা না খুললে (W01 বা W03): Cloudflare-এ আপনার ডোমেইন খুলে “DNS” > “Records”-এ erp (আর demo) লাইনের “Edit” চাপুন, “IPv4 address”-এ A13-এর IP দিন, “Save” চাপুন। কয়েক মিনিটে খুলবে। নতুন ERP standby-তে থাকলে (W10) এরপর PuTTY-তে চালান: cd /opt/extras-erp && sudo ./deploy/go-live.sh, আর জিজ্ঞেস করলে আপনার ওয়েব ঠিকানা টাইপ করে Enter চাপুন। এটি শুধু তখনই করুন যখন পুরনো সার্ভার বন্ধ বা আর ব্যবহার হবে না।",
          en: "If the web address does not open (W01 or W03): in Cloudflare open your domain, go to “DNS” > “Records”, click “Edit” on the erp (and demo) line, put the IP from A13 in “IPv4 address”, click “Save”. It opens within a few minutes. If the new ERP waits on standby (W10), then run in PuTTY: cd /opt/extras-erp && sudo ./deploy/go-live.sh, and type your web address when it asks. Do this only when the old server is off or will not be used again.",
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
    prompt: "To point ... to this server (...), type ...; or press Enter to leave it as it is: ",
    answer: {
      bn: "ওয়েব ঠিকানা এই সার্ভারে আনতে আপনার ওয়েব ঠিকানা টাইপ করে Enter। শুধু Enter চাপলে ঠিকানা বদলায় না আর নতুন ERP standby-তে থাকে; অনুশীলনের জন্য সেটাই ঠিক (D8)।",
      en: "To bring the web address to this server, type your web address and press Enter. Just Enter leaves it as it is and the new ERP waits on standby; that is right for a practice run (D8).",
    },
  },
  {
    prompt:
      "Type the web address of the ERP on this server to replace its data, or press Enter to stop: ",
    answer: {
      bn: `এই সার্ভারে আগে থেকেই Extas ERP আছে; উপরে তার “Program folder”, “Data folder”, “Web address” আর “Running now” লেখা থাকে। ${REPLACE_RULE.bn}`,
      en: `This server already has Extas ERP; its “Program folder”, “Data folder”, “Web address” and “Running now” are shown above. ${REPLACE_RULE.en}`,
    },
  },
  {
    prompt: "Test web address for this drill (for example ...): ",
    answer: {
      bn: "শুধু মহড়ায় আসে (কমান্ডের শেষে --drill থাকলে): মহড়ার জন্য বাছা নতুন ঠিকানাটি লিখে Enter, যেমন drill.extasbd.com। আসল ERP বা ডেমো সাইটের ঠিকানা কখনো নয়।",
      en: "Only in a drill (the command ends with --drill): type the new address you picked for the drill, like drill.extasbd.com, and press Enter. Never the real ERP's or the demo site's address.",
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
      "সার্ভারটি Ubuntu নয়, বা 22.04-এর চেয়ে পুরনো Ubuntu।",
      "The server is not Ubuntu, or an Ubuntu older than 22.04.",
    ),
    todo: fix(
      "Azure-এ সার্ভারটি মুছে আবার বানান এবং A6 ধাপে “Ubuntu Server 24.04 LTS - x64 Gen2” বেছে নিন (22.04 LTS-ও চলে, তার চেয়ে পুরনো নয়)।",
      "Delete the VM in Azure and make it again, choosing “Ubuntu Server 24.04 LTS - x64 Gen2” at step A6 (22.04 LTS works too; nothing older).",
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
      `যে সার্ভারে আপনার ERP রোজ চলে সেখানে হলে কিছুই করবেন না: সেটাই ঠিক ছিল। তা না হলে কমান্ড আবার চালান। ${REPLACE_RULE.bn}`,
      `On the server your ERP runs on every day, do nothing: stopping was right. Otherwise run the command again. ${REPLACE_RULE.en}`,
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
      `কয়েক মিনিট পরে কমান্ড আবার চালান। বারবার হলে Azure-এ সার্ভারের ইন্টারনেট (Networking) ঠিক আছে কি না দেখুন। ${NO_GITHUB.bn}`,
      `Run the command again in a few minutes. If it keeps happening, check the VM's internet (Networking) in Azure. ${NO_GITHUB.en}`,
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
      `কমান্ড আবার চালান; এবার সে জিজ্ঞেস করবে “Type the web address of the ERP on this server”। ${REPLACE_RULE.bn} একই ভুল আবার হলে আরেকটি ব্যাকআপ বেছে নিন।`,
      `Run the command again; it then asks “Type the web address of the ERP on this server”. ${REPLACE_RULE.en} If the same error comes again, pick another backup.`,
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
    meaning: fix("এই সার্ভারে আরেকটি রিস্টোর চলছে।", "Another restore is running on this server."),
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
    code: "R30",
    shown: "cannot be the drill's web address",
    meaning: fix(
      "মহড়ার জন্য টাইপ করা ঠিকানাটি ঠিক নয়, বা সেটি আসল ERP বা ডেমো সাইটের ঠিকানা। কিছুই বদলানো হয়নি।",
      "The address typed for the drill is not a web address, or it is the real ERP's or the demo site's. Nothing was changed.",
    ),
    todo: fix(
      "কমান্ড আবার চালিয়ে মহড়ার জন্য নতুন একটি ঠিকানা লিখুন, যেমন drill.extasbd.com।",
      "Run the command again and type a new address for the drill, like drill.extasbd.com.",
    ),
  },
  {
    code: "W01",
    shown: "the web address was not changed",
    meaning: fix(
      "ওয়েব ঠিকানা নিজে নিজে নতুন সার্ভারে ঘোরানো হয়নি (Cloudflare টোকেন রাখা ছিল না, বা আপনি ঠিকানা টাইপ না করে শুধু Enter চাপলেন)।",
      "The web address was not pointed at the new server by itself (no Cloudflare token was saved, or you pressed Enter without typing the address).",
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
      "ERP চলছে, কিন্তু পরীক্ষায় কয়েকটি স্ক্রিন বা PDF খোলেনি, অথবা রিস্টোরের পর Bug Guard জরুরি বা গুরুত্বপূর্ণ কিছু পেয়েছে (বা সব দেখে শেষ করতে পারেনি)।",
      "The ERP runs, but a few screens or PDFs did not open in the check, or Bug Guard found something urgent or important after the restore (or could not check everything).",
    ),
    todo: fix(
      "তালিকাটির ছবি তুলে ডেভেলপারকে পাঠান। Bug Guard যা পেয়েছে তা ERP-এর ইনবক্সে আর Telegram-এ আছে; সব দেখা না হলে সে নিজের সময়সূচিতে আবার দেখবে।",
      "Take a picture of the list and send it to the developer. What Bug Guard found is in the ERP's inbox and on Telegram; if it could not check everything, it checks again on its own schedule.",
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
  {
    code: "W10",
    shown: "this ERP waits on standby",
    meaning: fix(
      "ওয়েব ঠিকানা এখনো অন্য (পুরনো) সার্ভারের দিকে, তাই নতুন ERP অপেক্ষায় আছে: খোলে, কিন্তু ব্যাকআপ নেয় না, রিমাইন্ডার বা অন্য কিছু নিজে থেকে পাঠায় না। এতে একসঙ্গে দুটি ERP চলে না।",
      "The web address still points at the other (old) server, so the new ERP waits: it opens, but makes no backups and sends no reminders or anything else by itself. So two ERPs never run at once.",
    ),
    todo: fix(
      "অনুশীলন হলে কিছু করতে হবে না; শেষে Azure-এ অনুশীলনের সার্ভারটি মুছে দিন। এই সার্ভারই কাজে লাগবে (পুরনোটি বন্ধ) হলে F6 ধাপটি করুন: ঠিকানা এখানে আনুন, তারপর sudo ./deploy/go-live.sh চালান।",
      "For a practice run, nothing to do; delete the practice server in Azure at the end. If this server is the one to use (the old one is off), do step F6: bring the address here, then run sudo ./deploy/go-live.sh.",
    ),
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
    shown: "No supported authentication methods available (server sent: publickey)",
    where: fix("PuTTY", "PuTTY"),
    todo: fix(
      "PuTTY চাবি পায়নি: B4 আবার করুন (extas-erp-key.ppk), তারপর B5-এ “Save”। নাম হতে হবে erpadmin।",
      "PuTTY did not have the key: do B4 again (extas-erp-key.ppk), then “Save” at B5. The user name must be erpadmin.",
    ),
  },
  {
    shown: "Server refused our key",
    where: fix("PuTTY", "PuTTY"),
    todo: fix(
      "ভুল চাবি বা ভুল নাম: নাম erpadmin আর চাবি এই সার্ভারের extas-erp-key.ppk কি না দেখুন (B2 থেকে B4)। চাবি হারালে Azure-এ সার্ভারের “Reset password” পাতায় “Reset SSH public key” দিন।",
      "The wrong key or user name: check the name is erpadmin and the key is this server's extas-erp-key.ppk (B2 to B4). If the key is lost, use “Reset SSH public key” on the VM's “Reset password” page in Azure.",
    ),
  },
  {
    shown: "[sudo] password for erpadmin:",
    where: fix("PuTTY", "PuTTY"),
    todo: fix(
      "চাবি দিয়ে বানানো Azure সার্ভারে সাধারণত এটি আসে না। এলে Ctrl+C চাপুন, Azure-এ সার্ভারের “Reset password” পাতায় “Reset password” বেছে erpadmin নামের জন্য নতুন পাসওয়ার্ড দিন, তারপর কমান্ড আবার পেস্ট করে সেই পাসওয়ার্ড টাইপ করুন (কিছু দেখা যাবে না)।",
      "An Azure server made with a key does not usually ask this. If it does, press Ctrl+C, choose “Reset password” on the VM's “Reset password” page in Azure and give user erpadmin a new password, then paste the command again and type that password (nothing shows).",
    ),
  },
  {
    shown: "curl: (6) Could not resolve host",
    where: fix("PuTTY, কমান্ডের শুরুতে", "PuTTY, at the start of the command"),
    todo: fix(
      "সার্ভারের ইন্টারনেট এখনো তৈরি নয়; 2 মিনিট পরে আবার চালান। বারবার হলে ভুলের তালিকায় R06 দেখুন।",
      "The VM's internet is not ready yet; run it again in 2 minutes. If it keeps happening, see R06 in the list of errors.",
    ),
  },
  {
    shown: "curl: (22) The requested URL returned error: 404",
    where: fix("PuTTY, কমান্ডের শুরুতে", "PuTTY, at the start of the command"),
    todo: fix(
      `কমান্ডটি পুরো কপি হয়নি; C1 থেকে আবার কপি করুন। আবার হলে Google Drive-এর সবচেয়ে নতুন গাইড থেকে কমান্ড নিন। ${NO_GITHUB.bn}`,
      `The command was not copied whole; copy it again from C1. If it happens again, take the command from the newest guide in Google Drive. ${NO_GITHUB.en}`,
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
    shown: "Google hasn't verified this app",
    where: fix("ফোনে, Google", "On the phone, Google"),
    todo: fix(
      "নিচে ছোট করে লেখা “Advanced” চাপুন, তারপর “Go to Extas ERP (unsafe)” (আপনার অ্যাপের নাম)। অ্যাপটি আপনার নিজের (D5)।",
      "Tap “Advanced” (small, near the bottom), then “Go to Extas ERP (unsafe)” (your app's name). The app is your own (D5).",
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
    NO_GITHUB_PART,
    DRILL_PART,
  ]);
  // FNV-1a, 32 bits: enough to notice a change, and works in the browser too.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
