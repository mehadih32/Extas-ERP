import type { HelpSection } from "../types";

/** The AI Center: the main switch, what the AI may do (Control), its requests, models, logs and settings. */
export const aiHelp: HelpSection = {
  id: "ai",
  title: "এআই সেন্টার (AI)",
  description:
    "এআই (Mehedi 2.0) চালু বা বন্ধ করা, সে কী করতে পারবে তা ঠিক করা (Do / Ask / Off), তার অনুরোধের উত্তর দেওয়া, কোন কাজে কোন মডেল, তার সব কাজের লগ, আর Claude key ও PIN।",
  href: "/ai",
  articles: [
    {
      slug: "ai-switch",
      title: "এআই চালু, বন্ধ বা থামিয়ে রাখবেন যেভাবে",
      summary:
        "মূল সুইচ: শুরুতে এআই বন্ধ থাকে। বন্ধ থাকলে কোনো এআই কল হয় না, খরচও হয় না, আর প্রতিটি স্ক্রিন নিজের নিয়মে কাজ করে।",
      keywords: [
        "ai",
        "turn on",
        "turn off",
        "switch",
        "pause",
        "resume",
        "mehedi 2.0",
        "এআই",
        "চালু",
        "বন্ধ",
        "থামানো",
        "সুইচ",
      ],
      routes: ["/ai"],
      who: "যাঁদের এআই সেন্টার দেখার অনুমতি আছে তাঁরা দেখেন; চালু-বন্ধ করেন শুধু মালিক (ai.manage)।",
      steps: [
        {
          text: "মেনু থেকে “AI” খুলুন। “AI Home” ট্যাবে উপরেই দেখবেন এআই এখন চালু, থামানো না বন্ধ: “AI is on”, “AI is paused” বা “AI is off”।",
          image: { id: "ai-switch-1", caption: "“AI Home”: মূল সুইচ ও তার অবস্থা" },
        },
        {
          text: "চালু করতে “Turn AI on” চাপুন, জানালায় আবার “Turn AI on” চাপুন। চালু হলেও Control-এর সব ঘর শুরুতে “Ask”, তাই কিছু করার আগে এআই আপনাকে জিজ্ঞেস করবে।",
        },
        {
          text: "কিছুক্ষণের জন্য সব কাজ থামাতে “Pause” চাপুন; আবার শুরু করতে “Resume”। পুরোপুরি বন্ধ করতে “Turn AI off”।",
        },
        {
          text: "এআই-এর Claude key না থাকলে চালু করার পরেও সে কাজ করতে পারে না। তখন “Add the key in Settings” লেখায় চেপে key দিন (নিচের “Claude key ও PIN” গাইড দেখুন)।",
        },
      ],
      tips: [
        "এআই কখনো কোনো ডেটা মুছে ফেলে না, আর কারও অনুমতি বা ভূমিকা বদলায় না।",
        "বায়ারের কাছে কিছু যায় না আপনার OK ছাড়া: উত্তর, ফলো-আপ, রিমাইন্ডার, ক্লেইম, কোটেশন বা ইনভয়েস। এআই খসড়া লেখে আর আপনাকে মনে করিয়ে দেয়।",
        "লাইভ সাইটে এআই বন্ধ থাকে যতক্ষণ না মালিক নিজে চালু করেন।",
      ],
    },
    {
      slug: "ai-requests",
      title: "এআই-এর অনুমতি ও মুছে ফেলার অনুরোধের উত্তর দেবেন যেভাবে",
      summary:
        "কোনো ঘর “Off” থাকলে এআই অনুমতি চায়; কিছু মুছে ফেলা দরকার মনে করলে মুছে না দিয়ে আপনার কাছে Deletion request পাঠায়।",
      keywords: [
        "request",
        "permission",
        "deletion request",
        "approve",
        "refuse",
        "pin",
        "অনুরোধ",
        "অনুমতি",
        "মুছে ফেলা",
        "অনুমোদন",
      ],
      routes: ["/ai"],
      who: "উত্তর দেন মালিক (ai.manage)। অন্যরা শুধু দেখেন।",
      steps: [
        {
          text: "“AI Home”-এ “Waiting for your answer” অংশে এআই-এর সব খোলা অনুরোধ থাকে: কোন কাজের জন্য, কেন, কোন রেকর্ডে।",
          image: {
            id: "ai-requests-1",
            caption: "“Waiting for your answer”: অনুমতির অনুরোধ ও উত্তরের বোতাম",
          },
        },
        {
          text: "অনুমতির অনুরোধে চারটি উত্তর: “Only this task” (শুধু এই একবার), “For today” (আজকের দিন), “Always” (ঘরটি “Do” হয়ে যায়) বা “No”।",
        },
        {
          text: "টাকা, দাম বা কোম্পানির বাইরে যায় এমন ঘরের জন্য PIN চাওয়া হয় (PIN ঠিক করা থাকলে)। “PIN” ঘরে PIN লিখে তারপর উত্তর দিন।",
        },
        {
          text: "“Deletion request”-এ এআই লেখে কী মুছতে চায়, কেন, আর না মুছলে কী হবে। “Open it” চেপে রেকর্ডটি দেখুন, তারপর “Approve” বা “Refuse”।",
        },
        {
          text: "“Approve” চাপলেও এআই নিজে কিছু মোছে না। রেকর্ডটি তার নিজের পাতায় আপনার নামে মুছুন।",
        },
      ],
      tips: [
        "একই প্রশ্ন একবারই আসে; উত্তর না দেওয়া পর্যন্ত এআই সেই কাজ করে না।",
        "বটের মাধ্যমে আসা অনুরোধে “From the bot” লেখা থাকে।",
      ],
    },
    {
      slug: "ai-control",
      title: "এআই কী করতে পারবে তা ঠিক করবেন যেভাবে (Control)",
      summary:
        "অ্যাক্সেস ট্রির প্রতিটি ঘরে Do / Ask / Off: একটি অংশ বদলালে তার ভেতরের সব বদলায়; প্রিসেট এক চাপে অনেক ঘর ঠিক করে; কোনো ঘর কিছু সময়ের জন্য খুলে দেওয়া যায়।",
      keywords: [
        "control",
        "do",
        "ask",
        "off",
        "preset",
        "grant",
        "access tree",
        "নিয়ন্ত্রণ",
        "অনুমতি",
        "প্রিসেট",
        "ঘর",
      ],
      routes: ["/ai/control"],
      who: "দেখেন যাঁদের এআই সেন্টার খোলা; বদলান শুধু মালিক (ai.manage)।",
      steps: [
        {
          text: "“AI” > “Control” খুলুন। “What the AI may do” অংশে ভূমিকার অনুমতির মতোই একটি গাছ, প্রতিটি ঘরে তিনটি বোতাম: “Do” (নিজে করবে), “Ask” (আগে জিজ্ঞেস করবে), “Off” (করবে না)।",
          image: { id: "ai-control-1", caption: "“Control”: Do / Ask / Off সহ গাছ" },
        },
        {
          text: "একটি অংশে (যেমন Production) বোতাম চাপলে তার ভেতরের সব ঘর একই হয়ে যায়। ভেতরের কোনো ঘর আলাদা রাখলে সেটি হলুদ দেখায়, পাশে “set on its own”।",
        },
        {
          text: "তালার চিহ্ন দেওয়া ঘর (টাকা, দাম, বাইরে পাঠানো, বাতিল, বুকিং অনুমোদন ও পাঠানো) অংশ “Do” হলেও আপনাকে জিজ্ঞেস করে; পাশে লেখা “asks you”। বায়ারের কাছে যায় এমন ঘর কখনো “Do” হয় না।",
        },
        {
          text: "“Presets”-এ এক চাপে অনেক ঘর ঠিক করুন: “Only tech pack and booking”, “Production full”, “Accounts open today” বা “All off”। জানালায় “Use this preset” চাপুন।",
        },
        {
          text: "কোনো ঘর কিছু সময়ের জন্য খুলতে “Open a cell for a while” চাপুন, “Cell” বেছে নিন, “For how long”-এ “For today” বা “Until a date” (তখন “Last day” দিন), তারপর “Open it”।",
        },
        {
          text: "খোলা ঘরগুলো “Open for a while” অংশে থাকে, সময় শেষে নিজে থেকে বন্ধ হয়। আগেই বন্ধ করতে “End now”।",
        },
      ],
      tips: [
        "মুছে ফেলার কোনো ঘর নেই: এআই কখনো কিছু মোছে না।",
        "এআই কখনো ভূমিকা, অনুমতি, Control বা ব্যাকআপ ছুঁতে পারে না।",
        "এআই বন্ধ থাকলেও আগে থেকে Control সাজিয়ে রাখা যায়।",
      ],
    },
    {
      slug: "ai-models",
      title: "কোন কাজে কোন এআই মডেল চলবে তা বদলাবেন যেভাবে",
      summary:
        "বড় মডেল চিন্তার কাজ করে (পরিকল্পনা, কস্টিং, টেক প্যাক), মাঝারিটি লেখে, ছোটটি ফর্ম পড়ে ও তথ্য জোগাড় করে। দরকার হলে প্রতিটি কাজের মডেল বদলানো যায়।",
      keywords: ["models", "opus", "sonnet", "haiku", "fable", "price", "মডেল", "দাম", "খরচ"],
      routes: ["/ai/models"],
      who: "দেখেন যাঁদের এআই সেন্টার খোলা; বদলান শুধু মালিক (ai.manage)।",
      steps: [
        {
          text: "“AI” > “Models” খুলুন। “Which model does which task” অংশে প্রতিটি কাজ, তার এলাকা, আর এখন কোন মডেলে চলে।",
          image: { id: "ai-models-1", caption: "“Models”: কাজ অনুযায়ী মডেলের তালিকা" },
        },
        {
          text: "কোনো কাজের মডেল বদলাতে তার পাশের তালিকা থেকে মডেল বেছে নিন। আগের মতো করতে “System's choice” বেছে নিন।",
        },
        {
          text: "Fable 5.1 সবচেয়ে দামি। খুব কঠিন সমস্যার জন্য “Allow Fable 5.1” চাপুন, কাজ শেষে “Stop Fable 5.1”। অনুমতি না থাকলে ওই কাজ নিজের মডেলেই চলে।",
        },
        {
          text: "“Prices” অংশে প্রতিটি মডেলের দাম (প্রতি 10 লাখ টোকেনে ডলার)।",
        },
      ],
    },
    {
      slug: "ai-logs",
      title: "এআই কী করেছে তা দেখবেন যেভাবে (Logs)",
      summary:
        "এআই-এর প্রতিটি কাজ তার নাম ও “AI” চিহ্নসহ, আর এআই নিয়ে মানুষের করা প্রতিটি বদল (চালু-বন্ধ, Control, অনুরোধের উত্তর), নতুনটি আগে।",
      keywords: ["logs", "history", "audit", "what the ai did", "লগ", "ইতিহাস", "এআই কী করেছে"],
      routes: ["/ai/logs"],
      who: "যাঁদের এআই সেন্টার খোলা।",
      steps: [
        {
          text: "“AI” > “Logs” খুলুন। “Everything”-এ সব; “Done by the AI”-তে শুধু এআই-এর কাজ; “Changes to the AI”-তে শুধু মানুষের করা বদল।",
          image: { id: "ai-logs-1", caption: "“Logs”: এআই-এর কাজ ও বদলের তালিকা" },
        },
        {
          text: "“AI Home”-এর “What the AI did last” অংশে শেষ কয়েকটি কাজ থাকে; সব দেখতে “All logs” চাপুন।",
        },
      ],
    },
    {
      slug: "ai-settings",
      title: "Claude key, PIN ও এআই-এর নাম ঠিক করবেন যেভাবে",
      summary:
        "এআই কাজ করে কোম্পানির Claude key দিয়ে (লক করে রাখা হয়, শেষ 4টি অক্ষর ছাড়া আর দেখা যায় না)। PIN চাওয়া হয় টাকা, দাম ও মুছে ফেলার অনুমোদনে।",
      keywords: ["settings", "api key", "claude key", "pin", "name", "সেটিংস", "কী", "পিন", "নাম"],
      routes: ["/ai/settings"],
      who: "শুধু মালিক (ai.manage)।",
      anyOf: ["ai.manage"],
      steps: [
        {
          text: "console.anthropic.com-এ ঢুকে API Keys খুলুন, Create Key চেপে key কপি করুন (শুরুতে sk-ant- থাকে)। সেখানে মাসিক খরচের সীমাও দিয়ে রাখুন।",
        },
        {
          text: "“AI” > “Settings” খুলুন, “Add the key” চাপুন, key বসিয়ে “Save the key”। বদলাতে “Change the key”, সরাতে “Remove the key”।",
          image: { id: "ai-settings-1", caption: "“Settings”: Claude key, PIN ও এআই-এর নাম" },
        },
        {
          text: "“Set a PIN” চেপে 4 থেকে 8 অঙ্কের PIN দিন, তারপর “Save the PIN”। পরে বদলাতে “Change the PIN”: আগে “Current PIN”, তারপর “New PIN”।",
        },
        {
          text: "এআই-এর নাম বদলাতে “Rename” চাপুন। সে যা লেখে সবকিছুর নিচে নামের সঙ্গে “(AI)” থাকে, যাতে কেউ মানুষ ভেবে ভুল না করে।",
        },
      ],
      tips: [
        "PIN কাউকে বলবেন না; বটেও একই PIN চাওয়া হয়।",
        "PIN পরপর ভুল দিলে 15 মিনিট অপেক্ষা করতে হয়।",
      ],
    },
  ],
};
