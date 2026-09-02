// ===================================================================
// Group Project for Daikon Observation Lab — app logic
// ===================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, push, onValue, onDisconnect,
  serverTimestamp, query, orderByChild
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// --- Fill this in with your own Firebase config ---
const firebaseConfig = {
  apiKey: "AIzaSyDeXL-AR1bL8FzfsEOWHOiLZmm85jTUkLI",
  authDomain: "daikon-lab.firebaseapp.com",
  databaseURL: "https://daikon-lab-default-rtdb.firebaseio.com",
  projectId: "daikon-lab",
  storageBucket: "daikon-lab.firebasestorage.app",
  messagingSenderId: "27736857772",
  appId: "1:27736857772:web:fd5c9524a2b3b95a08d309"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

document.title = "Group Project for Daikon Observation Lab";

// --- tiny client-side hash (NOT strong crypto — see README limitations) ---
async function hashPass(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function sanitizeKey(str) {
  return str.trim().replace(/[.#$/\[\]]/g, "_");
}

function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let currentUser = null;   // sanitized handle, used as DB key
let currentDay = todayKey();
let messagesUnsub = null;
let lastReadAtOpen = null; // timestamp captured when the current day view was opened

// ---------------------------------------------------------------
// Auth screen wiring
// ---------------------------------------------------------------
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
document.getElementById("show-signup").onclick = () => {
  loginForm.classList.add("hidden");
  document.getElementById("show-signup").classList.add("hidden");
  signupForm.classList.remove("hidden");
  document.getElementById("show-login").classList.remove("hidden");
};
document.getElementById("show-login").onclick = () => {
  signupForm.classList.add("hidden");
  document.getElementById("show-login").classList.add("hidden");
  loginForm.classList.remove("hidden");
  document.getElementById("show-signup").classList.remove("hidden");
};

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("signup-error");
  errEl.textContent = "";
  const rawUser = document.getElementById("signup-username").value;
  const pass = document.getElementById("signup-password").value;
  const key = sanitizeKey(rawUser);
  if (!key) { errEl.textContent = "Enter a handle."; return; }

  const userRef = ref(db, `users/${key}`);
  const snap = await get(userRef);
  if (snap.exists()) { errEl.textContent = "That handle is taken."; return; }

  await set(userRef, {
    displayName: rawUser.trim(),
    passwordHash: await hashPass(pass),
    createdAt: Date.now()
  });
  enterApp(key, rawUser.trim());
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("login-error");
  errEl.textContent = "";
  const rawUser = document.getElementById("login-username").value;
  const pass = document.getElementById("login-password").value;
  const key = sanitizeKey(rawUser);

  const snap = await get(ref(db, `users/${key}`));
  if (!snap.exists()) { errEl.textContent = "No account with that handle."; return; }
  const data = snap.val();
  const hash = await hashPass(pass);
  if (hash !== data.passwordHash) { errEl.textContent = "Wrong passphrase."; return; }

  enterApp(key, data.displayName || rawUser.trim());
});

// ---------------------------------------------------------------
// Entering / leaving the app
// ---------------------------------------------------------------
function enterApp(userKey, displayName) {
  currentUser = userKey;
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");

  const presenceRef = ref(db, `presence/${userKey}`);
  set(presenceRef, { status: "online", displayName, lastChange: Date.now() });

  // If the tab just closes / connection drops, mark offline & stamp lastRead
  const connectedRef = ref(db, ".info/connected");
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      onDisconnect(presenceRef).update({ status: "offline", lastChange: serverTimestamp() });
      onDisconnect(ref(db, `lastRead/${userKey}/${currentDay}`)).set(serverTimestamp());
    }
  });

  document.getElementById("logout-btn").onclick = () => goOffline(true);

  ensureTodayExists().then(() => {
    watchDayList();
    openDay(currentDay);
  });
  watchRoster();
}

async function goOffline(isLogout) {
  if (!currentUser) return;
  // stamp where the conversation left off, for the unread marker next time
  await set(ref(db, `lastRead/${currentUser}/${currentDay}`), Date.now());
  await set(ref(db, `presence/${currentUser}`), {
    status: "offline",
    displayName: currentUser,
    lastChange: Date.now()
  });
  if (isLogout) {
    currentUser = null;
    if (messagesUnsub) messagesUnsub();
    appScreen.classList.add("hidden");
    authScreen.classList.remove("hidden");
    loginForm.reset();
  }
}

