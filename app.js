// ===================================================================
// Group Project for Daikon Observation Lab — app logic
// ===================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, push, remove, onValue, onDisconnect,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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

const ADMIN_HANDLE = "ADMIN";

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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Discord-style inline formatting. Runs AFTER escaping, on already-safe text.
function formatMessageText(escaped) {
  let out = escaped;
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/__(.+?)__/g, "<u>$1</u>");
  out = out.replace(/~~(.+?)~~/g, "<s>$1</s>");
  out = out.replace(/`([^`]+?)`/g, "<code>$1</code>");
  return out;
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------
let currentUser = null;        // sanitized handle, used as DB key
let currentChannel = { type: "day", id: todayKey() };
let messagesUnsub = null;
let lastReadAtOpen = null;

function isAdmin() {
  return currentUser === ADMIN_HANDLE;
}

function lastReadPath() {
  return `lastRead/${currentUser}/${currentChannel.type}-${currentChannel.id}`;
}
function messagesPath() {
  return currentChannel.type === "day"
    ? `days/${currentChannel.id}/messages`
    : `conversations/${currentChannel.id}/messages`;
}

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
  document.body.classList.toggle("is-admin", isAdmin());

  const presenceRef = ref(db, `presence/${userKey}`);
  set(presenceRef, { status: "online", displayName, lastChange: Date.now() });

  const connectedRef = ref(db, ".info/connected");
  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      onDisconnect(presenceRef).update({ status: "offline", lastChange: serverTimestamp() });
      onDisconnect(ref(db, lastReadPath())).set(serverTimestamp());
    }
  });

  document.getElementById("logout-btn").onclick = () => goOffline(true);
  document.getElementById("info-btn").onclick = () => toggleInfoPanel(true);
  document.getElementById("info-close-btn").onclick = () => toggleInfoPanel(false);
  document.getElementById("new-conv-btn").onclick = createConversation;
  document.getElementById("refresh-btn").onclick = () => {
    openChannel(currentChannel.type, currentChannel.id);
    console.log("Manual refresh triggered for", messagesPath());
  };

  ensureTodayExists().then(() => {
    watchDayList();
    watchConversationList();
    openChannel("day", currentChannel.id);
  });
  watchRoster();
  renderInfoPanel();
}

async function goOffline(isLogout) {
  if (!currentUser) return;
  await set(ref(db, lastReadPath()), Date.now());
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

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentUser) {
    goOffline(false);
  } else if (document.visibilityState === "visible" && currentUser) {
    set(ref(db, `presence/${currentUser}`), {
      status: "online", displayName: currentUser, lastChange: Date.now()
    });
    // Force a fresh subscription in case the old one went stale while backgrounded
    openChannel(currentChannel.type, currentChannel.id);
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
  onValue(ref(db, "days"), (snap) => {
    const days = [];
    snap.forEach((child) => days.push(child.key));
    days.sort().reverse();
    renderDayList(days);
  });
}

function renderDayList(days) {
  const list = document.getElementById("day-list");
  list.innerHTML = "";
  days.forEach((dayKey) => {
    const btn = document.createElement("button");
    btn.className = "day-entry" + (currentChannel.type === "day" && dayKey === currentChannel.id ? " active" : "");
    btn.innerHTML = `<span class="day-num">${dayKey}</span>${formatDayLabel(dayKey)}`;
    btn.onclick = () => openChannel("day", dayKey);
    list.appendChild(btn);
  });
}

// ---------------------------------------------------------------
// Conversations (left pane, below days)
// ---------------------------------------------------------------
async function createConversation() {
  const name = prompt("Name this conversation:");
  if (!name || !name.trim()) return;
  const convRef = push(ref(db, "conversations"));
  await set(convRef, {
    name: name.trim(),
    createdBy: currentUser,
    createdAt: Date.now()
  });
  openChannel("conversation", convRef.key);
}

function watchConversationList() {
  onValue(ref(db, "conversations"), (snap) => {
    const convs = [];
    snap.forEach((child) => convs.push({ id: child.key, ...child.val() }));
    convs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    renderConversationList(convs);
  });
}

function renderConversationList(convs) {
  const list = document.getElementById("conv-list");
  list.innerHTML = "";
  if (convs.length === 0) {
    list.innerHTML = `<div class="empty-log">No conversations yet.</div>`;
    return;
  }
  convs.forEach((conv) => {
    const row = document.createElement("div");
    row.className = "conv-row";
    const btn = document.createElement("button");
    btn.className = "day-entry" + (currentChannel.type === "conversation" && conv.id === currentChannel.id ? " active" : "");
    btn.textContent = conv.name;
    btn.onclick = () => openChannel("conversation", conv.id);
    row.appendChild(btn);

    if (conv.createdBy === currentUser || isAdmin()) {
      const del = document.createElement("button");
      del.className = "conv-delete";
      del.title = "Delete conversation";
      del.textContent = "×";
      del.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${conv.name}" and all its messages?`)) return;
        await remove(ref(db, `conversations/${conv.id}`));
        if (currentChannel.type === "conversation" && currentChannel.id === conv.id) {
          openChannel("day", todayKey());
        }
      };
      row.appendChild(del);
    }
    list.appendChild(row);
  });
}

