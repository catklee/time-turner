import { createClient } from "@base44/sdk";

const APP_ID = "6a553d4464f33e1f15412a81";
const BASE44_SERVER_URL = "https://base44.app";
// The app's own hosted library site (deployed via `base44 site deploy`).
// It doubles as the OAuth landing page: Base44 appends ?access_token=...
// when redirecting here, the site logs itself in with it, and the
// extension harvests the same token from the tab URL in passing.
const SITE_URL = "https://time-turner.base44.app/";

let base44 = createClient({ appId: APP_ID });
let authToken = null;

// MV3 service workers are killed after ~30s idle and respawned on the next
// event, so module-level variables are NOT durable. Everything that must
// survive lives in chrome.storage: the auth token in storage.local, and
// per-tab capture state in storage.session (cleared on browser restart,
// which is the right lifetime for "a video was detected on this tab").
async function loadToken() {
  // Clean up keys left over from the abandoned email/OTP login flow.
  chrome.storage.local.remove(["savedEmail", "savedPassword", "pendingEmail", "pendingPassword", "pendingMode"]);
  const { authToken: stored } = await chrome.storage.local.get("authToken");
  if (stored) {
    authToken = stored;
    base44.auth.setToken(stored, false);
  }
}
const tokenReady = loadToken();

// ---------------- per-tab capture state ----------------

async function getTabRecord(tabId) {
  const key = `tab:${tabId}`;
  const data = await chrome.storage.session.get(key);
  return data[key] || { meta: {}, capturedUrls: [], pending: null };
}

async function setTabRecord(tabId, rec) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: rec });
}

// ---------------- video capture ----------------

function isVideoUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = (u.pathname + u.search).toLowerCase();
    const isLikelyLecturePlatform = host.includes("leccap") || host.endsWith(".amazonaws.com");
    return isLikelyLecturePlatform && path.includes(".mp4");
  } catch {
    return false;
  }
}

// A playing <video> issues many range requests for the same URL; this keeps
// concurrent handler runs from double-processing before storage catches up.
const inFlightCaptures = new Set();

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (!isVideoUrl(details.url)) return;
    const key = `${details.tabId}|${details.url}`;
    if (inFlightCaptures.has(key)) return;
    inFlightCaptures.add(key);
    handleCapturedVideo(details.tabId, details.url);
  },
  { urls: ["*://*.leccap.engin.umich.edu/*", "*://*.amazonaws.com/*"] }
);

