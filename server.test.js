const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { containsFoulLanguage } = require("./moderation");
const { extractMaterialText, reviewQuestion } = require("./materials");

function zipWithFile(name, content) {
  const fileName = Buffer.from(name);
  const data = Buffer.from(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(fileName.length, 28);
  const localEntry = Buffer.concat([local, fileName, data]);
  const centralEntry = Buffer.concat([central, fileName]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);
  return Buffer.concat([localEntry, centralEntry, eocd]);
}

test("AskUp isolates sessions, moderates two languages, and limits votes", async () => {
  const port = 4174;
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"]
  });
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
  });

  const post = (path, body) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  try {
    assert.equal((await fetch(`${base}/professor`)).status, 200);
    assert.equal((await fetch(`${base}/student`)).status, 200);
    assert.equal(containsFoulLanguage("f.u.c.k"), true);
    assert.equal(containsFoulLanguage("يا شرموط"), true);
    assert.equal(containsFoulLanguage("Please explain the class assignment"), false);
    assert.match(extractMaterialText(zipWithFile("word/document.xml", "<w:p><w:t>Customer discovery and value proposition</w:t></w:p>"), "lecture.docx"), /Customer discovery/);
    assert.match(extractMaterialText(zipWithFile("ppt/slides/slide1.xml", "<a:p><a:t>Innovation opportunity validation</a:t></a:p>"), "lecture.pptx"), /Innovation opportunity/);
    const samplePdf = Buffer.from("%PDF-1.4\nstream\nBT (Innovation and customer validation material) Tj ET\nendstream");
    assert.match(extractMaterialText(samplePdf, "lecture.pdf"), /customer validation/);
    assert.equal(reviewQuestion("What is the exam format?", "customer discovery and innovation").decision, "allowed");
    assert.equal(reviewQuestion("Are you married?", "customer discovery and innovation").decision, "personal");
    assert.equal(reviewQuestion("a r e  u  m a r r i e d?", "customer discovery and innovation").decision, "personal");
    assert.equal(reviewQuestion("Do you want kids?", "customer discovery and innovation").decision, "personal");
    assert.equal(reviewQuestion("What is your religion?", "customer discovery and innovation").decision, "personal");
    assert.equal(reviewQuestion("What is your experience with innovation?", "customer discovery and innovation").decision, "personal");
    assert.equal(reviewQuestion("Why did you become a professor?", "customer discovery and innovation").decision, "personal");
    assert.equal(reviewQuestion("Can you explain customer validation?", "customer discovery and innovation").decision, "allowed");
    assert.equal(reviewQuestion("Explain slide 5 again", "customer discovery and innovation").decision, "allowed");
    assert.equal(reviewQuestion("Could you clarify the fifth slide?", "customer discovery and innovation").decision, "allowed");
    assert.equal(reviewQuestion("اشرح الشريحة ٥ مرة اخرى", "customer discovery and innovation").decision, "allowed");
    assert.equal(reviewQuestion("What is your favorite football team?", "customer discovery and innovation").decision, "personal");

    const first = { name: "Innovation class", code: "48217", professorId: "sara.khan@university.edu", professorName: "Dr. Sara Khan" };
    const second = { name: "Entrepreneurship class", code: "59328", professorId: "omar@university.edu", professorName: "Dr. Omar" };
    assert.equal((await post("/api/session", { session: first })).status, 201);
    assert.equal((await post("/api/session", { session: second })).status, 201);

    const uploadResponse = await fetch(`${base}/api/session/material`, {
      method: "POST",
      headers: { "X-Session-Code": first.code, "X-File-Name": encodeURIComponent("innovation.pdf") },
      body: samplePdf
    });
    assert.equal(uploadResponse.status, 200);
    assert.equal((await uploadResponse.json()).session.material.name, "innovation.pdf");

    const offTopic = await post("/api/questions", { code: first.code, question: { text: "Can we discuss football tactics?" }, ownerId: "student-browser-one" });
    assert.equal(offTopic.status, 422);
    assert.equal((await offTopic.json()).code, "off_topic");
    assert.equal((await post("/api/questions", { code: first.code, question: { text: "What is your favorite football team?" }, overrideRelevance: true, ownerId: "student-browser-one" })).status, 422);
    assert.equal((await post("/api/questions", { code: first.code, question: { text: "What is the exam format?" }, ownerId: "student-browser-one" })).status, 200);
    const personal = await post("/api/questions", { code: second.code, question: { text: "Are you married?" }, ownerId: "student-browser-one" });
    assert.equal(personal.status, 422);
    assert.equal((await personal.json()).code, "personal_question");

    const firstQuestion = await post("/api/questions", { code: first.code, question: { text: "How does customer validation work in our class?" }, ownerId: "student-browser-one" });
    assert.equal(firstQuestion.status, 200);
    const questionId = (await firstQuestion.json()).questions.at(-1).id;
    assert.equal((await post("/api/questions", { code: second.code, question: { text: "How does entrepreneurship work?" }, ownerId: "student-browser-two" })).status, 200);

    const firstState = await fetch(`${base}/api/state?code=${first.code}`).then(result => result.json());
    const secondState = await fetch(`${base}/api/state?code=${second.code}`).then(result => result.json());
    assert.equal(firstState.session.professorName, "Dr. Sara Khan");
    assert.equal(firstState.questions.at(-1).text, "How does customer validation work in our class?");
    assert.deepEqual(secondState.questions.map(item => item.text), ["How does entrepreneurship work?"]);

    assert.equal((await post(`/api/questions/${questionId}/upvote`, { code: first.code, voterId: "student-browser-one" })).status, 200);
    assert.equal((await post(`/api/questions/${questionId}/upvote`, { code: first.code, voterId: "student-browser-one" })).status, 409);
    assert.equal((await post(`/api/questions/${questionId}/upvote`, { code: first.code, voterId: "student-browser-two" })).status, 200);
    const votedState = await fetch(`${base}/api/state?code=${first.code}`).then(result => result.json());
    assert.equal(votedState.questions.find(item => item.id === questionId).votes, 2);

    assert.equal((await post("/api/questions", { code: first.code, question: { text: "This is d.u.m.b.a.s.s nonsense" }, ownerId: "student-browser-one" })).status, 422);
    assert.equal((await post("/api/questions", { code: first.code, question: { text: "انت شرموط" }, ownerId: "student-browser-one" })).status, 422);

    assert.equal((await post(`/api/questions/${questionId}/delete`, { code: first.code, ownerId: "student-browser-two" })).status, 403);
    assert.equal((await post(`/api/questions/${questionId}/delete`, { code: first.code, ownerId: "student-browser-one" })).status, 200);
    const deletedState = await fetch(`${base}/api/state?code=${first.code}`).then(result => result.json());
    assert.equal(deletedState.questions.some(item => item.id === questionId), false);

    const answerable = await post("/api/questions", { code: first.code, question: { text: "How does customer validation work?" }, ownerId: "student-browser-one" });
    const answerableId = (await answerable.json()).createdQuestionId;
    assert.equal((await post(`/api/questions/${answerableId}/answer`, { code: first.code })).status, 200);
    const answeredState = await fetch(`${base}/api/state?code=${first.code}`).then(result => result.json());
    assert.equal(answeredState.questions.find(item => item.id === answerableId).answered, true);

    assert.equal((await post("/api/session/end", { code: first.code })).status, 200);
    assert.equal((await fetch(`${base}/api/state?code=${first.code}`)).status, 404);
    assert.equal((await fetch(`${base}/api/state?code=${second.code}`)).status, 200);
  } finally {
    server.kill();
  }
});
