const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const test = require("node:test");

test("a student question reaches the shared professor queue", async () => {
  const port = 4174;
  const server = spawn(process.execPath, ["server.js"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "inherit"]
  });
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
  });

  try {
    const professorPage = await fetch(`http://127.0.0.1:${port}/professor`);
    const studentPage = await fetch(`http://127.0.0.1:${port}/student`);
    assert.equal(professorPage.status, 200);
    assert.equal(studentPage.status, 200);

    const session = { name: "Live class", code: "NOVA-OWL-42", active: true };
    const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session })
    });
    assert.equal(sessionResponse.status, 200);

    const question = { id: Date.now(), text: "Does this update live?", votes: 1, age: "just now", answered: false };
    const response = await fetch(`http://127.0.0.1:${port}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question })
    });
    assert.equal(response.status, 200);

    const blockedResponse = await fetch(`http://127.0.0.1:${port}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: { ...question, id: question.id + 1, text: "This is dumbass nonsense" } })
    });
    assert.equal(blockedResponse.status, 422);

    const state = await fetch(`http://127.0.0.1:${port}/api/state`).then(result => result.json());
    assert.equal(state.session.code, session.code);
    assert.equal(state.questions.at(-1).text, question.text);
    assert.equal(state.questions.some(item => item.text.includes("dumbass")), false);
  } finally {
    server.kill();
  }
});
