const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const { containsFoulLanguage } = AskUpModeration;

let questions = [];
let activeSession = null;
let activeProfessorFilter = "new";
let pendingSessionCode = "";
let professorId = "";
let professorName = "Professor";
let sessionHistory = [];
let realtimeEvents = null;
const voterId = localStorage.getItem("askup-voter-id") || (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`);
localStorage.setItem("askup-voter-id", voterId);

async function postRealtime(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Live sync is temporarily unavailable.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

async function uploadMaterial(file, code) {
  if (file.size > 12_000_000) throw new Error("The file must be 12 MB or smaller.");
  const response = await fetch("/api/session/material", {
    method: "POST",
    headers: { "X-Session-Code": code, "X-File-Name": encodeURIComponent(file.name) },
    body: file
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "AskUp could not analyze this file.");
  return data;
}

function applyRealtimeState(state) {
  if (!state.session || (activeSession && state.session.code !== activeSession.code)) return;
  const sessionEnded = activeSession?.active && !state.session.active;
  activeSession = state.session;
  questions = Array.isArray(state.questions) ? state.questions : [];
  updateSessionUI();
  renderQuestions();
  if (sessionEnded && $("[data-view='student-room']").classList.contains("active")) {
    showView("student-join");
    showToast("This session has ended.");
  }
}

function connectRealtime(code, initialState) {
  realtimeEvents?.close();
  if (initialState) applyRealtimeState(initialState);
  realtimeEvents = new EventSource(`/api/events?code=${encodeURIComponent(code)}`);
  realtimeEvents.onmessage = event => applyRealtimeState(JSON.parse(event.data));
  realtimeEvents.onerror = () => { /* EventSource reconnects automatically. */ };
}

function generateSessionCode() {
  return String(10000 + crypto.getRandomValues(new Uint32Array(1))[0] % 90000);
}

function professorNameFromId(id) {
  const words = id.split("@")[0].replace(/^dr[._-]?/i, "").replace(/[._-]+/g, " ").replace(/\d+/g, " ").trim();
  const name = words.replace(/\b\p{L}/gu, letter => letter.toUpperCase()) || "Professor";
  return `Dr. ${name}`;
}

function updateProfessorUI() {
  const initials = professorName.replace(/^Dr\.\s*/i, "").split(/\s+/).map(word => word[0]).join("").slice(0, 2).toUpperCase() || "P";
  $("#professor-avatar").textContent = initials;
  $("#professor-sidebar-name").textContent = professorName;
  $("#professor-sidebar-role").textContent = professorId;
  $("#professor-greeting").textContent = `Good afternoon, ${professorName}.`;
  $("#current-date").textContent = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toUpperCase();
}

function updateSessionUI() {
  if (!activeSession) return;
  const displayCode = activeSession.code.replaceAll("-", " – ");
  $$('[data-session-code]').forEach(element => { element.textContent = displayCode; });
  $("#student-session-title").textContent = activeSession.name;
  $("#student-room-title").textContent = activeSession.name;
  $("#student-professor-name").textContent = `Session with ${activeSession.professorName}`;
  $("#professor-session-title").textContent = `${activeSession.professorName} · ${activeSession.name}`;
  $("#material-status").textContent = activeSession.material ? `Reference: ${activeSession.material.name}` : "No reference file";
  $("#student-material-note").textContent = activeSession.material
    ? `Questions are checked against ${activeSession.material.name}. Course logistics are still allowed.`
    : "No lecture material was uploaded for this session.";
}

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
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800);
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

function voteStorageKey() {
  return `askup-votes-${activeSession?.code || "none"}`;
}

function submittedStorageKey() {
  return `askup-submitted-${activeSession?.code || "none"}`;
}

function submittedQuestionIds() {
  return new Set(JSON.parse(localStorage.getItem(submittedStorageKey()) || "[]"));
}

function rememberSubmittedQuestion(id) {
  const ids = submittedQuestionIds();
  ids.add(Number(id));
  localStorage.setItem(submittedStorageKey(), JSON.stringify([...ids]));
}

function forgetSubmittedQuestion(id) {
  const ids = submittedQuestionIds();
  ids.delete(Number(id));
  localStorage.setItem(submittedStorageKey(), JSON.stringify([...ids]));
}

function votedQuestionIds() {
  return new Set(JSON.parse(localStorage.getItem(voteStorageKey()) || "[]"));
}

function rememberVote(id) {
  const ids = votedQuestionIds();
  ids.add(Number(id));
  localStorage.setItem(voteStorageKey(), JSON.stringify([...ids]));
}

function studentQuestionMarkup(question) {
  const voted = votedQuestionIds().has(question.id);
  const canDelete = submittedQuestionIds().has(question.id);
  return `<article class="question-item">
    <button class="vote-button${voted ? " voted" : ""}" data-upvote="${question.id}" aria-label="${voted ? "Already voted" : "Upvote question"}" ${voted ? "disabled" : ""}><span>↑</span>${question.votes}</button>
    <div class="question-copy"><p>${escapeHtml(question.text)}</p><small>${question.age}</small></div>
    ${canDelete ? `<button class="delete-question" data-delete="${question.id}" aria-label="Delete your question">Delete</button>` : ""}
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
  const studentQuestions = sortedQuestions($("#student-sort").value).filter(question => !question.answered);
  $("#student-question-list").innerHTML = studentQuestions.map(studentQuestionMarkup).join("") || '<p class="muted">No unanswered questions yet. Be the first to ask.</p>';
  const professorQuestions = sortedQuestions($("#prof-sort").value).filter(question => activeProfessorFilter === "answered" ? question.answered : !question.answered);
  $("#professor-question-list").innerHTML = professorQuestions.map(professorQuestionMarkup).join("") || '<p class="muted">Nothing in this queue yet.</p>';
  $("#question-count-side").textContent = questions.filter(question => !question.answered).length;
  $("#new-count").textContent = questions.filter(question => !question.answered).length;
  $("#answered-count").textContent = questions.filter(question => question.answered).length;
}

