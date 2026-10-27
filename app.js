const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const starterQuestions = [
  { id: 1, text: "How do we validate an idea before spending money to build it?", votes: 18, age: "2 min ago", answered: false },
  { id: 2, text: "What is the difference between an entrepreneur and an innovator?", votes: 12, age: "5 min ago", answered: false },
  { id: 3, text: "Could you explain the value proposition with another example?", votes: 9, age: "8 min ago", answered: false },
  { id: 4, text: "How do we know whether a problem is worth solving?", votes: 7, age: "10 min ago", answered: false }
];

let questions = JSON.parse(localStorage.getItem("askup-questions-v4")) || starterQuestions;
let currentStudent = sessionStorage.getItem("askup-student") || "Student";
let activeProfessorFilter = "new";
let activeSession = JSON.parse(localStorage.getItem("askup-session")) || { name: "Validating opportunities", code: "MINT-OWL-24", active: true };
let pendingSessionCode = activeSession.code;
let sessionHistory = JSON.parse(localStorage.getItem("askup-session-history-v2")) || [];

function saveQuestions() {
  localStorage.setItem("askup-questions-v4", JSON.stringify(questions));
}

function postRealtime(path, body = {}) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).catch(() => showToast("Live sync is temporarily unavailable."));
}

function applyRealtimeState(state) {
  if (Array.isArray(state.questions)) {
    questions = state.questions;
    saveQuestions();
  }
  if (state.session) {
    activeSession = state.session;
    localStorage.setItem("askup-session", JSON.stringify(activeSession));
    updateSessionUI();
  }
  renderQuestions();
}

async function connectRealtime() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return;
    applyRealtimeState(await response.json());
    const events = new EventSource("/api/events");
    events.onmessage = event => applyRealtimeState(JSON.parse(event.data));
  } catch { /* The static prototype still works without the live server. */ }
}

window.addEventListener("storage", event => {
  if (event.key === "askup-questions-v4" && event.newValue) {
    questions = JSON.parse(event.newValue);
    renderQuestions();
  }
  if (event.key === "askup-session" && event.newValue) {
    activeSession = JSON.parse(event.newValue);
    updateSessionUI();
  }
});

function generateSessionCode() {
  const firstWords = ["MINT", "BRAVE", "NOVA", "BRIGHT", "CORAL", "SWIFT", "SOLAR", "CLEAR"];
  const secondWords = ["OWL", "FOX", "IDEA", "SPARK", "WAVE", "LION", "MAPLE", "COMET"];
  const randomIndex = length => crypto.getRandomValues(new Uint32Array(1))[0] % length;
  return `${firstWords[randomIndex(firstWords.length)]}-${secondWords[randomIndex(secondWords.length)]}-${String(randomIndex(90) + 10)}`;
}

function updateSessionUI() {
  const displayCode = activeSession.code.replaceAll("-", " – ");
  $$('[data-session-code]').forEach(element => { element.textContent = displayCode; });
  $("#student-session-title").textContent = activeSession.name;
  $("#student-room-title").textContent = activeSession.name;
  $("#professor-session-title").textContent = `FIE101 · ${activeSession.name}`;
  $("#session-code").placeholder = displayCode;
}

console.assert(/^[A-Z]+-[A-Z]+-\d{2}$/.test(generateSessionCode()), "Session codes should contain two words and two digits.");

function showView(name) {
  $$(".view").forEach(view => view.classList.toggle("active", view.dataset.view === name));
  $("#app").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2400);
}

function openStudentQuestions() {
  $$(".dash-nav [data-tab]").forEach(button => button.classList.toggle("active", button.dataset.tab === "questions"));
  $$(".student-tab").forEach(tab => tab.classList.remove("active"));
  $("#questions-tab").classList.add("active");
  renderQuestions();
}

function sortedQuestions(mode) {
  return [...questions].sort(mode === "newest" ? (a, b) => b.id - a.id : (a, b) => b.votes - a.votes);
}

function studentQuestionMarkup(question) {
  return `<article class="question-item">
    <button class="vote-button" data-upvote="${question.id}" aria-label="Upvote question"><span>↑</span>${question.votes}</button>
    <div class="question-copy"><p>${escapeHtml(question.text)}</p><small>${question.age}${question.answered ? '<span class="answered-tag">Answered</span>' : ""}</small></div>
    <button class="question-menu" aria-label="More options">⋮</button>
  </article>`;
}

function professorQuestionMarkup(question) {
  return `<article class="question-item">
    <button class="vote-button" data-present="${question.id}" aria-label="Present question"><span>↑</span>${question.votes}</button>
    <div class="question-copy"><p>${escapeHtml(question.text)}</p><small>${question.age}${question.answered ? '<span class="answered-tag">Answered</span>' : ""}</small></div>
    <div class="prof-actions"><button data-present="${question.id}">Show</button><button class="answer-button" data-answer="${question.id}">${question.answered ? "Reopen" : "Mark answered"}</button></div>
  </article>`;
}

