import { createClient } from "@base44/sdk";

const APP_ID = "6a553d4464f33e1f15412a81";

// In a browser, createClient automatically picks up ?access_token=... from
// the URL (appended by the OAuth redirect), stores it in localStorage, and
// strips it from the address bar.
const base44 = createClient({ appId: APP_ID });

const app = document.getElementById("app");

let user = null;
let lectures = [];
let query = "";
let groupBy = "professor_name";

// Every view renders inside this shell: left sidebar nav + content area.
function shell(contentHtml) {
  return `
    <aside class="sidebar">
      <a class="brand" href="index.html">⏳ Time-Turner</a>
      <nav>
        <a class="nav-link active" href="index.html">Library</a>
        <a class="nav-link" href="get-extension.html">Get the Extension</a>
      </nav>
    </aside>
    <main class="content">${contentHtml}</main>
  `;
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

async function init() {
  try {
    user = await base44.auth.me();
  } catch {
    user = null;
  }

  if (!user) {
    app.innerHTML = shell(`
      <div class="center-box">
        <h1>Time-Turner</h1>
        <p>Your saved lecture links, organized by professor, course, and date.</p>
        <button id="login-btn">Sign in with Google</button>
        <p class="get-ext-link"><a href="get-extension.html">Don't have the extension yet? Get it here →</a></p>
      </div>
    `);
    document.getElementById("login-btn").addEventListener("click", () => {
      base44.auth.loginWithProvider("google", window.location.href);
    });
    return;
  }

  app.innerHTML = shell(`
    <div class="topbar">
      <h1>Library</h1>
      <span class="whoami">${escapeHtml(user.email)}<button class="ghost" id="logout-btn">Log out</button></span>
    </div>
    <p class="sub">Saved lectures organized by professor, course, or date. Always available.</p>
    <div class="toolbar">
      <input id="search" placeholder="Search professor, title, or course…" />
      <select id="group-by">
        <option value="professor_name">Group by professor</option>
        <option value="course_name">Group by course</option>
        <option value="">No grouping (by date)</option>
      </select>
    </div>
    <div id="list"></div>
  `);

  document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem("base44_access_token");
    localStorage.removeItem("token");
    location.reload();
  });
  document.getElementById("search").addEventListener("input", (e) => {
    query = e.target.value.toLowerCase();
    paint();
  });
  document.getElementById("group-by").addEventListener("change", (e) => {
    groupBy = e.target.value;
    paint();
  });

  await load();
}

async function load() {
  const list = document.getElementById("list");
  try {
    lectures = await base44.entities.Lecture.list("-lecture_date");
    paint();
  } catch (err) {
    list.innerHTML = `<p class="error">Couldn't load lectures: ${escapeHtml(err?.message || String(err))}</p>`;
  }
}

function lectureCard(l) {
  const date = l.lecture_date || "no date";
  const course = l.course_name ? ` · ${escapeHtml(l.course_name)}` : "";
  const prof = l.professor_name ? escapeHtml(l.professor_name) : "Unknown professor";
  return `
    <div class="card" data-id="${l.id}">
      <div class="card-info">
        <div class="card-title">${escapeHtml(l.lecture_title || "Untitled")}</div>
        <div class="card-meta">${prof} · ${escapeHtml(date)}${course}</div>
      </div>
      <div class="card-actions">
        <button class="ghost copy-btn">Copy link</button>
        <button class="ghost open-btn">Open video</button>
        <button class="danger del-btn">Delete</button>
      </div>
    </div>
  `;
}

function paint() {
  const list = document.getElementById("list");
  const filtered = lectures.filter(
    (l) =>
      !query ||
      (l.professor_name || "").toLowerCase().includes(query) ||
      (l.lecture_title || "").toLowerCase().includes(query) ||
      (l.course_name || "").toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty">No saved lectures${query ? " match your search" : " yet — capture one with the extension"}.</div>`;
    return;
  }

  if (!groupBy) {
    list.innerHTML = filtered.map(lectureCard).join("");
  } else {
    const groups = new Map();
    for (const l of filtered) {
      const key = l[groupBy] || (groupBy === "professor_name" ? "Unknown professor" : "No course");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(l);
    }
    list.innerHTML = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, items]) => `<div class="group-header">${escapeHtml(name)}</div>` + items.map(lectureCard).join(""))
      .join("");
  }

  list.querySelectorAll(".copy-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const l = lectures.find((x) => x.id === btn.closest(".card").dataset.id);
      navigator.clipboard.writeText(l.video_url);
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1200);
    })
  );

  list.querySelectorAll(".open-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const l = lectures.find((x) => x.id === btn.closest(".card").dataset.id);
      window.open(l.video_url, "_blank");
    })
  );

  list.querySelectorAll(".del-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this saved lecture link?")) return;
      const id = btn.closest(".card").dataset.id;
      await base44.entities.Lecture.delete(id);
      lectures = lectures.filter((x) => x.id !== id);
      paint();
    })
  );
}

init();