function escapeHtml(text) {
  const node = document.createElement("div");
  node.textContent = text;
  return node.innerHTML;
}

function historyStorageKey() {
  return `askup-session-history-${professorId.toLowerCase()}`;
}

function renderSessionHistory() {
  $("#session-history").innerHTML = sessionHistory.length
    ? sessionHistory.map(session => `<div class="session-row"><span class="date-box"><b>${session.day}</b><small>${session.month}</small></span><div><strong>${escapeHtml(session.name)}</strong><small>Completed session</small></div><span>${session.questions} questions</span></div>`).join("")
    : '<div class="session-empty">Completed sessions will appear here.</div>';
}

function openFoulLanguageModal() {
  $("#foul-modal").classList.add("open");
  $("#close-foul-modal").focus();
}

function openRelevanceModal(title, message) {
  $("#relevance-title").textContent = title;
  $("#relevance-message").textContent = message;
  $("#relevance-modal").classList.add("open");
  $("#edit-relevance-question").focus();
}

async function submitQuestion(text) {
  try {
    const state = await postRealtime("/api/questions", { code: activeSession.code, question: { text }, ownerId: voterId });
    rememberSubmittedQuestion(state.createdQuestionId);
    applyRealtimeState(state);
    $("#question-input").value = "";
    $("#question-input").dispatchEvent(new Event("input"));
    $("#relevance-modal").classList.remove("open");
    $("#success-modal").classList.add("open");
  } catch (error) {
    if (error.code === "foul_language") return openFoulLanguageModal();
    if (error.code === "personal_question") return openRelevanceModal("Personal question blocked", error.message);
    if (error.code === "off_topic") return openRelevanceModal("Question outside the lecture", error.message);
    showToast(error.message);
  }
}

function presentQuestion(id) {
  const question = questions.find(item => item.id === Number(id)) || sortedQuestions("votes").find(item => !item.answered);
  if (!question) return showToast("There are no questions to present yet.");
  $("#projector-text").textContent = question.text;
  $("#projector-votes").textContent = question.votes;
  $("#projector").classList.add("open");
}