// ---------------------------------------------------------------
// Chat (center pane)
// ---------------------------------------------------------------
async function openChannel(type, id) {
  currentChannel = { type, id };
  const label = type === "day"
    ? formatDayLabel(id)
    : (await get(ref(db, `conversations/${id}/name`))).val() || "Conversation";
  document.getElementById("current-day-label").textContent = label;

  const delBtn = document.getElementById("delete-conv-btn");
  if (type === "conversation") {
    const convSnap = await get(ref(db, `conversations/${id}`));
    const conv = convSnap.val();
    if (conv && (conv.createdBy === currentUser || isAdmin())) {
      delBtn.classList.remove("hidden");
      delBtn.onclick = async () => {
        if (!confirm(`Delete "${conv.name}" and all its messages?`)) return;
        await remove(ref(db, `conversations/${id}`));
        openChannel("day", todayKey());
      };
    } else {
      delBtn.classList.add("hidden");
    }
  } else {
    delBtn.classList.add("hidden");
  }

  document.querySelectorAll("#day-list .day-entry, #conv-list .day-entry").forEach((el) => {
    el.classList.remove("active");
  });
  refreshActiveHighlight();

  const lastReadSnap = await get(ref(db, lastReadPath()));
  lastReadAtOpen = lastReadSnap.exists() ? lastReadSnap.val() : null;

  if (messagesUnsub) messagesUnsub();
  const msgsRef = ref(db, messagesPath());
  messagesUnsub = onValue(msgsRef, (snap) => {
    const messages = [];
    snap.forEach((child) => messages.push({ key: child.key, ...child.val() }));
    messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    console.log(`[messages] ${messagesPath()} -> ${messages.length} message(s)`);
    renderMessages(messages);
  }, (err) => {
    console.error("Message listener error:", err);
  });
}

function refreshActiveHighlight() {
  document.querySelectorAll("#day-list .day-entry").forEach((el) => {
    el.classList.toggle("active", currentChannel.type === "day" && el.querySelector(".day-num")?.textContent === currentChannel.id);
  });
}

function renderMessages(messages) {
  const list = document.getElementById("message-list");
  list.innerHTML = "";

  if (messages.length === 0) {
    list.innerHTML = `<div class="empty-log">No notes yet. Be the first to log an observation.</div>`;
    return;
  }

  let dividerPlaced = lastReadAtOpen === null;
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
    const canDelete = msg.user === currentUser || isAdmin();
    row.innerHTML = `
      <span class="msg-user">${escapeHtml(msg.user)}</span>
      <span class="msg-time">${formatTime(msg.timestamp)}</span>
      <span class="msg-text">${formatMessageText(escapeHtml(msg.text))}</span>
      ${canDelete ? `<button class="msg-delete" title="Delete message">×</button>` : ""}
    `;
    if (canDelete) {
      row.querySelector(".msg-delete").onclick = async () => {
        await remove(ref(db, `${messagesPath()}/${msg.key}`));
      };
    }
    list.appendChild(row);
  });
  list.scrollTop = list.scrollHeight;
}

document.getElementById("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("message-input");
  const errEl = document.getElementById("message-error");
  errEl.textContent = "";
  const text = input.value.trim();
  if (!text || !currentUser) return;
  input.value = "";
  try {
    await push(ref(db, messagesPath()), {
      user: currentUser,
      text,
      timestamp: Date.now()
    });
    console.log("Message pushed OK to", messagesPath());
  } catch (err) {
    console.error("Send failed:", err);
    errEl.textContent = `Send failed: ${err.message || err}`;
    input.value = text; // give the message back so it isn't lost
  }
});

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

// ---------------------------------------------------------------
// Info panel (formatting help + admin controls)
// ---------------------------------------------------------------
function toggleInfoPanel(show) {
  document.getElementById("info-panel").classList.toggle("hidden", !show);
  if (show) renderInfoPanel();
}

function renderInfoPanel() {
  const adminSection = document.getElementById("admin-section");
  if (!isAdmin()) {
    adminSection.classList.add("hidden");
    return;
  }
  adminSection.classList.remove("hidden");
  onValue(ref(db, "users"), (snap) => {
    const rows = [];
    snap.forEach((child) => {
      const key = child.key;
      if (key === ADMIN_HANDLE) return;
      rows.push({ key, displayName: child.val().displayName || key });
    });
    const list = document.getElementById("admin-user-list");
    list.innerHTML = rows.map(u => `
      <div class="admin-user-row">
        <span>${escapeHtml(u.displayName)}</span>
        <button class="admin-remove-btn" data-key="${u.key}">Remove</button>
      </div>
    `).join("") || `<div class="empty-log">No other accounts yet.</div>`;
    list.querySelectorAll(".admin-remove-btn").forEach(btn => {
      btn.onclick = async () => {
        const key = btn.dataset.key;
        if (!confirm(`Remove account "${key}"? Their past messages stay in the log.`)) return;
        await remove(ref(db, `users/${key}`));
        await remove(ref(db, `presence/${key}`));
      };
    });
  });
}
