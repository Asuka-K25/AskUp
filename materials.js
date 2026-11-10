const zlib = require("zlib");

const stopWords = new Set((
  "the and for with from this that what when where which who why how can could would should does did are is was were " +
  "into about have has had your our their there then than also more some any explain example please again lecture class " +
  "من في على الى عن هذا هذه ذلك التي الذي ماذا متى اين كيف لماذا هل مع ثم او اي شرح مثال محاضرة مادة"
).split(/\s+/));

function decodeEntities(text) {
  return text.replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function xmlToText(xml) {
  return decodeEntities(xml.replace(/<(?:w:tab|a:br|w:br)[^>]*\/?\s*>/g, " ").replace(/<[^>]+>/g, " "));
}

function unzipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === eocdSignature) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("This Office file is not a valid ZIP document.");

  const entries = [];
  let offset = buffer.readUInt32LE(eocd + 16);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let expandedBytes = 0;
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("This Office file has an invalid directory.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    expandedBytes += uncompressedSize;
    if (expandedBytes > 30_000_000) throw new Error("The expanded document is too large.");

    if (!name.endsWith("/")) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const data = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed) : null;
      if (data) entries.push({ name, data });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodePdfString(value) {
  return value.replace(/\\([nrtbf()\\])/g, (_, character) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[character])
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function extractPdfText(buffer) {
  const binary = buffer.toString("latin1");
  const sources = [binary];
  const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamPattern.exec(binary))) {
    const dictionary = binary.slice(Math.max(0, match.index - 300), match.index);
    if (!/\/FlateDecode/.test(dictionary)) continue;
    try { sources.push(zlib.inflateSync(Buffer.from(match[1], "latin1")).toString("latin1")); }
    catch { /* Some PDF streams use unsupported filters; other streams may still contain text. */ }
  }

  const output = [];
  const collectStrings = source => {
    const textPattern = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let textMatch;
    while ((textMatch = textPattern.exec(source))) output.push(decodePdfString(textMatch[1]));
    const arrayPattern = /\[([\s\S]*?)\]\s*TJ/g;
    let arrayMatch;
    while ((arrayMatch = arrayPattern.exec(source))) {
      const partPattern = /\(((?:\\.|[^\\)])*)\)/g;
      let part;
      while ((part = partPattern.exec(arrayMatch[1]))) output.push(decodePdfString(part[1]));
    }
  };
  sources.forEach(collectStrings);
  return output.join(" ");
}

function extractMaterialText(buffer, filename) {
  const extension = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  let text = "";
  if (extension === ".docx") {
    text = unzipEntries(buffer).filter(entry => /^word\/(?:document|header\d*|footer\d*)\.xml$/.test(entry.name))
      .map(entry => xmlToText(entry.data.toString("utf8"))).join(" ");
  } else if (extension === ".pptx") {
    text = unzipEntries(buffer).filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(entry => xmlToText(entry.data.toString("utf8"))).join(" ");
  } else if (extension === ".pdf") {
    text = extractPdfText(buffer);
  } else {
    throw new Error("Upload a PDF, PowerPoint (.pptx), or Word (.docx) file.");
  }

  text = text.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 750_000);
  if (text.length < 20) throw new Error("AskUp could not extract readable text. Try exporting the document again with selectable text.");
  return text;
}

function normalize(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي");
}

function normalizedQuestion(text) {
  return normalize(text).replace(/0/g, "o").replace(/[1!]/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\b(?:u|yu)\b/g, "you").replace(/\bur\b/g, "your").replace(/\s+/g, " ").trim();
}

function contentWords(text) {
  return [...new Set((normalize(text).match(/[\p{L}\p{N}]{3,}/gu) || []).filter(word => !stopWords.has(word)))];
}

function reviewQuestion(question, materialText = "") {
  const plainText = normalize(question).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  const text = normalizedQuestion(question);
  const compact = text.replace(/\s+/g, "");
  const personalPatterns = [
    /\b(?:are|were) you (?:married|single|dating|divorced|engaged)\b/, /\bhow old are you\b/, /\bwhere (?:do|did) you (?:live|grow up|come from)\b/,
    /\b(?:do|did) you (?:have|want|like|love|follow|believe|date|drink|smoke|vote|color|colour|dye)\b/,
    /\b(?:have|would|will) you (?:have|want|like|date|marry|adopt)\b/,
    /\b(?:your|professor'?s) (?:wife|husband|girlfriend|boyfriend|partner|family|children|kids|son|daughter|age|birthday|salary|religion|faith|address|phone|number|nationality|private life|politics|instagram|social media)\b/,
    /\bwhat(?:'s| is| are) your (?:age|birthday|salary|religion|faith|address|phone number|nationality|favorite|favourite|hobby|relationship status)\b/,
    /\b(?:favorite|favourite) (?:color|colour|food|movie|team|sport|song|place|person)\b/,
    /(?:هل انت|هل انتي) (?:متزوج|متزوجه|اعزب|عزباء)/, /كم عمرك/, /اين تسكن/, /وين تسكن/,
    /(?:عندك|تبغي|تريد) (?:اطفال|اولاد|عيال)/, /(?:زوجتك|زوجك|راتبك|دينك|ديانتك|عمرك|عنوانك|رقم هاتفك|جنسيتك|حياتك الشخصيه|حياتك الخاصه|لونك المفضل)/
  ];
  const compactPersonal = /(?:are|were|do|did|have|would|will|where|what|how)?you.*(?:married|single|dating|divorced|engaged|wife|husband|girlfriend|boyfriend|partner|children|kids|baby|babies|religion|faith|salary|birthday|favorite|favourite|hobby|nationality|live)/;
  const academicRequest = /\b(?:can|could|would) you (?:explain|clarify|repeat|show|give|provide|review|cover|go over)\b|\bwhat do you mean\b|\bhow do you (?:calculate|solve|derive|apply|use)\b|\b(?:will|can) you (?:upload|share|post) (?:the )?(?:slides|notes|material|exam|assignment|project)\b/;
  const professorFocused = /\b(?:you|your|yourself)\b/.test(text) && !academicRequest.test(text);
  if (personalPatterns.some(pattern => pattern.test(text)) || compactPersonal.test(compact) || professorFocused) return { decision: "personal" };

  const logisticsPattern = /\b(?:exam|quiz|test|midterm|final|assignment|homework|project|presentation|deadline|due date|grade|marks|assessment|exam format|exam date)\b|(?:اختبار|امتحان|كويز|واجب|مشروع|عرض|موعد التسليم|درجات|تقييم)/;
  const slideRequest = /\b(?:explain|clarify|repeat|review|revisit|show|cover|go over)\b.{0,40}(?:(?:slide|page)\s*(?:number|no)?\s*(?:[\d٠-٩]+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:slide|page))|(?:اشرح|وضح|اعد|راجع).{0,30}(?:الشريحة|الشريحه|السلايد|صفحة|صفحه)\s*[\d٠-٩]+/;
  if (logisticsPattern.test(text) || slideRequest.test(plainText)) return { decision: "allowed" };

  const materialWords = new Set(contentWords(materialText));
  const questionWords = contentWords(question);
  return questionWords.some(word => materialWords.has(word)) ? { decision: "allowed" } : { decision: "off_topic" };
}

module.exports = { extractMaterialText, reviewQuestion };
