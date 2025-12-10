<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { Button } from "$lib/components/ui/button";
  import Spinner from "$lib/components/Spinner.svelte";
  import TokenCost from "../../components/TokenCost.svelte";
  import { FileText, Palette, Database, Code, ArrowUp } from "lucide-svelte";
  import type { Message, PreviewError, TokenUsage, PendingPrompt } from "../../types";
  import { send_prompt, clear_conversation, load_spec } from "../../lib/api.svelte";
  import { marked } from "marked";
  import { current_builder_theme } from "$lib/builder_themes";
  import { getProjectContext } from "../../context";

  // Get project_id from context instead of props
  const { project_id } = getProjectContext();

  // Configure marked
  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  // Map common emojis to iconify identifiers
  const emoji_to_icon: Record<string, string> = {
    // Faces & emotions
    "😀": "lucide:smile",
    "😃": "lucide:smile",
    "😄": "lucide:smile",
    "😁": "lucide:smile",
    "😆": "lucide:laugh",
    "😅": "lucide:smile",
    "🤣": "lucide:laugh",
    "😂": "lucide:laugh",
    "🙂": "lucide:smile",
    "🙃": "lucide:smile",
    "😉": "lucide:smile",
    "😊": "lucide:smile",
    "😇": "lucide:smile",
    "🥰": "lucide:heart",
    "😍": "lucide:heart",
    "🤩": "lucide:star",
    "😘": "lucide:heart",
    "😗": "lucide:smile",
    "☺️": "lucide:smile",
    "😚": "lucide:smile",
    "😙": "lucide:smile",
    "🥲": "lucide:smile",
    "😋": "lucide:smile",
    "😛": "lucide:smile",
    "😜": "lucide:smile",
    "🤪": "lucide:smile",
    "😝": "lucide:smile",
    "🤑": "lucide:coins",
    "🤗": "lucide:smile",
    "🤭": "lucide:smile",
    "🤫": "lucide:volume-x",
    "🤔": "lucide:help-circle",
    "🤐": "lucide:lock",
    "🤨": "lucide:scan-eye",
    "😐": "lucide:meh",
    "😑": "lucide:meh",
    "😶": "lucide:meh",
    "😏": "lucide:smile",
    "😒": "lucide:meh",
    "🙄": "lucide:eye",
    "😬": "lucide:meh",
    "🤥": "lucide:x-circle",
    "😌": "lucide:smile",
    "😔": "lucide:frown",
    "😪": "lucide:moon",
    "🤤": "lucide:smile",
    "😴": "lucide:moon",
    "😷": "lucide:shield",
    "🤒": "lucide:thermometer",
    "🤕": "mdi:bandage",
    "🤢": "lucide:frown",
    "🤮": "lucide:frown",
    "🤧": "lucide:frown",
    "🥵": "lucide:thermometer-sun",
    "🥶": "lucide:thermometer-snowflake",
    "🥴": "lucide:meh",
    "😵": "lucide:x",
    "🤯": "lucide:zap",
    "🤠": "lucide:smile",
    "🥳": "lucide:party-popper",
    "🥸": "lucide:glasses",
    "😎": "lucide:glasses",
    "🤓": "lucide:glasses",
    "🧐": "lucide:scan-eye",
    "😕": "lucide:frown",
    "😟": "lucide:frown",
    "🙁": "lucide:frown",
    "☹️": "lucide:frown",
    "😮": "lucide:circle",
    "😯": "lucide:circle",
    "😲": "lucide:circle",
    "😳": "lucide:circle",
    "🥺": "lucide:frown",
    "😦": "lucide:frown",
    "😧": "lucide:frown",
    "😨": "lucide:alert-triangle",
    "😰": "lucide:alert-triangle",
    "😥": "lucide:frown",
    "😢": "lucide:frown",
    "😭": "lucide:frown",
    "😱": "lucide:alert-circle",
    "😖": "lucide:frown",
    "😣": "lucide:frown",
    "😞": "lucide:frown",
    "😓": "lucide:frown",
    "😩": "lucide:frown",
    "😫": "lucide:frown",
    "🥱": "lucide:moon",
    "😤": "lucide:angry",
    "😡": "lucide:angry",
    "😠": "lucide:angry",
    "🤬": "lucide:angry",
    "😈": "lucide:smile",
    "👿": "lucide:angry",
    "💩": "lucide:trash-2",
    "🤡": "lucide:smile",
    "👹": "lucide:skull",
    "👺": "lucide:skull",
    "👻": "lucide:ghost",
    "👽": "lucide:bot",
    "🙈": "lucide:eye-off",
    "🙉": "lucide:ear-off",
    "🙊": "lucide:volume-x",

    // Status & feedback
    "✅": "lucide:check-circle-2",
    "❌": "lucide:x-circle",
    "⚠️": "lucide:alert-triangle",
    "✓": "lucide:check",
    "✔️": "lucide:check",
    "☑️": "lucide:square-check",
    "❗": "lucide:alert-circle",
    "❓": "lucide:help-circle",
    ℹ️: "lucide:info",
    "💯": "lucide:badge-check",

    // Actions & productivity
    "✨": "lucide:sparkles",
    "💡": "lucide:lightbulb",
    "🎯": "lucide:target",
    "🚀": "lucide:rocket",
    "⚡": "lucide:zap",
    "🔥": "lucide:flame",
    "💪": "lucide:dumbbell",
    "🏆": "lucide:trophy",
    "🎉": "lucide:party-popper",
    "🎊": "lucide:party-popper",
    "✏️": "lucide:pencil",
    "🖊️": "lucide:pen",
    "🖋️": "lucide:pen-tool",

    // Files & documents
    "📝": "lucide:file-text",
    "📄": "lucide:file",
    "📃": "lucide:file-text",
    "📑": "lucide:files",
    "📁": "lucide:folder",
    "📂": "lucide:folder-open",
    "🗂️": "lucide:folders",
    "📋": "lucide:clipboard",
    "📎": "lucide:paperclip",
    "🔖": "lucide:bookmark",
    "📌": "lucide:pin",
    "🏷️": "lucide:tag",
    "🗒️": "lucide:sticky-note",
    "📒": "lucide:notebook",
    "📓": "lucide:notebook",
    "📔": "lucide:book",
    "📕": "lucide:book",
    "📗": "lucide:book",
    "📘": "lucide:book",
    "📙": "lucide:book",
    "📚": "lucide:library",

    // Development & tools
    "🔧": "lucide:wrench",
    "🛠️": "lucide:settings",
    "⚙️": "lucide:cog",
    "🔩": "lucide:wrench",
    "🧰": "lucide:briefcase",
    "💻": "lucide:laptop",
    "🖥️": "lucide:monitor",
    "⌨️": "lucide:keyboard",
    "🖱️": "lucide:mouse",
    "🐛": "lucide:bug",
    "🧪": "lucide:flask-conical",
    "🔬": "lucide:microscope",
    "⚗️": "lucide:flask-conical",
    "🧬": "lucide:dna",
    "🤖": "lucide:bot",
    "🧩": "lucide:puzzle",

    // Design & visuals
    "🎨": "lucide:palette",
    "🖼️": "lucide:image",
    "🖌️": "lucide:brush",
    "✒️": "lucide:pen-tool",
    "🌈": "lucide:rainbow",
    "💎": "lucide:gem",
    "💠": "lucide:diamond",

    // Data & charts
    "📊": "lucide:bar-chart",
    "📈": "lucide:trending-up",
    "📉": "lucide:trending-down",
    "📐": "lucide:ruler",
    "📏": "lucide:ruler",
    "🔢": "lucide:hash",
    "#️⃣": "lucide:hash",
    "🧮": "lucide:calculator",
    "📆": "lucide:calendar",
    "📅": "lucide:calendar",
    "🗓️": "lucide:calendar-days",

    // Storage & packages
    "📦": "lucide:package",
    "🗃️": "lucide:archive",
    "🗄️": "lucide:hard-drive",
    "💾": "lucide:save",
    "💿": "lucide:disc",
    "📀": "lucide:disc",
    "🗑️": "lucide:trash-2",

    // Security & privacy
    "🔒": "lucide:lock",
    "🔓": "lucide:unlock",
    "🔐": "lucide:lock-keyhole",
    "🔑": "lucide:key",
    "🗝️": "lucide:key-round",
    "🛡️": "lucide:shield",
    "🔏": "lucide:lock",
    "🛂": "lucide:shield-check",
    "👁️": "lucide:eye",
    "👁️‍🗨️": "lucide:eye",

    // Communication
    "📧": "lucide:mail",
    "✉️": "lucide:mail",
    "📩": "lucide:mail",
    "📨": "lucide:mail-open",
    "📬": "lucide:mailbox",
    "📭": "lucide:mailbox",
    "📮": "lucide:mailbox",
    "💬": "lucide:message-circle",
    "💭": "lucide:message-circle",
    "🗨️": "lucide:message-square",
    "🗯️": "lucide:message-square",
    "📢": "lucide:megaphone",
    "📣": "lucide:megaphone",
    "🔔": "lucide:bell",
    "🔕": "lucide:bell-off",
    "📞": "lucide:phone",
    "📱": "lucide:smartphone",
    "☎️": "lucide:phone",
    "📲": "lucide:smartphone",

    // Media
    "📷": "lucide:camera",
    "📸": "lucide:camera",
    "📹": "lucide:video",
    "🎥": "lucide:video",
    "🎬": "lucide:clapperboard",
    "🎵": "lucide:music",
    "🎶": "lucide:music-2",
    "🎤": "lucide:mic",
    "🎧": "lucide:headphones",
    "🔊": "lucide:volume-2",
    "🔉": "lucide:volume-1",
    "🔈": "lucide:volume",
    "🔇": "lucide:volume-x",
    "▶️": "lucide:play",
    "⏸️": "lucide:pause",
    "⏹️": "lucide:square",
    "⏺️": "lucide:circle",
    "⏭️": "lucide:skip-forward",
    "⏮️": "lucide:skip-back",
    "⏩": "lucide:fast-forward",
    "⏪": "lucide:rewind",
    "🎮": "lucide:gamepad-2",
    "🕹️": "mdi:controller-classic",

    // Navigation & location
    "🌐": "lucide:globe",
    "🌍": "lucide:globe",
    "🌎": "lucide:globe",
    "🌏": "lucide:globe",
    "🏠": "lucide:home",
    "🏡": "lucide:home",
    "🏢": "lucide:building-2",
    "🏬": "lucide:building",
    "🏣": "lucide:building",
    "🏤": "lucide:building",
    "🏥": "mdi:hospital-building",
    "🏦": "mdi:bank",
    "📍": "lucide:map-pin",
    "🗺️": "lucide:map",
    "🧭": "mdi:compass",
    "🚩": "lucide:flag",
    "🏁": "mdi:flag-checkered",
    "🎌": "lucide:flag",

    // Users & social
    "👤": "lucide:user",
    "👥": "lucide:users",
    "👨‍💼": "lucide:user",
    "👩‍💼": "lucide:user",
    "👨‍💻": "lucide:user",
    "👩‍💻": "lucide:user",
    "🧑‍💻": "lucide:user",
    "👨‍🔧": "lucide:user",
    "👩‍🔧": "lucide:user",
    "👨‍🎨": "lucide:user",
    "👩‍🎨": "lucide:user",
    "🤝": "mdi:handshake",
    "👋": "mdi:hand-wave",

    // Commerce & finance
    "💳": "lucide:credit-card",
    "💵": "lucide:banknote",
    "💴": "lucide:banknote",
    "💶": "lucide:banknote",
    "💷": "lucide:banknote",
    "💰": "lucide:coins",
    "💸": "lucide:coins",
    "🛒": "lucide:shopping-cart",
    "🛍️": "lucide:shopping-bag",
    "🏪": "mdi:store",
    "🧾": "mdi:receipt",
    "💹": "lucide:trending-up",
    "💲": "mdi:currency-usd",

    // Time & scheduling
    "⏳": "lucide:hourglass",
    "⌛": "lucide:hourglass",
    "⏰": "mdi:alarm",
    "⏱️": "lucide:timer",
    "⏲️": "lucide:timer",
    "🕐": "lucide:clock",
    "🕑": "lucide:clock",
    "🕒": "lucide:clock",
    "🕓": "lucide:clock",
    "🕔": "lucide:clock",
    "🕕": "lucide:clock",
    "🕖": "lucide:clock",
    "🕗": "lucide:clock",
    "🕘": "lucide:clock",
    "🕙": "lucide:clock",
    "🕚": "lucide:clock",
    "🕛": "lucide:clock",

    // Weather & nature
    "☀️": "lucide:sun",
    "🌞": "lucide:sun",
    "🌙": "lucide:moon",
    "🌛": "lucide:moon",
    "🌜": "lucide:moon",
    "⭐": "lucide:star",
    "🌟": "lucide:star",
    "💫": "lucide:sparkles",
    "☁️": "lucide:cloud",
    "🌧️": "lucide:cloud-rain",
    "⛈️": "lucide:cloud-lightning",
    "🌩️": "lucide:cloud-lightning",
    "🌨️": "lucide:cloud-snow",
    "❄️": "lucide:snowflake",
    "🌊": "lucide:waves",
    "💧": "lucide:droplet",
    "💦": "lucide:droplets",
    "🌱": "lucide:sprout",
    "🌿": "lucide:leaf",
    "🍀": "mdi:clover",
    "🍃": "lucide:leaf",
    "🌲": "mdi:pine-tree",
    "🌳": "mdi:tree",
    "🪴": "mdi:flower",
    "🌸": "mdi:flower",
    "🌺": "mdi:flower",
    "🌻": "mdi:flower",
    "🌼": "mdi:flower",

    // Food (common ones)
    "☕": "lucide:coffee",
    "🍵": "lucide:cup-soda",
    "🍷": "mdi:glass-wine",
    "🍺": "mdi:beer",
    "🍕": "mdi:pizza",
    "🍔": "mdi:hamburger",
    "🍎": "lucide:apple",
    "🍏": "lucide:apple",
    "🎂": "lucide:cake",
    "🍰": "lucide:cake-slice",
    "🍩": "mdi:food-donut",
    "🧁": "lucide:cake",

    // Actions & misc
    "🔄": "lucide:refresh-cw",
    "🔃": "lucide:refresh-cw",
    "🔀": "lucide:shuffle",
    "🔁": "lucide:repeat",
    "🔂": "lucide:repeat-1",
    "↩️": "lucide:undo",
    "↪️": "lucide:redo",
    "📤": "lucide:upload",
    "📥": "lucide:download",
    "🔍": "lucide:search",
    "🔎": "lucide:search",
    "🔗": "lucide:link",
    "⛓️": "lucide:link",
    "➕": "lucide:plus",
    "➖": "lucide:minus",
    "✖️": "lucide:x",
    "➗": "lucide:divide",
    "➡️": "lucide:arrow-right",
    "⬅️": "lucide:arrow-left",
    "⬆️": "lucide:arrow-up",
    "⬇️": "lucide:arrow-down",
    "↗️": "lucide:arrow-up-right",
    "↘️": "lucide:arrow-down-right",
    "↙️": "lucide:arrow-down-left",
    "↖️": "lucide:arrow-up-left",
    "→": "lucide:arrow-right",
    "←": "lucide:arrow-left",
    "↑": "lucide:arrow-up",
    "↓": "lucide:arrow-down",
    "🔙": "lucide:arrow-left",
    "🔚": "lucide:arrow-right",
    "🔛": "lucide:toggle-right",
    "🔜": "lucide:arrow-right",
    "🔝": "lucide:arrow-up",

    // Hearts & love
    "❤️": "lucide:heart",
    "🧡": "lucide:heart",
    "💛": "lucide:heart",
    "💚": "lucide:heart",
    "💙": "lucide:heart",
    "💜": "lucide:heart",
    "🖤": "lucide:heart",
    "🤍": "lucide:heart",
    "🤎": "lucide:heart",
    "💔": "lucide:heart-crack",
    "❤️‍🔥": "lucide:heart",
    "💖": "lucide:heart",
    "💗": "lucide:heart",
    "💓": "lucide:heart-pulse",
    "💕": "mdi:heart-multiple",
    "💞": "lucide:heart",
    "💝": "lucide:gift",
    "👍": "lucide:thumbs-up",
    "👎": "lucide:thumbs-down",

    // Accessibility
    "♿": "lucide:accessibility",

    // Symbols
    "💀": "lucide:skull",
    "☠️": "lucide:skull",
    "⚰️": "lucide:box",
    "🎗️": "mdi:ribbon",
    "🎀": "mdi:ribbon",
    "🎁": "lucide:gift",
    "🧲": "lucide:magnet",
    "🔮": "lucide:circle",
    "🧿": "lucide:eye",
    "🪬": "lucide:eye",
    "💊": "mdi:pill",
    "💉": "mdi:needle",
    "🩺": "mdi:stethoscope",
    "🩹": "mdi:bandage",
    "🏋️": "lucide:dumbbell",
    "🏋️‍♂️": "lucide:dumbbell",
    "🏋️‍♀️": "lucide:dumbbell",
    "⚖️": "lucide:scale",
    "🔨": "mdi:hammer",
    "⚒️": "mdi:pickaxe",
    "⛏️": "mdi:pickaxe",
    "🪓": "mdi:axe",
    "🔪": "lucide:scissors",
    "✂️": "lucide:scissors",
    "🪝": "mdi:hook",
    "⚓": "lucide:anchor",
    "🧲": "mdi:magnet",
    "🔋": "lucide:battery-full",
    "🪫": "lucide:battery-low",
    "🔌": "mdi:power-plug",
    "💡": "lucide:lightbulb",
    "🔦": "mdi:flashlight",
    "🕯️": "lucide:flame",
    "🪔": "lucide:flame",
    "🧯": "mdi:fire-extinguisher",
    "🛢️": "mdi:barrel",
    "💺": "mdi:seat",
    "🪑": "mdi:chair-rolling",
    "🛏️": "mdi:bed",
    "🛋️": "mdi:sofa",
    "🚿": "mdi:shower-head",
    "🛁": "mdi:bathtub",
    "🚽": "mdi:toilet",
    "🧹": "lucide:brush",
    "🧺": "mdi:basket",
    "🧻": "lucide:scroll",
    "🪣": "mdi:bucket",
    "🧼": "lucide:droplet",
    "🫧": "lucide:droplets",
    "🪥": "lucide:brush",
    "🧴": "mdi:bottle-tonic",
    "🧷": "lucide:pin",
    "🧵": "mdi:needle",
    "🧶": "mdi:knitting",
    "🪡": "mdi:needle",
    "👓": "lucide:glasses",
    "🕶️": "lucide:glasses",
    "🥽": "lucide:glasses",
    "🎒": "mdi:bag-personal",
    "👜": "lucide:briefcase",
    "👝": "lucide:wallet",
    "👛": "lucide:wallet",
    "💼": "lucide:briefcase",
    "🧳": "mdi:bag-suitcase",
    "🎓": "mdi:school",
    "🪖": "mdi:hard-hat",
    "⛑️": "mdi:hard-hat",
    "👑": "mdi:crown",
    "🎪": "mdi:tent",
    "⛺": "mdi:tent",
    "🏕️": "mdi:tent",
    "🎠": "mdi:ferris-wheel",
    "🎡": "mdi:ferris-wheel",
    "🎢": "mdi:roller-coaster",

    // Transport
    "🚗": "lucide:car",
    "🚕": "lucide:car-taxi-front",
    "🚙": "lucide:car",
    "🚌": "lucide:bus",
    "🚎": "lucide:bus",
    "🚐": "lucide:bus",
    "🚑": "mdi:ambulance",
    "🚒": "lucide:truck",
    "🚚": "lucide:truck",
    "🚛": "lucide:truck",
    "🚜": "mdi:tractor",
    "🏎️": "lucide:car",
    "🏍️": "lucide:bike",
    "🛵": "lucide:bike",
    "🚲": "lucide:bike",
    "🛴": "lucide:bike",
    "🛹": "mdi:skateboard",
    "✈️": "lucide:plane",
    "🛫": "lucide:plane-takeoff",
    "🛬": "lucide:plane-landing",
    "🚁": "mdi:helicopter",
    "🚀": "lucide:rocket",
    "🛸": "lucide:rocket",
    "🚢": "lucide:ship",
    "⛵": "lucide:sailboat",
    "🛥️": "lucide:ship",
    "🚤": "lucide:ship",
    "🚂": "lucide:train",
    "🚃": "lucide:train",
    "🚄": "lucide:train-front",
    "🚅": "lucide:train-front",
    "🚆": "lucide:train",
    "🚇": "lucide:train",
    "🚈": "lucide:train",
    "🚉": "lucide:train",
    "🚊": "lucide:tram-front",
    "🚝": "lucide:train",
    "🚞": "mdi:train",
    "🚟": "lucide:cable-car",
    "🚠": "lucide:cable-car",
    "🚡": "lucide:cable-car",

    // Animals (common ones used metaphorically)
    "🐝": "mdi:bee",
    "🐞": "mdi:ladybug",
    "🦋": "mdi:butterfly",
    "🐛": "lucide:bug",
    "🐜": "mdi:ant",
    "🦗": "mdi:cricket",
    "🦟": "mdi:mosquito",
    "🕷️": "mdi:spider",
    "🦂": "mdi:scorpion",
    "🐌": "mdi:snail",
    "🐢": "mdi:turtle",
    "🐇": "lucide:rabbit",
    "🦊": "mdi:fox",
    "🐱": "lucide:cat",
    "🐶": "mdi:dog",
    "🐻": "mdi:teddy-bear",
    "🐼": "mdi:panda",
    "🦁": "mdi:lion",
    "🐯": "mdi:cat",
    "🐮": "mdi:cow",
    "🐷": "mdi:pig",
    "🐸": "mdi:frog",
    "🐙": "mdi:octopus",
    "🦑": "mdi:squid",
    "🦐": "mdi:shrimp",
    "🦀": "mdi:crab",
    "🐟": "lucide:fish",
    "🐠": "lucide:fish",
    "🐡": "lucide:fish",
    "🦈": "mdi:shark",
    "🐳": "mdi:whale",
    "🐋": "mdi:whale",
    "🐬": "mdi:dolphin",
    "🐦": "lucide:bird",
    "🐧": "mdi:penguin",
    "🦅": "mdi:bird",
    "🦆": "mdi:duck",
    "🦉": "mdi:owl",
    "🦇": "mdi:bat",
    "🐴": "mdi:horse",
    "🦄": "mdi:unicorn",
    "🐺": "mdi:wolf",
    "🐗": "mdi:pig",
    "🐘": "mdi:elephant",
    "🦏": "mdi:rhino",
    "🦛": "mdi:hippo",
    "🐪": "mdi:camel",
    "🐫": "mdi:camel",
    "🦒": "mdi:giraffe",
    "🦘": "mdi:kangaroo",
    "🐒": "mdi:monkey",
    "🦍": "mdi:gorilla",
    "🦧": "mdi:orangutan",
    "🐕": "mdi:dog",
    "🐩": "mdi:dog",
    "🐈": "lucide:cat",
    "🐓": "mdi:rooster",
    "🦃": "mdi:turkey",
    "🦚": "mdi:peacock",
    "🦜": "mdi:parrot",
    "🦢": "mdi:bird",
    "🦩": "mdi:flamingo",
    "🕊️": "mdi:dove",
    "🐁": "mdi:rodent",
    "🐀": "mdi:rodent",
    "🐿️": "mdi:squirrel",
    "🦔": "mdi:hedgehog",
  };

  function render_markdown(text: string): string {
    // Replace overly enthusiastic/apologetic phrases with neutral tone
    let processed = text;
    processed = processed.replace(/You're absolutely right!?/gi, "That's correct.");
    processed = processed.replace(/Absolutely right!?/gi, "Correct.");

    // Replace emojis with icon markers before markdown parsing
    for (const [emoji, icon] of Object.entries(emoji_to_icon)) {
      const escaped = emoji.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      processed = processed.replace(
        new RegExp(escaped, "gu"),
        `[[ICON::${icon}]]`
      );
    }

    // Clean up excessive whitespace
    const cleaned = processed.replace(/\n{3,}/g, "\n\n").trim();

    // Parse markdown
    let html = marked.parse(cleaned) as string;

    // Replace icon markers with iconify-icon web components
    html = html.replace(
      /\[\[ICON::([^\]]+)\]\]/g,
      '<iconify-icon icon="$1" style="vertical-align: -0.125em;color:var(--builder-accent)"></iconify-icon>'
    );

    return html;
  }

  // Detect if current theme is light (for conditional prose styling)
  let is_light_theme = $derived($current_builder_theme?.id === "light");

  // Prose classes that adapt to theme
  let prose_classes = $derived(
    is_light_theme
      ? "prose prose-sm prose-pre:bg-black/5 prose-pre:border prose-pre:border-black/10 prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-p:my-2 prose-headings:my-2 max-w-none"
      : "prose prose-invert prose-sm prose-pre:bg-white/[0.025] prose-pre:border prose-pre:border-white/10 prose-code:before:content-none prose-code:after:content-none prose-headings:font-semibold prose-p:my-2 prose-headings:my-2 max-w-none"
  );

  // Message bubble background that adapts to theme
  let bubble_bg = $derived(
    is_light_theme ? "bg-black/[0.025]" : "bg-white/[0.025]"
  );

  type AgentPanelProps = {
    messages: Message[];
    is_processing: boolean;
    is_loading_messages: boolean;
    vibe_zone_enabled: boolean;
    vibe_zone_visible: boolean;
    vibe_user_prompt: string;
    preview_errors: PreviewError[];
    pending_prompt: PendingPrompt | null;
    on_navigate_to_field: (tab: string, field_name?: string) => void;
    on_config_subtab_change: (subtab: "env" | "endpoints") => void;
    on_file_select: (path: string) => void;
    on_load_data_files: () => Promise<void>;
    on_load_config: () => Promise<void>;
    on_refresh_preview: () => void;
    on_vibe_lounge_toggle: () => void;
    on_vibe_dismiss: () => void;
    on_pending_prompt_consumed: () => void;
    on_code_written: (content: string) => void;
  };

  let {
    messages = $bindable(),
    is_processing = $bindable(),
    is_loading_messages,
    vibe_zone_enabled,
    vibe_zone_visible = $bindable(),
    vibe_user_prompt = $bindable(),
    preview_errors = $bindable(),
    pending_prompt = null,
    on_navigate_to_field,
    on_config_subtab_change,
    on_file_select,
    on_load_data_files,
    on_load_config,
    on_refresh_preview,
    on_vibe_lounge_toggle,
    on_vibe_dismiss,
    on_pending_prompt_consumed,
    on_code_written,
  }: AgentPanelProps = $props();

  let agent_input = $state("");
  let message_container: HTMLDivElement;
  let input_element: HTMLTextAreaElement;

  // localStorage key for persisting draft input
  const draft_key = `tinykit:agent-draft:${project_id}`
  let auto_scroll = $state(true);
  let show_welcome_vibe = $state(false);
  let welcome_timer: ReturnType<typeof setTimeout> | null = null;
  let file_being_written = $state<string | null>(null);
  let tool_in_progress = $state<string | null>(null);
  let previous_message_length = $state(0);
  let user_dismissed_vibe = $state(false);
  let current_usage = $state<TokenUsage | null>(null);

  // Sync vibe zone visibility to parent (for rendering over preview)
  $effect(() => {
    vibe_zone_visible = vibe_zone_enabled && (show_welcome_vibe || is_processing) && !user_dismissed_vibe;
  });

  // Handle dismiss from parent (when user closes vibe zone)
  export function dismiss_vibe() {
    show_welcome_vibe = false;
    user_dismissed_vibe = true;
    if (welcome_timer) {
      clearTimeout(welcome_timer);
      welcome_timer = null;
    }
  }

  onMount(() => {
    input_element?.focus()
    // Scroll to bottom when mounting (switching to this tab)
    scroll_to_bottom()
    // Restore draft from localStorage
    const saved_draft = localStorage.getItem(draft_key)
    if (saved_draft) {
      agent_input = saved_draft
      // Trigger auto-resize after restoring
      setTimeout(() => auto_resize_input(), 0)
    }
  })

  // Save draft to localStorage when input changes
  $effect(() => {
    if (agent_input) {
      localStorage.setItem(draft_key, agent_input)
    } else {
      localStorage.removeItem(draft_key)
    }
  })

  // Scroll to bottom when messages change
  $effect(() => {
    if (messages.length > 0) {
      scroll_to_bottom();
    }
  });

  // Track hidden prompt instructions (for fix error, etc.)
  let pending_full_prompt = $state<string | null>(null);

  // Handle pending prompt from external sources (e.g., fix error button)
  $effect(() => {
    if (pending_prompt && !is_processing) {
      // Show display version to user, store full version for API
      agent_input = pending_prompt.display;
      pending_full_prompt = pending_prompt.full;
      on_pending_prompt_consumed();
      // Small delay to ensure state is updated before sending
      setTimeout(() => send_message(), 50);
    }
  });

  function handle_keydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send_message();
    }
    // cmd-n to clear conversation
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      clear_messages();
    }
  }

  function auto_resize_input() {
    if (!input_element) return;
    input_element.style.height = "auto";
    input_element.style.height = `${input_element.scrollHeight}px`;
  }

  function scroll_to_bottom() {
    if (message_container && auto_scroll) {
      setTimeout(() => {
        if (message_container) {
          message_container.scrollTop = message_container.scrollHeight
        }
      }, 100)
    }
  }

  function handle_message_scroll() {
    if (!message_container) return;

    const threshold = 50;
    const scroll_top = message_container.scrollTop;
    const scroll_height = message_container.scrollHeight;
    const client_height = message_container.clientHeight;

    const is_at_bottom = scroll_height - scroll_top - client_height < threshold;
    auto_scroll = is_at_bottom;
  }

  async function send_message() {
    if (!agent_input.trim() || is_processing) return;

    const display_prompt = agent_input.trim();
    // Use full prompt if available (e.g., fix error with hidden instructions), otherwise use display
    const api_prompt = pending_full_prompt || display_prompt;
    pending_full_prompt = null; // Clear after use

    vibe_user_prompt = display_prompt;
    agent_input = "";
    is_processing = true;
    user_dismissed_vibe = false;
    current_usage = null;
    // Reset textarea height
    if (input_element) {
      input_element.style.height = "auto";
    }

    // Show display version to user
    messages = [...messages, { role: "user", content: display_prompt }];
    scroll_to_bottom();

    try {
      // Include preview errors in context if any
      const errors_context =
        preview_errors.length > 0
          ? `\n\n[Preview errors detected:\n${preview_errors.map((e) => `- ${e.type}: ${e.message}${e.line ? ` (line ${e.line})` : ""}`).join("\n")}\n]`
          : "";

      preview_errors = []; // Clear errors after including

      // Fetch the current spec
      let spec = "";
      try {
        spec = await load_spec(project_id);
      } catch (err) {
        console.error("Failed to fetch spec:", err);
      }

      // Send full prompt to API (may include hidden instructions)
      const response = await send_prompt(
        project_id,
        [...messages.slice(0, -1), { role: "user", content: api_prompt + errors_context }],
        spec
      );

      if (!response.ok) {
        const error_data = await response.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(error_data.error || `Failed to get response from agent (${response.status})`)
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      let assistant_message = { role: "assistant" as const, content: "" };
      let raw_content = "";
      messages = [...messages, assistant_message];
      previous_message_length = 0;

      // Track streaming code blocks and tool results
      let current_code_block: {
        filename: string;
        language: string;
        content: string;
      } | null = null;
      type ToolResult = { name: string; result: string };
      let displayed_tool_results = new Set<string>();
      let accumulated_tool_results: ToolResult[] = [];

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6));

              // Handle stream errors
              if (data.error) {
                throw new Error(data.error);
              }

              if (data.chunk) {
                raw_content += data.chunk;

                // Extract code blocks and write incrementally
                const code_block_start = /```(\w+):([^\n]+)\n/g;
                const match = code_block_start.exec(raw_content);

                // Note: Code blocks with filename (```svelte:App.svelte) are NO LONGER
                // written here. The LLM uses the write_code tool instead, which is
                // executed server-side. We only track code blocks for UI purposes.
                if (match && !current_code_block) {
                  current_code_block = {
                    language: match[1],
                    filename: match[2].trim(),
                    content: "",
                  };
                  // Only show "writing" indicator for legacy code blocks
                  // The write_code tool has its own indicator
                  file_being_written = current_code_block.filename;
                }

                if (current_code_block) {
                  const block_start_index = raw_content.indexOf(
                    "```" +
                      current_code_block.language +
                      ":" +
                      current_code_block.filename
                  );
                  const content_start_index =
                    raw_content.indexOf("\n", block_start_index) + 1;
                  const block_end_index = raw_content.indexOf(
                    "```",
                    content_start_index
                  );

                  if (block_end_index !== -1) {
                    // Block complete - just clear tracking state
                    // Code is written via write_code tool, not here
                    file_being_written = null;
                    current_code_block = null;
                  } else if (content_start_index > 0) {
                    current_code_block.content =
                      raw_content.substring(content_start_index);
                  }
                }

                // Strip tool calls and code blocks from display
                // Pass accumulated results so they get placed inline
                const tool_cleaned = strip_tool_calls(
                  raw_content,
                  accumulated_tool_results
                );
                tool_in_progress = tool_cleaned.in_progress_tool;
                const { cleaned, active_blocks } = strip_code_blocks(
                  tool_cleaned.cleaned
                );

                let display_content = cleaned;

                // Append active code blocks
                if (active_blocks.length > 0) {
                  display_content +=
                    "\n\n" +
                    active_blocks
                      .map((b) => `📝 Writing ${b.filename}...`)
                      .join("\n");
                }

                messages[messages.length - 1].content = display_content;
                previous_message_length = cleaned.length;
                messages = messages;
                scroll_to_bottom();
              }

              // Handle incremental tool results (during streaming)
              if (data.incremental && data.toolResult) {
                // Track this result with its tool name
                const tool_name = data.toolCall?.name || "unknown";
                displayed_tool_results.add(data.toolResult);
                accumulated_tool_results.push({
                  name: tool_name,
                  result: data.toolResult,
                });

                // Rebuild content with new result (same logic as chunk handler)
                // Results will be placed inline where their <tool> blocks were
                const tool_cleaned = strip_tool_calls(
                  raw_content,
                  accumulated_tool_results
                );
                tool_in_progress = tool_cleaned.in_progress_tool;
                const { cleaned, active_blocks } = strip_code_blocks(
                  tool_cleaned.cleaned
                );

                let display_content = cleaned;

                // Append active code blocks
                if (active_blocks.length > 0) {
                  display_content +=
                    "\n\n" +
                    active_blocks
                      .map((b) => `📝 Writing ${b.filename}...`)
                      .join("\n");
                }

                messages[messages.length - 1].content = display_content;
                messages = messages;
                scroll_to_bottom();

                // Check if content/design/data was created - notify Preview to update
                const config_tools = [
                  "create_content_field",
                  "create_design_field",
                  "create_data_file",
                  "insert_records",
                ];
                if (
                  data.toolCall &&
                  config_tools.includes(data.toolCall.name)
                ) {
                  // Refresh data files list
                  await on_load_data_files();
                  window.dispatchEvent(
                    new CustomEvent("tinykit:config-updated")
                  );
                }

                // Check if write_code tool was called - update preview with new content
                if (data.toolCall && data.toolCall.name === "write_code") {
                  const code = data.toolCall.parameters?.code;
                  if (code) {
                    on_code_written(code);
                  }
                  on_refresh_preview();
                }
              }

              // Handle batch tool results (for backwards compatibility)
              if (data.toolCalls && data.toolResults) {
                // Add any new results, paired with their tool names
                for (let i = 0; i < data.toolResults.length; i++) {
                  const result = data.toolResults[i];
                  const tool_name = data.toolCalls[i]?.name || "unknown";
                  if (!displayed_tool_results.has(result)) {
                    displayed_tool_results.add(result);
                    accumulated_tool_results.push({
                      name: tool_name,
                      result: result,
                    });
                  }
                }

                // Rebuild with all results placed inline
                const tool_cleaned = strip_tool_calls(
                  raw_content,
                  accumulated_tool_results
                );
                tool_in_progress = tool_cleaned.in_progress_tool;
                const { cleaned, active_blocks } = strip_code_blocks(
                  tool_cleaned.cleaned
                );

                let display_content = cleaned;

                // Append active code blocks
                if (active_blocks.length > 0) {
                  display_content +=
                    "\n\n" +
                    active_blocks
                      .map((b) => `📝 Writing ${b.filename}...`)
                      .join("\n");
                }

                messages[messages.length - 1].content = display_content;
                messages = messages;
                scroll_to_bottom();

                // Check if any content/design/data was created
                const config_tools = [
                  "create_content_field",
                  "create_design_field",
                  "create_data_file",
                  "insert_records",
                ];
                const has_config_changes = data.toolCalls.some((call: any) =>
                  config_tools.includes(call.name)
                );
                if (has_config_changes) {
                  // Refresh data files list and notify preview to reload
                  await on_load_data_files();
                  window.dispatchEvent(
                    new CustomEvent("tinykit:config-updated")
                  );
                }

                // Check if write_code was called
                const write_code_call = data.toolCalls.find(
                  (call: any) => call.name === "write_code"
                );
                if (write_code_call) {
                  const code = write_code_call.parameters?.code;
                  if (code) {
                    on_code_written(code);
                  }
                  on_refresh_preview();
                }
              }

              // Handle completion with usage data
              if (data.done && data.usage) {
                current_usage = data.usage;
                // Attach usage to the last assistant message
                if (
                  messages.length > 0 &&
                  messages[messages.length - 1].role === "assistant"
                ) {
                  messages[messages.length - 1].usage = data.usage;
                  messages = messages;
                }
              }
            }
          }
        }
      }

      // Show welcome vibe for 6 seconds
      if (vibe_zone_enabled) {
        show_welcome_vibe = true;
        welcome_timer = setTimeout(() => {
          show_welcome_vibe = false;
        }, 6000);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      const error_message = error instanceof Error ? error.message : String(error)
      messages = [...messages, {
        role: "assistant",
        content: `Error: ${error_message}`,
      }];
    } finally {
      is_processing = false;
      file_being_written = null;
      tool_in_progress = null;
    }
  }

  async function clear_messages() {
    if (confirm("Clear all messages?")) {
      messages = [];
      try {
        await clear_conversation(project_id);
      } catch (error) {
        console.error("Failed to clear agent history:", error);
      }
    }
  }

  // Helper functions for stripping tool calls and code blocks
  type ToolResultItem = { name: string; result: string };

  // Extract field name from tool result string
  function extract_field_name(
    tool_name: string,
    result: string
  ): string | null {
    if (tool_name === "create_content_field") {
      // Pattern: Created content field "FIELD_NAME" ...
      const match = result.match(/Created content field "([^"]+)"/);
      return match ? match[1] : null;
    }
    if (tool_name === "create_design_field") {
      // Pattern: Created {type} design field "FIELD_NAME" ...
      // e.g. "Created color design field "Primary Color" (--color-primary)"
      const match = result.match(/Created \w+ design field "([^"]+)"/);
      return match ? match[1] : null;
    }
    if (tool_name === "create_data_file") {
      // Pattern: Created collection "COLLECTION_NAME" with X records...
      const match = result.match(/Created collection "([^"]+)"/);
      return match ? match[1] : null;
    }
    if (tool_name === "insert_records") {
      // Pattern: Inserted X records into "COLLECTION_NAME"...
      const match = result.match(/into "([^"]+)"/);
      return match ? match[1] : null;
    }
    return null;
  }

  function strip_tool_calls(
    text: string,
    completed_results: ToolResultItem[] = []
  ): {
    cleaned: string;
    has_incomplete_tool: boolean;
    in_progress_tool: string | null;
    inline_results: ToolResultItem[];
  } {
    let cleaned = text;
    let result_index = 0;
    const inline_results: ToolResultItem[] = [];

    // Replace completed tool blocks with markers, track which results are used
    cleaned = cleaned.replace(
      /<tool>[\s\S]*?<\/tool>/g,
      (match, offset, fullString) => {
        if (result_index < completed_results.length) {
          const tool_result = completed_results[result_index++];
          inline_results.push(tool_result);
          // Check if there's a newline after the closing tag
          const nextChar = fullString[offset + match.length];
          const needsTrailingNewline = nextChar && nextChar !== "\n";

          // Extract field name for content/design/data tools
          const field_name = extract_field_name(
            tool_result.name,
            tool_result.result
          );
          const marker_suffix = field_name ? `:${field_name}` : "";

          return (
            "\n\n~~~tool:" +
            tool_result.name +
            marker_suffix +
            "~~~" +
            (needsTrailingNewline ? "\n\n" : "")
          );
        }
        // This tool hasn't completed yet, remove it
        return "";
      }
    );

    // Detect which tool is currently in progress (incomplete block)
    let in_progress_tool: string | null = null;
    const has_incomplete_tool = cleaned.includes("<tool>");
    if (has_incomplete_tool) {
      const incomplete_start = cleaned.indexOf("<tool>");
      const incomplete_block = cleaned.substring(incomplete_start);
      const name_match = incomplete_block.match(/<name>(\w+)<\/name>/);
      if (name_match) {
        in_progress_tool = name_match[1];
      }
      cleaned = cleaned.substring(0, incomplete_start).trim();
    }

    cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
    return { cleaned, has_incomplete_tool, in_progress_tool, inline_results };
  }

  function strip_code_blocks(text: string): {
    cleaned: string;
    active_blocks: Array<{ filename: string; language: string }>;
  } {
    // First, check for incomplete blocks BEFORE removing complete ones
    const active_blocks: Array<{ filename: string; language: string }> = [];
    const incomplete_block_regex = /```(\w+):([^\n]+)(?!\n[\s\S]*?```)/g;
    let incomplete_block_start = -1;

    let match;
    while ((match = incomplete_block_regex.exec(text)) !== null) {
      active_blocks.push({
        language: match[1],
        filename: match[2].trim(),
      });
      if (incomplete_block_start === -1) {
        incomplete_block_start = match.index;
      }
    }

    // Replace complete code blocks with markers (preserves text after block)
    let cleaned = text
      .replace(/```[\w]+:[^\n]+\n[\s\S]*?```/g, "\n\n~~~code~~~\n\n")
      .trim();

    // If there's an incomplete block, truncate at its position
    if (incomplete_block_start !== -1) {
      cleaned = text.substring(0, incomplete_block_start).trim();
    }

    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    return { cleaned, active_blocks };
  }