console.assert(/^\d{5}$/.test(generateSessionCode()), "Session codes should contain five digits.");
console.assert(containsFoulLanguage("dumb-@ss") && containsFoulLanguage("يا شرموط"), "English and Arabic moderation should be enabled.");
console.assert(!containsFoulLanguage("Please explain the class assignment"), "Ordinary classroom language should be allowed.");

$$('[data-go="home"]').forEach(button => button.addEventListener("click", () => { history.replaceState({}, "", "/"); showView("home"); }));
$$('[data-role="student"]').forEach(button => button.addEventListener("click", () => { history.replaceState({}, "", "/student"); showView("student-join"); }));
$$('[data-role="professor"]').forEach(button => button.addEventListener("click", () => { history.replaceState({}, "", "/professor"); showView("professor-login"); }));

$("#professor-login-form").addEventListener("submit", event => {
  event.preventDefault();
  professorId = $("#professor-id").value.trim();
  professorName = professorNameFromId(professorId);
  sessionHistory = JSON.parse(localStorage.getItem(historyStorageKey()) || "[]");
  updateProfessorUI();
  renderSessionHistory();
  showView("professor-dashboard");
});

$("#join-form").addEventListener("submit", async event => {
  event.preventDefault();
  const code = $("#session-code").value.trim();
  try {
    const response = await fetch(`/api/state?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("That code doesn’t match an active session.");
    const state = await response.json();
    connectRealtime(state.session.code, state);
    showView("student-room");
  } catch (error) { showToast(error.message); }
});

$$('[data-tab]').forEach(button => button.addEventListener("click", () => {
  $$(".dash-nav [data-tab]").forEach(item => item.classList.remove("active"));
  button.classList.add("active");
  $$(".student-tab").forEach(tab => tab.classList.remove("active"));
  $(`#${button.dataset.tab}-tab`).classList.add("active");
  if (button.dataset.tab === "questions") renderQuestions();
}));

$("#question-input").addEventListener("input", event => { $("#char-count").textContent = `${event.target.value.length} / 280`; });
$$('[data-prompt]').forEach(button => button.addEventListener("click", () => {
  $("#question-input").value = button.dataset.prompt;
  $("#question-input").dispatchEvent(new Event("input"));
  $("#question-input").focus();
}));

$("#question-form").addEventListener("submit", async event => {
  event.preventDefault();
  const input = $("#question-input");
  const text = input.value.trim();
  if (containsFoulLanguage(text)) return openFoulLanguageModal();
  await submitQuestion(text);
});

$("#student-question-list").addEventListener("click", async event => {
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    try {
      const state = await postRealtime(`/api/questions/${remove.dataset.delete}/delete`, { code: activeSession.code, ownerId: voterId });
      forgetSubmittedQuestion(remove.dataset.delete);
      applyRealtimeState(state);
      return showToast("Your question was deleted.");
    } catch (error) { return showToast(error.message); }
  }
  const button = event.target.closest("[data-upvote]");
  if (!button || button.disabled) return;
  try {
    const state = await postRealtime(`/api/questions/${button.dataset.upvote}/upvote`, { code: activeSession.code, voterId });
    rememberVote(button.dataset.upvote);
    applyRealtimeState(state);
  } catch (error) {
    if (error.status === 409) rememberVote(button.dataset.upvote);
    renderQuestions();
    showToast(error.message);
  }
});

$("#student-sort").addEventListener("change", renderQuestions);
$("#prof-sort").addEventListener("change", renderQuestions);
$("#view-questions").addEventListener("click", () => { $("#success-modal").classList.remove("open"); openStudentQuestions(); });
$("#ask-another").addEventListener("click", () => { $("#success-modal").classList.remove("open"); $("#question-input").focus(); });
$("#close-foul-modal").addEventListener("click", () => { $("#foul-modal").classList.remove("open"); $("#question-input").focus(); });
$("#edit-relevance-question").addEventListener("click", () => { $("#relevance-modal").classList.remove("open"); $("#question-input").focus(); });

