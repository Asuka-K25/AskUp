(function (root) {
  const englishWords = [
    "ass", "asses", "asshole", "assholes", "badass", "bastard", "bastards", "bitch", "bitches", "bitching",
    "bollocks", "bullshit", "bullshitting", "cock", "cocks", "cocksucker", "crap", "cunt", "cunts", "damn",
    "dick", "dicks", "dickhead", "dipshit", "dumb", "dumbass", "dumbasses", "fuck", "fucked", "fucker",
    "fuckers", "fuckface", "fucking", "idiot", "idiots", "jackass", "jackasses", "moron", "morons",
    "motherfucker", "motherfuckers", "nigger", "niggers", "piss", "pissed", "prick", "pricks", "pussy",
    "retard", "retarded", "retards", "shit", "shithead", "shitheads", "shitty", "slut", "sluts", "stupid",
    "twat", "wanker", "whore", "whores"
  ];
  const arabicWords = [
    "احا", "اخرس", "اخرسي", "اهبل", "اهبلة", "حمار", "حمارة", "خرا", "خرى", "زق", "زفت", "زب",
    "زبي", "زبك", "سافل", "سافلة", "شرموط", "شرموطة", "عرص", "عاهرة", "عاهره", "غبي", "غبية",
    "قحبة", "قحبه", "قواد", "كسمك", "كس", "كلب", "كلبة", "لعنة", "لعنه", "متناك", "متناكة",
    "منيوك", "نيك", "طيز", "طيزك"
  ];
  const arabicPhrases = [
    "ابن الكلب", "ابن كلب", "ابن القحبة", "ابن القحبه", "ابن الشرموطة", "ابن شرموطة",
    "كس امك", "كس اختك", "يلعن امك", "يلعن ابوك"
  ];
  const substitutions = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

  function normalizeArabic(text) {
    return String(text).toLowerCase().normalize("NFKD")
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
      .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  }

  function separatedWordPattern(word) {
    return [...word].join("[^\\p{L}]*");
  }

  function containsFoulLanguage(text = "") {
    const normalized = String(text).toLowerCase().normalize("NFKD")
      .replace(/[013457@$!]/g, character => substitutions[character]);
    if (englishWords.some(word => new RegExp(`\\b${separatedWordPattern(word)}\\b`, "iu").test(normalized))) return true;

    const arabic = normalizeArabic(text);
    const hasArabicWord = arabicWords.some(word => new RegExp(`(^|[^\\p{L}])${separatedWordPattern(normalizeArabic(word))}($|[^\\p{L}])`, "iu").test(arabic));
    const compactArabic = arabic.replace(/[^\p{Script=Arabic}]/gu, "");
    return hasArabicWord || arabicPhrases.some(phrase => compactArabic.includes(normalizeArabic(phrase).replace(/\s/g, "")));
  }

  const api = { containsFoulLanguage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.AskUpModeration = api;
})(typeof globalThis === "undefined" ? window : globalThis);