</script>

<div
  in:fade={{ duration: 100, delay: 100 }}
  class="h-full flex flex-col text-sm relative"
>
  <!-- Message History -->
  <div
    bind:this={message_container}
    onscroll={handle_message_scroll}
    class="flex-1 overflow-y-auto p-3 space-y-3"
  >
    {#if is_loading_messages}
      <div
        class="flex flex-col items-center justify-center py-12 text-[var(--builder-text-secondary)]"
      >
        <div
          class="w-8 h-8 border-2 border-[var(--builder-accent)]/90 border-t-[var(--builder-accent)] rounded-full animate-spin mb-3"
        ></div>
        <p class="text-sm">Loading conversation...</p>
      </div>
    {:else if messages.length === 0}
      <div class="text-[var(--builder-text-secondary)] text-center py-12">
        <p class="text-lg font-medium text-[var(--builder-text-primary)]">
          Welcome to tinykit
        </p>
        <p class="mt-2">Describe what you want to build...</p>
      </div>
    {:else}
      {#each messages as message, idx}
        <div
          in:fade
          class="relative space-y-1 {bubble_bg} p-4 rounded-sm {message.role ===
          'user'
            ? 'border-l-2 border-l-[var(--builder-accent)]'
            : ''}"
        >
          <div class="text-[var(--builder-text-secondary)] text-xs">
            {message.role === "user" ? "You" : "Agent"}
          </div>
          <div class="text-[var(--builder-text-primary)]">
            {#if message.role === "user"}
              <div class={prose_classes}>
                {@html render_markdown(message.content)}
              </div>
            {:else}
              {@const writing_parts =
                message.content.split(/\n\n(?=📝 Writing)/)}
              {@const code_parts = writing_parts[0].split(/\n\n(?=~~~code~~~)/)}
              {@const tool_parts = code_parts[0].split(/\n+(?=~~~tool:)/)}
              {@const main_text = tool_parts[0]}
              {@const is_streaming =
                idx === messages.length - 1 && is_processing}
              {@const should_animate =
                is_streaming &&
                main_text.length > previous_message_length &&
                previous_message_length > 0}
              {@const old_text = should_animate
                ? main_text.substring(0, previous_message_length)
                : main_text}
              {@const new_text = should_animate
                ? main_text.substring(previous_message_length)
                : ""}
              <div class={prose_classes}>
                {@html render_markdown(old_text)}
                {#if new_text}
                  <span in:fade class="streaming-text">
                    {@html render_markdown(new_text)}
                  </span>
                {/if}
              </div>
              {#if tool_parts.length > 1}
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {#each tool_parts.slice(1) as tool_marker}
                    {@const tool_match = tool_marker.match(
                      /^~~~tool:(\w+)(?::([^~]+))?~~~/
                    )}
                    {@const tool_name = tool_match ? tool_match[1] : "unknown"}
                    {@const field_name = tool_match ? tool_match[2] : null}
                    {@const remaining_text = tool_marker
                      .replace(/^~~~tool:\w+(?::[^~]+)?~~~\n*/, "")
                      .trim()}

                    {#if tool_name === "update_spec"}
                      <!-- Spec updates are silent - no UI shown -->
                    {:else if tool_name === "create_content_field"}
                      <button
                        in:fade
                        onclick={() => {
                          on_load_config();
                          on_navigate_to_field("content", field_name || undefined);
                        }}
                        class="tool-button tool-button--content tool-button--interactive"
                      >
                        <FileText class="w-3 h-3" />
                        <span>{field_name || "Content"}</span>
                      </button>
                    {:else if tool_name === "create_design_field"}
                      <button
                        in:fade
                        onclick={() => {
                          on_load_config();
                          on_navigate_to_field("design", field_name || undefined);
                        }}
                        class="tool-button tool-button--design tool-button--interactive"
                      >
                        <Palette class="w-3 h-3" />
                        <span>{field_name || "Design"}</span>
                      </button>
                    {:else if tool_name === "create_data_file" || tool_name === "insert_records"}
                      <button
                        onclick={() => {
                          on_navigate_to_field("data", field_name || undefined);
                          on_load_data_files();
                        }}
                        class="tool-button tool-button--data tool-button--interactive"
                      >
                        <Database class="w-3 h-3" />
                        <span>{field_name || "Data"}</span>
                      </button>
                    {:else if tool_name === "write_code"}
                      <button
                        in:fade
                        onclick={() => {
                          on_navigate_to_field("code");
                        }}
                        class="tool-button tool-button--code tool-button--interactive"
                      >
                        <Code class="w-3 h-3" />
                        <span>Code</span>
                      </button>
                    {:else}
                      <div
                        in:fade
                        class="tool-button tool-button--success"
                      >
                        <iconify-icon icon="lucide:check" class="w-3 h-3"
                        ></iconify-icon>
                        <span>{tool_name}</span>
                      </div>
                    {/if}

                    <!-- Display any text that follows this tool result -->
                    {#if remaining_text}
                      <div class="w-full mt-2 {prose_classes}">
                        {@html render_markdown(remaining_text)}
                      </div>
                    {/if}
                  {/each}
                </div>
              {/if}
              {#if code_parts.length > 1}
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {#each code_parts.slice(1) as code_marker}
                    <button
                      onclick={() => {
                        on_navigate_to_field("code");
                      }}
                      class="tool-button tool-button--code tool-button--interactive"
                    >
                      <Code class="w-3 h-3" />
                      <span>Code</span>
                    </button>
                  {/each}
                </div>
              {/if}
              {#if is_streaming && tool_in_progress === "write_code"}
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <button
                    onclick={() => {
                      on_navigate_to_field("code");
                    }}
                    class="tool-button tool-button--code tool-button--interactive"
                  >
                    <Spinner size="sm" />
                    <span>Code</span>
                  </button>
                </div>
              {/if}
              {#if writing_parts.length > 1}
                <div class="mt-2 flex flex-wrap gap-1.5">
                  {#each writing_parts.slice(1) as writing_line}
                    {@const is_being_written =
                      file_being_written ===
                      writing_line
                        .replace("📝 Writing ", "")
                        .replace(/\.\.\.$/, "")
                        .trim()}
                    <button
                      onclick={() => {
                        on_navigate_to_field("code");
                        on_file_select(`${project_id}/src/App.svelte`);
                      }}
                      class="tool-button tool-button--code tool-button--interactive"
                    >
                      {#if is_being_written}
                        <Spinner size="sm" />
                      {:else}
                        <Code class="w-3 h-3" />
                      {/if}
                      <span>Code</span>
                    </button>
                  {/each}
                </div>
              {/if}
              <!-- Token usage display for assistant messages -->
              {#if message.usage && !is_streaming}
                <div class="absolute bottom-2 right-3">
                  <TokenCost usage={message.usage} />
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
      {#if is_processing}
        <div class="pl-1 text-[var(--builder-text-secondary)]">
          <span in:fade class="animate-pulse">Inferring...</span>
        </div>
      {/if}
    {/if}
  </div>

  <!-- Input Area -->
  <div class="border-t border-[var(--builder-border)]">
    {#if messages.length > 0}
      <div class="border-b border-[var(--builder-border)] px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onclick={clear_messages}
          class="text-xs font-sans text-[var(--builder-text-secondary)]"
        >
          Clear conversation
        </Button>
      </div>
    {/if}
    <div class="p-4">
      <div class="flex items-start gap-2">
        <span class="text-[var(--builder-accent)] pt-0.5 hidden sm:block">></span>
        <textarea
          bind:this={input_element}
          bind:value={agent_input}
          onkeydown={handle_keydown}
          oninput={auto_resize_input}
          placeholder="Make a todo list"
          class="mt-[3px] flex-1 bg-transparent text-[var(--builder-text-primary)] placeholder:text-[var(--builder-text-secondary)] placeholder:opacity-50 focus:outline-none font-sans resize-none overflow-hidden min-h-[1.5rem] max-h-[12rem]"
          disabled={is_processing}
          rows="1"
        ></textarea>
        <button
          onclick={send_message}
          disabled={is_processing || !agent_input.trim()}
          class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors {agent_input.trim() && !is_processing
            ? 'bg-[var(--builder-accent)] text-white'
            : 'bg-[var(--builder-bg-tertiary)] text-[var(--builder-text-secondary)]'}"
        >
          <ArrowUp class="w-4 h-4" />
        </button>
      </div>
    </div>

  </div>
</div>

<style>
  .streaming-text {
    animation: fadeIn 0.3s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Tool button base styles */
  .tool-button {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    line-height: 1rem;
    border: 1px solid;
    transition: background-color 0.15s, border-color 0.15s;
  }

  .tool-button--interactive {
    cursor: pointer;
  }

  /* Code tool (orange - primary accent) */
  .tool-button--code {
    background: color-mix(in srgb, var(--tool-code) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-code) 20%, transparent);
    color: var(--tool-code);
  }
  .tool-button--code.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-code) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-code) 30%, transparent);
  }

  /* Content tool (green) */
  .tool-button--content {
    background: color-mix(in srgb, var(--tool-content) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-content) 20%, transparent);
    color: var(--tool-content);
  }
  .tool-button--content.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-content) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-content) 30%, transparent);
  }

  /* Design tool (purple) */
  .tool-button--design {
    background: color-mix(in srgb, var(--tool-design) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-design) 20%, transparent);
    color: var(--tool-design);
  }
  .tool-button--design.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-design) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-design) 30%, transparent);
  }

  /* Data tool (indigo) */
  .tool-button--data {
    background: color-mix(in srgb, var(--tool-data) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-data) 20%, transparent);
    color: var(--tool-data);
  }
  .tool-button--data.tool-button--interactive:hover {
    background: color-mix(in srgb, var(--tool-data) 20%, transparent);
    border-color: color-mix(in srgb, var(--tool-data) 30%, transparent);
  }

  /* Success/confirmation (emerald) */
  .tool-button--success {
    background: color-mix(in srgb, var(--tool-success) 10%, transparent);
    border-color: color-mix(in srgb, var(--tool-success) 20%, transparent);
    color: var(--tool-success);
  }

  /* Prevent iOS zoom on input focus */
  textarea {
    font-size: 16px;
  }

  @media (min-width: 768px) {
    textarea {
      font-size: inherit;
    }
  }

  /* Simple code block styling (no syntax highlighting) */
  :global(.prose pre) {
    background: var(--builder-bg-tertiary) !important;
    border: 1px solid var(--builder-border) !important;
    border-radius: 0.25rem;
    margin: 0.5rem 0;
    padding: 1rem;
    overflow-x: auto;
  }

  :global(.prose pre code) {
    font-size: 0.875rem;
    line-height: 1.5;
    background: transparent !important;
    color: var(--builder-text-primary);
    font-family: "Monaco", "Menlo", "Ubuntu Mono", "Courier New", monospace;
  }
</style>