$("#start-session").addEventListener("click", () => {
  pendingSessionCode = generateSessionCode();
  $("#new-session-code").textContent = pendingSessionCode.replaceAll("-", " – ");
  $("#session-name").value = "";
  $("#session-material").value = "";
  $("#create-session-modal").classList.add("open");
  $("#session-name").focus();
});
$("#regenerate-session-code").addEventListener("click", () => {
  pendingSessionCode = generateSessionCode();
  $("#new-session-code").textContent = pendingSessionCode.replaceAll("-", " – ");
});
$("#cancel-create-session").addEventListener("click", () => $("#create-session-modal").classList.remove("open"));
$("#session-name").addEventListener("input", event => event.target.setCustomValidity(""));
$("#create-session-form").addEventListener("submit", async event => {
  event.preventDefault();
  const nameInput = $("#session-name");
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.setCustomValidity("Please enter a session name.");
    return nameInput.reportValidity();
  }
  try {
    let state = await postRealtime("/api/session", { session: { name, code: pendingSessionCode, professorId, professorName } });
    let uploadError = "";
    const material = $("#session-material").files[0];
    if (material) {
      try { state = await uploadMaterial(material, state.session.code); }
      catch (error) { uploadError = error.message; }
    }
    questions = [];
    connectRealtime(state.session.code, state);
    history.replaceState({}, "", `/professor?session=${encodeURIComponent(state.session.code)}`);
    $("#create-session-modal").classList.remove("open");
    showView("professor-session");
    if (uploadError) showToast(uploadError);
  } catch (error) {
    if (error.status === 409) {
      pendingSessionCode = generateSessionCode();
      $("#new-session-code").textContent = pendingSessionCode.replaceAll("-", " – ");
    }
    showToast(error.message);
  }
});

$("#end-session").addEventListener("click", async () => {
  if (!activeSession) return;
  const now = new Date();
  sessionHistory.unshift({
    name: activeSession.name,
    day: new Intl.DateTimeFormat("en-GB", { day: "2-digit" }).format(now),
    month: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(now).toUpperCase(),
    questions: questions.length
  });
  localStorage.setItem(historyStorageKey(), JSON.stringify(sessionHistory));
  try { await postRealtime("/api/session/end", { code: activeSession.code }); }
  catch (error) { return showToast(error.message); }
  realtimeEvents?.close();
  history.replaceState({}, "", "/professor");
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

$("#professor-question-list").addEventListener("click", async event => {
  const present = event.target.closest("[data-present]");
  const answer = event.target.closest("[data-answer]");
  if (present) return presentQuestion(present.dataset.present);
  if (!answer) return;
  const question = questions.find(item => item.id === Number(answer.dataset.answer));
  if (!question) return;
  try {
    const state = await postRealtime(`/api/questions/${question.id}/answer`, { code: activeSession.code });
    applyRealtimeState(state);
    showToast(question.answered ? "Question returned to the queue." : "Question marked as answered.");
  } catch (error) { showToast(error.message); }
});

$("#projector-button").addEventListener("click", () => presentQuestion());
$("#close-projector").addEventListener("click", () => $("#projector").classList.remove("open"));
$("#projector").addEventListener("click", event => { if (event.target.id === "projector") $("#projector").classList.remove("open"); });
$("#success-modal").addEventListener("click", event => { if (event.target.id === "success-modal") $("#success-modal").classList.remove("open"); });
$("#foul-modal").addEventListener("click", event => { if (event.target.id === "foul-modal") $("#foul-modal").classList.remove("open"); });
$("#relevance-modal").addEventListener("click", event => { if (event.target.id === "relevance-modal") $("#relevance-modal").classList.remove("open"); });
$("#create-session-modal").addEventListener("click", event => { if (event.target.id === "create-session-modal") $("#create-session-modal").classList.remove("open"); });

$("#copy-code").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(activeSession.code); showToast("Session code copied."); }
  catch { showToast(`Session code: ${activeSession.code}`); }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") ["projector", "success-modal", "foul-modal", "relevance-modal", "create-session-modal"].forEach(id => $(`#${id}`).classList.remove("open"));
});

renderQuestions();
renderSessionHistory();
const requestedRole = ["student", "professor"].find(role => location.pathname === `/${role}`) || new URLSearchParams(location.search).get("as");
if (requestedRole === "student") showView("student-join");
if (requestedRole === "professor") showView("professor-login");