function renderQuestions() {
  const studentMode = $("#student-sort").value;
  $("#student-question-list").innerHTML = sortedQuestions(studentMode).map(studentQuestionMarkup).join("") || '<p class="muted">No questions yet. Be the first to ask.</p>';
  const professorMode = $("#prof-sort").value;
  const professorQuestions = sortedQuestions(professorMode).filter(q => activeProfessorFilter === "answered" ? q.answered : !q.answered);
  $("#professor-question-list").innerHTML = professorQuestions.map(professorQuestionMarkup).join("") || '<p class="muted">Nothing in this queue yet.</p>';
  $("#question-count-side").textContent = questions.length;
  $("#new-count").textContent = questions.filter(q => !q.answered).length;
  $("#answered-count").textContent = questions.filter(q => q.answered).length;
}

function escapeHtml(text) {
  const node = document.createElement("div");
  node.textContent = text;
  return node.innerHTML;
}

function renderSessionHistory() {
  $("#session-history").innerHTML = sessionHistory.length
    ? sessionHistory.map(session => `<div class="session-row"><span class="date-box"><b>${session.day}</b><small>${session.month}</small></span><div><strong>${escapeHtml(session.name)}</strong><small>FIE101 · Completed session</small></div><span>${session.students} students</span><span>${session.questions} questions</span></div>`).join("")
    : '<div class="session-empty">Completed sessions will appear here.</div>';
}

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

console.assert(containsFoulLanguage("f.u.c.k"), "Moderation should catch disguised foul language.");
console.assert(containsFoulLanguage("That was dumbass behaviour"), "Moderation should catch compound foul language.");
console.assert(containsFoulLanguage("dumb-@ss"), "Moderation should catch disguised compound foul language.");
console.assert(!containsFoulLanguage("Please explain the class assignment"), "Moderation should allow ordinary classroom language.");

function presentQuestion(id) {
  const question = questions.find(q => q.id === Number(id)) || sortedQuestions("votes")[0];
  if (!question) return showToast("There are no questions to present yet.");
  $("#projector-text").textContent = question.text;
  $("#projector-votes").textContent = question.votes;
  $("#projector").classList.add("open");
}

$$('[data-go="home"]').forEach(button => button.addEventListener("click", () => { history.replaceState({}, "", "/"); showView("home"); }));
$$('[data-role="student"]').forEach(button => button.addEventListener("click", () => { history.replaceState({}, "", "/student"); showView("student-login"); }));
$$('[data-role="professor"]').forEach(button => button.addEventListener("click", () => { history.replaceState({}, "", "/professor"); showView("professor-login"); }));

$("#student-login-form").addEventListener("submit", event => {
  event.preventDefault();
  currentStudent = $("#student-id").value.trim();
  sessionStorage.setItem("askup-student", currentStudent);
  $("#student-label").textContent = currentStudent;
  $("#student-side-id").textContent = currentStudent;
  showView("student-join");
});

$("#student-id").addEventListener("input", event => {
  event.target.value = event.target.value.replace(/\D/g, "").slice(0, 7);
});

$("#professor-login-form").addEventListener("submit", event => {
  event.preventDefault();
  showView("professor-dashboard");
});

$("#use-demo-code").addEventListener("click", () => {
  $("#session-code").value = activeSession.code;
  $("#session-code").focus();
});

$("#join-form").addEventListener("submit", event => {
  event.preventDefault();
  const code = $("#session-code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const expectedCode = activeSession.code.replace(/[^A-Z0-9]/g, "");
  if (!activeSession.active || code !== expectedCode) return showToast("That code doesn’t match an active session.");
  renderQuestions();
  showView("student-room");
});

$$('[data-tab]').forEach(button => button.addEventListener("click", () => {
  $$(".dash-nav [data-tab]").forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  $$(".student-tab").forEach(tab => tab.classList.remove("active"));
  $(`#${button.dataset.tab}-tab`).classList.add("active");
  if (button.dataset.tab === "questions") renderQuestions();
}));

$("#question-input").addEventListener("input", event => {
  $("#char-count").textContent = `${event.target.value.length} / 280`;
});

$$('[data-prompt]').forEach(button => button.addEventListener("click", () => {
  $("#question-input").value = button.dataset.prompt;
  $("#question-input").dispatchEvent(new Event("input"));
  $("#question-input").focus();
}));

$("#question-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("#question-input");
  const text = input.value.trim();
  if (containsFoulLanguage(text)) {
    $("#foul-modal").classList.add("open");
    $("#close-foul-modal").focus();
    return;
  }
  const question = { id: Date.now(), text, votes: 1, age: "just now", answered: false, reporter: currentStudent };
  questions.push(question);
  saveQuestions();
  postRealtime("/api/questions", { question });
  input.value = "";
  input.dispatchEvent(new Event("input"));
  renderQuestions();
  $("#success-modal").classList.add("open");
});

