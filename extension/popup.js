const $ = (sel) => document.querySelector(sel);

const SITE_URL = "https://time-turner.base44.app/";

let activeTabId = null;
let activeTabUrl = "";
let loggedIn = false;
let userEmail = "";
let allLectures = [];

function sendMsg(msg) {
  return chrome.runtime.sendMessage(msg);
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
  activeTabUrl = tab?.url || "";
  await render();
}

async function render() {
  const authRes = await sendMsg({ type: "AUTH_STATE" }).catch(() => null);
  loggedIn = !!authRes?.loggedIn;
  userEmail = authRes?.userEmail || "";

  $("#app").innerHTML = `
    <div class="topbar">
      <span class="brand">Time-Turner</span>
      <span>
        <button id="site-btn" class="link-btn">Open library ↗</button>
        ${loggedIn ? `&nbsp;<button id="logout-btn" class="link-btn">Log out</button>` : ""}
      </span>
    </div>
    ${loggedIn && userEmail ? `<div class="signed-in-as">Signed in as ${escapeHtml(userEmail)}</div>` : ""}
    <div id="pending-section"></div>
    <div id="main-section"></div>
  `;

  $("#site-btn").addEventListener("click", () => {
    chrome.tabs.create({ url: SITE_URL });
  });

  if (loggedIn) {
    $("#logout-btn").addEventListener("click", async () => {
      await sendMsg({ type: "LOGOUT" });
      render();
    });
  }

  await renderPending();

  if (loggedIn) {
    $("#main-section").innerHTML = `
      <div class="search-row">
        <input id="search" placeholder="Filter by professor, title, or course" />
      </div>
      <div id="list-section">Loading…</div>
    `;
    $("#search").addEventListener("input", paintList);
    await loadAndPaintList();
  } else {
    const { lastAuthError } = await chrome.storage.local.get("lastAuthError");
    $("#main-section").innerHTML = `
      <div class="login-box">
        <p>Sign in with Google to keep a synced library of your lecture links. (Downloading works without signing in.)</p>
        <button id="google-btn">Sign in with Google</button>
        <p class="hint">A sign-in tab will open. After signing in you'll land on your library website, and the extension logs in automatically alongside it.</p>
        ${lastAuthError ? `<p class="error">Last sign-in attempt: ${escapeHtml(lastAuthError)}</p>` : ""}
      </div>
    `;
    $("#google-btn").addEventListener("click", () => {
      // Fire-and-forget: opening the sign-in tab takes focus and closes this
      // popup, so nothing here would survive to receive a response anyway.
      sendMsg({ type: "GOOGLE_LOGIN" }).catch(() => {});
    });
  }
}

async function renderPending() {
  const section = $("#pending-section");
  if (activeTabId == null) {
    section.innerHTML = "";
    return;
  }
  const res = await sendMsg({ type: "GET_TAB_STATE", tabId: activeTabId }).catch(() => null);
  const pending = res?.pending;
  if (!pending) {
    const onLecturePage = /leccap|instructure\.com|amazonaws\.com/.test(activeTabUrl);
    section.innerHTML = onLecturePage
      ? `<div class="waiting-card">
           <div class="pending-title">No video detected yet</div>
           <p class="hint">Play the lecture video for a few seconds and reopen this popup.</p>
         </div>`
      : `<p class="hint">Open a Canvas/Leccap lecture page and play the video — Save Link and Download buttons will appear here.</p>`;
    return;
  }

  section.innerHTML = `
    <div class="pending-card">
      <div class="pending-title">Video detected on this page</div>
      <label>Professor
        <input id="p-professor" value="${escapeHtml(pending.professor_name)}" />
      </label>
      <label>Title
        <input id="p-title" value="${escapeHtml(pending.lecture_title)}" />
      </label>
      <label>Date
        <input id="p-date" type="date" value="${escapeHtml(pending.lecture_date)}" />
      </label>
      <label>Course
        <input id="p-course" value="${escapeHtml(pending.course_name)}" />
      </label>
      <div class="pending-actions">
        <button id="save-link-btn" ${loggedIn ? "" : 'disabled title="Sign in below to save links"'}>Save Link</button>
        <button id="download-btn">Download Now</button>
      </div>
      <button id="dismiss-btn" class="link-btn">Dismiss</button>
    </div>
  `;

  function currentLecture() {
    return {
      professor_name: $("#p-professor").value.trim(),
      lecture_title: $("#p-title").value.trim(),
      lecture_date: $("#p-date").value,
      course_name: $("#p-course").value.trim(),
      video_url: pending.video_url,
      canvas_url: pending.canvas_url,
    };
  }

  $("#save-link-btn").addEventListener("click", async (e) => {
    e.target.textContent = "Saving…";
    const res = await sendMsg({ type: "SAVE_LECTURE", lecture: currentLecture(), tabId: activeTabId });
    if (res?.loggedOut) return render();
    if (res?.error) {
      alert("Save failed: " + res.error);
      e.target.textContent = "Save Link";
      return;
    }
    await renderPending();
    if (loggedIn) await loadAndPaintList();
  });

  $("#download-btn").addEventListener("click", async (e) => {
    e.target.textContent = "Downloading…";
    const res = await sendMsg({ type: "DOWNLOAD_VIDEO", lecture: currentLecture(), tabId: activeTabId });
    if (res?.error) alert("Download failed: " + res.error);
    await renderPending();
  });

  $("#dismiss-btn").addEventListener("click", async () => {
    await sendMsg({ type: "DISMISS_PENDING", tabId: activeTabId });
    await renderPending();
  });
}

