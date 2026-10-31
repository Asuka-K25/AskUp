const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { containsFoulLanguage } = require("./moderation");

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

    const first = { name: "Innovation class", code: "NOVA-OWL-42", professorId: "sara.khan@university.edu", professorName: "Dr. Sara Khan" };
    const second = { name: "Entrepreneurship class", code: "MINT-FOX-21", professorId: "omar@university.edu", professorName: "Dr. Omar" };
    assert.equal((await post("/api/session", { session: first })).status, 201);
    assert.equal((await post("/api/session", { session: second })).status, 201);

    const firstQuestion = await post("/api/questions", { code: first.code, question: { text: "Does this update only our class?" } });
    assert.equal(firstQuestion.status, 200);
    const questionId = (await firstQuestion.json()).questions[0].id;
    assert.equal((await post("/api/questions", { code: second.code, question: { text: "Is our room separate?" } })).status, 200);

    const firstState = await fetch(`${base}/api/state?code=${first.code}`).then(result => result.json());
    const secondState = await fetch(`${base}/api/state?code=${second.code}`).then(result => result.json());
    assert.equal(firstState.session.professorName, "Dr. Sara Khan");
    assert.deepEqual(firstState.questions.map(item => item.text), ["Does this update only our class?"]);
    assert.deepEqual(secondState.questions.map(item => item.text), ["Is our room separate?"]);

    assert.equal((await post(`/api/questions/${questionId}/upvote`, { code: first.code, voterId: "student-browser-one" })).status, 200);
    assert.equal((await post(`/api/questions/${questionId}/upvote`, { code: first.code, voterId: "student-browser-one" })).status, 409);
    assert.equal((await post(`/api/questions/${questionId}/upvote`, { code: first.code, voterId: "student-browser-two" })).status, 200);
    const votedState = await fetch(`${base}/api/state?code=${first.code}`).then(result => result.json());
    assert.equal(votedState.questions[0].votes, 2);

    assert.equal((await post("/api/questions", { code: first.code, question: { text: "This is d.u.m.b.a.s.s nonsense" } })).status, 422);
    assert.equal((await post("/api/questions", { code: first.code, question: { text: "انت شرموط" } })).status, 422);

    assert.equal((await post(`/api/questions/${questionId}/answer`, { code: first.code })).status, 200);
    const answeredState = await fetch(`${base}/api/state?code=${first.code}`).then(result => result.json());
    assert.equal(answeredState.questions[0].answered, true);

    assert.equal((await post("/api/session/end", { code: first.code })).status, 200);
    assert.equal((await fetch(`${base}/api/state?code=${first.code}`)).status, 404);
    assert.equal((await fetch(`${base}/api/state?code=${second.code}`)).status, 200);
  } finally {
    server.kill();
  }
});