// mark offline automatically if the tab is hidden/closed (in addition to onDisconnect)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentUser) {
    goOffline(false);
  } else if (document.visibilityState === "visible" && currentUser) {
    set(ref(db, `presence/${currentUser}`), {
      status: "online", displayName: currentUser, lastChange: Date.now()
    });
  }
});

// ---------------------------------------------------------------
// Day list (left pane)
// ---------------------------------------------------------------
async function ensureTodayExists() {
  const key = todayKey();
  const snap = await get(ref(db, `days/${key}`));
  if (!snap.exists()) {
    await set(ref(db, `days/${key}`), { createdAt: Date.now() });
  }
}

function watchDayList() {
  const daysRef = ref(db, "days");
  onValue(daysRef, (snap) => {
    const days = [];
    snap.forEach((child) => days.push(child.key));
    days.sort().reverse(); // most recent first
    renderDayList(days);
  });
}

function renderDayList(days) {
  const list = document.getElementById("day-list");
  list.innerHTML = "";
  days.forEach((dayKey) => {
    const btn = document.createElement("button");
    btn.className = "day-entry" + (dayKey === currentDay ? " active" : "");
    btn.innerHTML = `<span class="day-num">${dayKey}</span>${formatDayLabel(dayKey)}`;
    btn.onclick = () => openDay(dayKey);
    list.appendChild(btn);
  });
}

// ---------------------------------------------------------------
// Chat (center pane)
// ---------------------------------------------------------------
async function openDay(dayKey) {
  currentDay = dayKey;
  document.getElementById("current-day-label").textContent = formatDayLabel(dayKey);
  document.querySelectorAll(".day-entry").forEach((el) => {
    el.classList.toggle("active", el.querySelector(".day-num").textContent === dayKey);
  });

  // fetch lastRead marker for this day BEFORE subscribing, so we know where to draw the divider
  const lastReadSnap = await get(ref(db, `lastRead/${currentUser}/${dayKey}`));
  lastReadAtOpen = lastReadSnap.exists() ? lastReadSnap.val() : null;

  if (messagesUnsub) messagesUnsub();
  const msgsQuery = query(ref(db, `days/${dayKey}/messages`), orderByChild("timestamp"));
  messagesUnsub = onValue(msgsQuery, (snap) => {
    const messages = [];
    snap.forEach((child) => messages.push(child.val()));
    renderMessages(messages);
  });
}

function renderMessages(messages) {
  const list = document.getElementById("message-list");
  list.innerHTML = "";

  if (messages.length === 0) {
    list.innerHTML = `<div class="empty-log">No notes yet. Be the first to log an observation.</div>`;
    return;
  }

  let dividerPlaced = lastReadAtOpen === null; // if no marker, never show a divider
  messages.forEach((msg) => {
    if (!dividerPlaced && msg.timestamp && msg.timestamp > lastReadAtOpen) {
      const divider = document.createElement("div");
      divider.className = "unread-divider";
      divider.textContent = "unread notes start here";
      list.appendChild(divider);
      dividerPlaced = true;
    }
    const row = document.createElement("div");
    row.className = "message-row";
    row.innerHTML = `
      <span class="msg-user">${escapeHtml(msg.user)}</span>
      <span class="msg-time">${formatTime(msg.timestamp)}</span>
      <span class="msg-text">${escapeHtml(msg.text)}</span>
    `;
    list.appendChild(row);
  });
  list.scrollTop = list.scrollHeight;
}

document.getElementById("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text || !currentUser) return;
  input.value = "";
  await push(ref(db, `days/${currentDay}/messages`), {
    user: currentUser,
    text,
    timestamp: Date.now()
  });
});

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------------------------------------------------------
// Roster (right pane)
// ---------------------------------------------------------------
function watchRoster() {
  onValue(ref(db, "presence"), (snap) => {
    const online = [];
    const offline = [];
    snap.forEach((child) => {
      const v = child.val();
      const name = v.displayName || child.key;
      (v.status === "online" ? online : offline).push(name);
    });
    online.sort();
    offline.sort();

    const onlineEl = document.getElementById("roster-online");
    const offlineEl = document.getElementById("roster-offline");
    onlineEl.innerHTML = online.map(n =>
      `<div class="roster-entry"><span class="status-dot online"></span>${escapeHtml(n)}</div>`
    ).join("") || `<div class="roster-entry offline-name">nobody yet</div>`;
    offlineEl.innerHTML = offline.map(n =>
      `<div class="roster-entry offline-name"><span class="status-dot offline"></span>${escapeHtml(n)}</div>`
    ).join("");
  });
}
