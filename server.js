const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const clients = new Set();
const starterQuestions = [
  { id: 1, text: "How do we validate an idea before spending money to build it?", votes: 18, age: "2 min ago", answered: false },
  { id: 2, text: "What is the difference between an entrepreneur and an innovator?", votes: 12, age: "5 min ago", answered: false },
  { id: 3, text: "Could you explain the value proposition with another example?", votes: 9, age: "8 min ago", answered: false },
  { id: 4, text: "How do we know whether a problem is worth solving?", votes: 7, age: "10 min ago", answered: false }
];
const state = {
  questions: starterQuestions,
  session: { name: "Validating opportunities", code: "MINT-OWL-24", active: true }
};

function containsFoulLanguage(text) {
  const substitutions = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };
  const normalized = text.toLowerCase().normalize("NFKD").replace(/[013457@$!]/g, character => substitutions[character]);
  const blockedWords = [
    "ass", "asses", "asshole", "assholes", "badass", "bastard", "bastards", "bitch", "bitches", "bitching",
    "bullshit", "bullshitting", "cunt", "cunts", "damn", "dick", "dicks", "dipshit", "dumb", "dumbass", "dumbasses",
    "fuck", "fucked", "fucker", "fuckers", "fuckface", "fucking", "idiot", "idiots", "jackass", "jackasses", "moron", "morons",
    "motherfucker", "motherfuckers", "nigger", "niggers", "piss", "pissed", "retard", "retards", "shit", "shithead", "shitheads",
    "shitty", "slut", "sluts", "stupid", "whore", "whores"
  ];
  return blockedWords.some(word => new RegExp(`\\b${[...word].join("[^a-z]*")}\\b`, "i").test(normalized));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function broadcast() {
  const message = `data: ${JSON.stringify(state)}\n\n`;
  clients.forEach(client => client.write(message));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10_000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch (error) { reject(error); }
    });
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/state") return json(res, 200, state);
  if (req.method === "GET" && pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    clients.add(res);
    res.write(`data: ${JSON.stringify(state)}\n\n`);
    req.on("close", () => clients.delete(res));
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch { return json(res, 400, { error: "Invalid JSON" }); }

  if (req.method === "POST" && pathname === "/api/questions") {
    if (!body.question || typeof body.question.text !== "string" || !body.question.text.trim() || body.question.text.length > 280) {
      return json(res, 400, { error: "Invalid question" });
    }
    if (containsFoulLanguage(body.question.text)) {
      return json(res, 422, { error: "Foul language detected! Please refrain from using foul language and be respectful of the professor and classroom." });
    }
    state.questions.push(body.question);
  } else if (req.method === "POST" && /^\/api\/questions\/\d+\/upvote$/.test(pathname)) {
    const question = state.questions.find(item => item.id === Number(pathname.split("/")[3]));
    if (question) question.votes += 1;
  } else if (req.method === "POST" && /^\/api\/questions\/\d+\/answer$/.test(pathname)) {
    const question = state.questions.find(item => item.id === Number(pathname.split("/")[3]));
    if (question) question.answered = !question.answered;
  } else if (req.method === "POST" && pathname === "/api/session") {
    if (!body.session?.name || !body.session?.code) return json(res, 400, { error: "Invalid session" });
    state.session = { ...body.session, active: true };
    state.questions = [];
  } else if (req.method === "POST" && pathname === "/api/session/end") {
    state.session.active = false;
  } else {
    return json(res, 404, { error: "Not found" });
  }

  broadcast();
  json(res, 200, state);
}

const mimeTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname);

  const requested = ["/", "/professor", "/student"].includes(pathname) ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(root, requested);
  if (!filePath.startsWith(root + path.sep)) return res.writeHead(403).end("Forbidden");
  fs.readFile(filePath, (error, file) => {
    if (error) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(file);
  });
});

server.listen(port, "0.0.0.0", () => console.log(`AskUp live at http://127.0.0.1:${port}`));