// Lecture/page titles usually carry most of what we need, e.g.
// "Lecture 27 (Econ Major - Not Testable) | ECON 101 400 - Fall 2025" or
// "EECS 280 Lecture recorded 12/05/2025". Mine them so the user edits
// instead of hand-typing.
function parseTitleGuesses(rawTitle) {
  const out = { lecture_title: "", lecture_date: "", course_name: "", professor_name: "" };
  if (!rawTitle) return out;
  const title = String(rawTitle).replace(/\s+/g, " ").trim();

  const dateMatch =
    title.match(/\b(\d{4}-\d{2}-\d{2})\b/) ||
    title.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/) ||
    title.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i);
  if (dateMatch) {
    const d = new Date(dateMatch[1]);
    if (!isNaN(d.getTime())) out.lecture_date = d.toISOString().slice(0, 10);
  }

  // Course codes like "ECON 101", "EECS 280", optionally with a section
  // number ("ECON 101 400").
  const courseMatch = title.match(/\b([A-Z]{2,8} ?\d{3}(?: \d{3})?)\b/);
  if (courseMatch) out.course_name = courseMatch[1];

  const profMatch = title.match(
    /(?:Professor|Prof\.?|Instructor|Dr\.?)[:\s]+([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)/
  );
  if (profMatch) out.professor_name = profMatch[1].trim();

  // Lecture title: the segment that mentions the lecture itself, else the
  // first segment.
  const segments = title
    .split(/\s*[|·—>]\s*|\s+-\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const lectureSeg = segments.find((s) => /lect|recitation|discussion|review|exam/i.test(s));
  out.lecture_title = lectureSeg || segments[0] || title;
  return out;
}

async function handleCapturedVideo(tabId, url) {
  const rec = await getTabRecord(tabId);
  if (rec.capturedUrls.includes(url)) return;
  rec.capturedUrls.push(url);
  if (rec.capturedUrls.length > 50) rec.capturedUrls.shift();

  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    // tab may already be closed
  }

  // Guess missing fields from both the scraped title and the tab title.
  const guesses = parseTitleGuesses(`${rec.meta.lecture_title || ""} | ${tab?.title || ""}`);

  rec.pending = {
    tabId,
    video_url: url,
    professor_name: rec.meta.professor_name || guesses.professor_name || "",
    lecture_title: rec.meta.lecture_title || guesses.lecture_title || tab?.title || "",
    lecture_date: rec.meta.lecture_date || guesses.lecture_date || "",
    course_name: rec.meta.course_name || guesses.course_name || "",
    canvas_url: tab?.url || rec.meta.canvas_url || "",
    captured_at: new Date().toISOString(),
  };
  await setTabRecord(tabId, rec);

  chrome.action.setBadgeText({ tabId, text: "1" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  chrome.runtime.sendMessage({ type: "PENDING_CAPTURE_UPDATED", tabId }).catch(() => {});
}

async function clearPendingIfMatches(tabId, videoUrl) {
  const rec = await getTabRecord(tabId);
  if (rec.pending && (!videoUrl || rec.pending.video_url === videoUrl)) {
    rec.pending = null;
    await setTabRecord(tabId, rec);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
}

function buildFilename(lecture) {
  const safe = (s) => (s || "").replace(/[\\/:*?"<>|]/g, "-").trim();
  const parts = [safe(lecture.course_name), safe(lecture.lecture_date), safe(lecture.lecture_title) || "lecture"].filter(Boolean);
  // NOTE: chrome.downloads can only write inside the browser's download
  // directory -- absolute paths like ~/Desktop are rejected by Chrome for
  // all extensions. This subfolder is auto-created on first download.
  return `downloaded lectures/${parts.join(" - ")}.mp4`;
}

// ---------------- Google sign-in ----------------
//
// The login endpoint comes from the SDK's own loginWithProvider('google')
// (node_modules/@base44/sdk/dist/modules/auth.js):
//   {server}/api/apps/auth/login?app_id=...&from_url=...
// After OAuth completes, the server redirects to from_url with
// ?access_token=... appended. We run the whole flow in a normal browser tab
// (not chrome.identity.launchWebAuthFlow, whose invisible window gave no way
// to see where the flow stalled) with from_url pointed at base44.app itself,
// and harvest the token from the tab's URL the moment it appears. Any
// failure is written to storage.local.lastAuthError so the popup can show
// it instead of failing silently.

function extractAccessToken(urlStr) {
  try {
    const url = new URL(urlStr);
    const fromQuery = url.searchParams.get("access_token");
    if (fromQuery) return fromQuery;
    const hash = url.hash.replace(/^#/, "");
    const hashParams = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : hash);
    return hashParams.get("access_token");
  } catch {
    return null;
  }
}

async function startGoogleLogin() {
  await chrome.storage.local.remove("lastAuthError");
  const loginUrl = `${BASE44_SERVER_URL}/api/apps/auth/login?app_id=${APP_ID}&from_url=${encodeURIComponent(SITE_URL)}`;
  const tab = await chrome.tabs.create({ url: loginUrl, active: true });
  await chrome.storage.session.set({ authTabId: tab.id });
}

async function completeLogin(token) {
  try {
    authToken = token;
    base44.auth.setToken(token, false);
    // Validate the token immediately -- if this fails we want the reason on
    // the login screen, not a popup that claims to be signed in but can't
    // load anything.
    const user = await base44.auth.me();
    await chrome.storage.local.set({ authToken: token, userEmail: user?.email || "" });
    await chrome.storage.local.remove("lastAuthError");
  } catch (err) {
    authToken = null;
    await chrome.storage.local.remove("authToken");
    await chrome.storage.local.set({
      lastAuthError: "Google sign-in finished, but the session was rejected: " + (err?.message || err),
    });
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url || !changeInfo.url.includes("access_token")) return;
  const { authTabId } = await chrome.storage.session.get("authTabId");
  if (tabId !== authTabId) return;
  let host = "";
  try {
    host = new URL(changeInfo.url).hostname;
  } catch {
    return;
  }
  if (!host.endsWith("base44.app") && !host.endsWith(".chromiumapp.org")) return;
  const token = extractAccessToken(changeInfo.url);
  if (!token) return;
  await chrome.storage.session.remove("authTabId");
  // Leave the tab open: it's the user's library website, which is exactly
  // where they should land after signing in. The site logs itself in with
  // the same token; we just mirror it into the extension.
  await completeLogin(token);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`);
  const { authTabId } = await chrome.storage.session.get("authTabId");
  if (tabId === authTabId) {
    await chrome.storage.session.remove("authTabId");
    await tokenReady;
    if (!authToken) {
      await chrome.storage.local.set({ lastAuthError: "The sign-in tab was closed before finishing." });
    }
  }
});

// ---------------- auth/session helpers ----------------

function isAuthError(err) {
  const status = err?.status ?? err?.response?.status;
  return status === 401;
}

async function forceLogout() {
  authToken = null;
  await chrome.storage.local.remove(["authToken", "userEmail"]);
  base44 = createClient({ appId: APP_ID });
}

async function handleExpiredSession() {
  await forceLogout();
  const message = "Your session expired — please sign in again.";
  await chrome.storage.local.set({ lastAuthError: message });
  return { error: message, loggedOut: true };
}

// ---------------- messages ----------------

async function handleMessage(msg, sender) {
  await tokenReady;
  switch (msg.type) {
    case "CONTENT_METADATA": {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: false };
      const rec = await getTabRecord(tabId);
      rec.meta = { ...rec.meta, ...msg.meta };
      if (rec.pending) {
        const guesses = parseTitleGuesses(`${msg.meta.lecture_title || ""} | ${rec.pending.lecture_title || ""}`);
        for (const k of ["professor_name", "lecture_title", "lecture_date", "course_name"]) {
          if (!rec.pending[k]) rec.pending[k] = msg.meta[k] || guesses[k] || "";
        }
      }
      await setTabRecord(tabId, rec);

      // mp4 URLs the content script found in the page DOM (the automated
      // "Inspect Element -> search mp4"). Prefer ones on known lecture
      // hosts; fall back to whatever was found so the user can decide.
      const found = msg.videoUrls || [];
      if (found.length > 0) {
        const best = found.find(isVideoUrl) || found[0];
        await handleCapturedVideo(tabId, best);
      }
      return { ok: true };
    }

    case "GET_TAB_STATE": {
      const rec = await getTabRecord(msg.tabId);
      return { pending: rec.pending };
    }

    case "DISMISS_PENDING": {
      await clearPendingIfMatches(msg.tabId, null);
      return { ok: true };
    }

    case "AUTH_STATE": {
      const { userEmail } = await chrome.storage.local.get("userEmail");
      return { loggedIn: !!authToken, userEmail: userEmail || "" };
    }

    case "GOOGLE_LOGIN": {
      try {
        await startGoogleLogin();
        return { ok: true };
      } catch (err) {
        const message = err?.message || "Couldn't open the sign-in tab";
        await chrome.storage.local.set({ lastAuthError: message });
        return { error: message };
      }
    }

    case "LOGOUT": {
      await forceLogout();
      await chrome.storage.local.remove("lastAuthError");
      return { ok: true };
    }

    case "SAVE_LECTURE": {
      if (!authToken) return { error: "Not signed in" };
      try {
        // Drop empty fields so e.g. a blank date doesn't trip the entity's
        // date-format validation.
        const lecture = {};
        for (const [k, v] of Object.entries(msg.lecture)) {
          if (v !== "" && v != null) lecture[k] = v;
        }
        const record = await base44.entities.Lecture.create(lecture);
        if (msg.tabId != null) await clearPendingIfMatches(msg.tabId, msg.lecture.video_url);
        return { ok: true, record };
      } catch (err) {
        if (isAuthError(err)) return handleExpiredSession();
        return { error: err?.message || "Save failed" };
      }
    }

    case "LIST_LECTURES": {
      if (!authToken) return { error: "Not signed in" };
      try {
        const lectures = await base44.entities.Lecture.list("-lecture_date");
        return { ok: true, lectures };
      } catch (err) {
        if (isAuthError(err)) return handleExpiredSession();
        return { error: err?.message || "Failed to load lectures" };
      }
    }

    case "DELETE_LECTURE": {
      if (!authToken) return { error: "Not signed in" };
      try {
        await base44.entities.Lecture.delete(msg.id);
        return { ok: true };
      } catch (err) {
        if (isAuthError(err)) return handleExpiredSession();
        return { error: err?.message || "Delete failed" };
      }
    }

    case "DOWNLOAD_VIDEO": {
      try {
        const downloadId = await chrome.downloads.download({
          url: msg.lecture.video_url,
          filename: buildFilename(msg.lecture),
          saveAs: false,
        });
        if (msg.tabId != null) await clearPendingIfMatches(msg.tabId, msg.lecture.video_url);
        return { ok: true, downloadId };
      } catch (err) {
        return { error: err?.message || "Download failed" };
      }
    }

    default:
      return { error: "Unknown message type: " + msg.type };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err?.message || String(err) }));
  return true;
});
