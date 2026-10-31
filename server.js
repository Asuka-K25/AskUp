const http = require("http");
const fs = require("fs");
const path = require("path");
const { containsFoulLanguage } = require("./moderation");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const sessions = new Map();
const clients = new Map();

const sessionKey = code => String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const publicQuestion = question => ({ id: question.id, text: question.text, votes: question.voters.size, age: question.age, answered: question.answered });
const publicState = session => ({
  session: { name: session.name, code: session.code, active: session.active, professorName: session.professorName },
  questions: session.questions.map(publicQuestion)
});

function getSession(code) {
  return sessions.get(sessionKey(code));
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function broadcast(session) {
  const message = `data: ${JSON.stringify(publicState(session))}\n\n`;
  (clients.get(sessionKey(session.code)) || []).forEach(client => client.write(message));
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

async function handleApi(req, res, pathname, url) {
  if (req.method === "GET" && pathname === "/api/state") {
    const session = getSession(url.searchParams.get("code"));
    return session && session.active ? json(res, 200, publicState(session)) : json(res, 404, { error: "Active session not found" });
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const session = getSession(url.searchParams.get("code"));
    if (!session || !session.active) return json(res, 404, { error: "Active session not found" });
    const key = sessionKey(session.code);
    if (!clients.has(key)) clients.set(key, new Set());
    const sessionClients = clients.get(key);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    sessionClients.add(res);
    res.write(`data: ${JSON.stringify(publicState(session))}\n\n`);
    req.on("close", () => {
      sessionClients.delete(res);
      if (!sessionClients.size) clients.delete(key);
    });
    return;
  }

  let body;
  try { body = await readBody(req); }
  catch { return json(res, 400, { error: "Invalid JSON" }); }

  if (req.method === "POST" && pathname === "/api/session") {
    const incoming = body.session;
    if (!incoming?.name?.trim() || !incoming?.code || !incoming?.professorName?.trim()) return json(res, 400, { error: "Invalid session" });
    const key = sessionKey(incoming.code);
    if (sessions.get(key)?.active) return json(res, 409, { error: "That session code is already in use" });
    const session = {
      name: incoming.name.trim().slice(0, 60),
      code: incoming.code.toUpperCase(),
      active: true,
      professorName: incoming.professorName.trim().slice(0, 80),
      professorId: String(incoming.professorId || "").slice(0, 120),
      questions: []
    };
    sessions.set(key, session);
    return json(res, 201, publicState(session));
  }

  const session = getSession(body.code);
  if (!session || !session.active) return json(res, 404, { error: "Active session not found" });

  if (req.method === "POST" && pathname === "/api/questions") {
    const text = body.question?.text;
    if (typeof text !== "string" || !text.trim() || text.length > 280) return json(res, 400, { error: "Invalid question" });
    if (containsFoulLanguage(text)) {
      return json(res, 422, { error: "Foul language detected! Please refrain from using foul language and be respectful of the professor and classroom." });
    }
    session.questions.push({ id: Date.now() * 1000 + Math.floor(Math.random() * 1000), text: text.trim(), age: "just now", answered: false, voters: new Set() });
  } else if (req.method === "POST" && /^\/api\/questions\/\d+\/upvote$/.test(pathname)) {
    const question = session.questions.find(item => item.id === Number(pathname.split("/")[3]));
    const voterId = String(body.voterId || "");
    if (!question || voterId.length < 8 || voterId.length > 100) return json(res, 400, { error: "Invalid vote" });
    if (question.voters.has(voterId)) return json(res, 409, { error: "You can only vote once per question." });
    question.voters.add(voterId);
  } else if (req.method === "POST" && /^\/api\/questions\/\d+\/answer$/.test(pathname)) {
    const question = session.questions.find(item => item.id === Number(pathname.split("/")[3]));
    if (!question) return json(res, 404, { error: "Question not found" });
    question.answered = !question.answered;
  } else if (req.method === "POST" && pathname === "/api/session/end") {
    session.active = false;
  } else {
    return json(res, 404, { error: "Not found" });
  }

  broadcast(session);
  json(res, 200, publicState(session));
}

const mimeTypes = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) return handleApi(req, res, pathname, url);

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