$("#student-question-list").addEventListener("click", event => {
  const button = event.target.closest("[data-upvote]");
  if (!button) return;
  const question = questions.find(q => q.id === Number(button.dataset.upvote));
  if (!question) return;
  question.votes += 1;
  saveQuestions();
  renderQuestions();
  postRealtime(`/api/questions/${question.id}/upvote`);
});

$("#student-sort").addEventListener("change", renderQuestions);
$("#prof-sort").addEventListener("change", renderQuestions);
$("#view-questions").addEventListener("click", () => { $("#success-modal").classList.remove("open"); openStudentQuestions(); });
$("#ask-another").addEventListener("click", () => { $("#success-modal").classList.remove("open"); $("#question-input").focus(); });
$("#close-foul-modal").addEventListener("click", () => { $("#foul-modal").classList.remove("open"); $("#question-input").focus(); });
$("#start-session").addEventListener("click", () => {
  pendingSessionCode = generateSessionCode();
  $("#new-session-code").textContent = pendingSessionCode.replaceAll("-", " – ");
  $("#session-name").value = "";
  $("#create-session-modal").classList.add("open");
  $("#session-name").focus();
});
$("#regenerate-session-code").addEventListener("click", () => {
  pendingSessionCode = generateSessionCode();
  $("#new-session-code").textContent = pendingSessionCode.replaceAll("-", " – ");
});
$("#cancel-create-session").addEventListener("click", () => $("#create-session-modal").classList.remove("open"));
$("#session-name").addEventListener("input", event => event.target.setCustomValidity(""));
$("#create-session-form").addEventListener("submit", event => {
  event.preventDefault();
  const nameInput = $("#session-name");
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.setCustomValidity("Please enter a session name.");
    nameInput.reportValidity();
    return;
  }
  activeSession = { name, code: pendingSessionCode, active: true, createdByProfessor: true };
  localStorage.setItem("askup-session", JSON.stringify(activeSession));
  questions = [];
  saveQuestions();
  postRealtime("/api/session", { session: activeSession });
  updateSessionUI();
  renderQuestions();
  $("#create-session-modal").classList.remove("open");
  showView("professor-session");
});
$("#end-session").addEventListener("click", () => {
  if (activeSession.createdByProfessor) {
    const now = new Date();
    sessionHistory.unshift({
      name: activeSession.name,
      day: new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(now),
      month: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(now).toUpperCase(),
      students: 24,
      questions: questions.length
    });
    localStorage.setItem("askup-session-history-v2", JSON.stringify(sessionHistory));
    activeSession.createdByProfessor = false;
  }
  activeSession.active = false;
  localStorage.setItem("askup-session", JSON.stringify(activeSession));
  postRealtime("/api/session/end");
  updateSessionUI();
  renderSessionHistory();
  showView("professor-dashboard");
  showToast("Session ended and recap saved.");
});

$$('[data-filter]').forEach(button => button.addEventListener("click", () => {
  activeProfessorFilter = button.dataset.filter;
  $$('[data-filter]').forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  renderQuestions();
}));

$("#professor-question-list").addEventListener("click", event => {
  const present = event.target.closest("[data-present]");
  const answer = event.target.closest("[data-answer]");
  if (present) return presentQuestion(present.dataset.present);
  if (answer) {
    const question = questions.find(q => q.id === Number(answer.dataset.answer));
    if (!question) return;
    question.answered = !question.answered;
    saveQuestions();
    renderQuestions();
    postRealtime(`/api/questions/${question.id}/answer`);
    showToast(question.answered ? "Question marked as answered." : "Question returned to the queue.");
  }
});

$("#projector-button").addEventListener("click", () => presentQuestion());
$("#close-projector").addEventListener("click", () => $("#projector").classList.remove("open"));
$("#projector").addEventListener("click", event => { if (event.target.id === "projector") $("#projector").classList.remove("open"); });
$("#success-modal").addEventListener("click", event => { if (event.target.id === "success-modal") $("#success-modal").classList.remove("open"); });
$("#foul-modal").addEventListener("click", event => { if (event.target.id === "foul-modal") $("#foul-modal").classList.remove("open"); });
$("#create-session-modal").addEventListener("click", event => { if (event.target.id === "create-session-modal") $("#create-session-modal").classList.remove("open"); });

$("#copy-code").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(activeSession.code); showToast("Session code copied."); }
  catch { showToast(`Session code: ${activeSession.code}`); }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    $("#projector").classList.remove("open");
    $("#success-modal").classList.remove("open");
    $("#foul-modal").classList.remove("open");
    $("#create-session-modal").classList.remove("open");
  }
});

updateSessionUI();
renderQuestions();
renderSessionHistory();
connectRealtime();
const requestedRole = ["student", "professor"].find(role => location.pathname === `/${role}`) || new URLSearchParams(location.search).get("as");
if (requestedRole === "student" || requestedRole === "professor") showView(`${requestedRole}-login`);