async function loadAndPaintList() {
  const listSection = $("#list-section");
  if (!listSection) return;
  const res = await sendMsg({ type: "LIST_LECTURES" });
  if (res?.loggedOut) return render();
  if (res?.error) {
    listSection.innerHTML = `<p class="error">Could not load lectures: ${escapeHtml(res.error)}</p>`;
    return;
  }
  allLectures = res?.lectures || [];
  paintList();
}

function paintList() {
  const listSection = $("#list-section");
  if (!listSection) return;
  const q = ($("#search")?.value || "").toLowerCase();
  const filtered = allLectures.filter(
    (l) =>
      !q ||
      (l.professor_name || "").toLowerCase().includes(q) ||
      (l.lecture_title || "").toLowerCase().includes(q) ||
      (l.course_name || "").toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    listSection.innerHTML = `<p class="empty">No saved lectures yet.</p>`;
    return;
  }

  listSection.innerHTML = filtered
    .map(
      (l) => `
      <div class="lecture-row" data-id="${l.id}">
        <div class="lecture-info">
          <div class="lecture-title">${escapeHtml(l.lecture_title || "Untitled")}</div>
          <div class="lecture-meta">${escapeHtml(l.professor_name || "Unknown professor")} · ${escapeHtml(l.lecture_date || "no date")}</div>
        </div>
        <div class="lecture-actions">
          <button class="icon-btn copy-btn" title="Copy link">Copy</button>
          <button class="icon-btn dl-btn" title="Download">Download</button>
          <button class="icon-btn del-btn" title="Delete">Delete</button>
        </div>
      </div>`
    )
    .join("");

  listSection.querySelectorAll(".copy-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const id = e.target.closest(".lecture-row").dataset.id;
      const lecture = allLectures.find((l) => l.id === id);
      navigator.clipboard.writeText(lecture.video_url);
      const original = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = original), 1200);
    })
  );

  listSection.querySelectorAll(".dl-btn").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".lecture-row").dataset.id;
      const lecture = allLectures.find((l) => l.id === id);
      const original = btn.textContent;
      btn.textContent = "…";
      const res = await sendMsg({ type: "DOWNLOAD_VIDEO", lecture });
      if (res?.error) alert("Download failed: " + res.error);
      btn.textContent = original;
    })
  );

  listSection.querySelectorAll(".del-btn").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest(".lecture-row").dataset.id;
      if (!confirm("Delete this saved lecture link?")) return;
      const res = await sendMsg({ type: "DELETE_LECTURE", id });
      if (res?.loggedOut) return render();
      await loadAndPaintList();
    })
  );
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "PENDING_CAPTURE_UPDATED" && msg.tabId === activeTabId) {
    renderPending();
  }
});

// If sign-in completes or fails while this popup happens to be open (e.g. the
// user reopened it mid-flow), re-render immediately.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.authToken || changes.lastAuthError)) {
    render();
  }
});

init();
