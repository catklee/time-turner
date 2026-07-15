// Best-effort scraper for lecture metadata on Canvas / Leccap pages.
// Selectors vary by institution/theme, so this tries several patterns and
// leaves fields blank when nothing matches -- the popup lets the user
// correct anything before saving.

function safeText(el) {
  return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
}

function firstMatch(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    const text = safeText(el);
    if (text) return text;
  }
  return "";
}

function normalizeDate(str) {
  const d = new Date(str);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function extractMetadata() {
  const meta = {};

  meta.course_name = firstMatch([
    "#breadcrumbs li:nth-last-child(2) a",
    ".ic-app-crumbs li:nth-last-child(2) a",
    "[class*='course-name']",
    "[class*='courseName']",
  ]);

  meta.lecture_title = firstMatch([
    "[class*='recording-title']",
    "[class*='lecture-title']",
    "[class*='video-title']",
    "h1",
  ]) || document.title.split(/[-|·]/)[0].trim();

  const bodyText = document.body?.innerText || "";

  const profMatch = bodyText.match(
    /(?:Instructor|Professor|Presenter|Speaker)s?:\s*([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){0,3})/
  );
  meta.professor_name = profMatch ? profMatch[1].trim() : "";

  const dateMatch = bodyText.match(
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/
  );
  meta.lecture_date = dateMatch ? normalizeDate(dateMatch[1]) : "";

  meta.canvas_url = location.href;

  return meta;
}

// The automated version of "Inspect Element -> search mp4": hunt for .mp4
// URLs directly in the DOM -- video/source elements, every attribute value,
// and inline script text (players often keep media URLs in a config JSON).
function findMp4Urls() {
  const urls = new Set();

  const harvest = (val) => {
    if (!val) return;
    // JSON configs often escape slashes (https:\/\/...) -- undo that first.
    const cleaned = String(val).replace(/\\\//g, "/");
    const matches = cleaned.match(/https?:\/\/[^"'\s<>\\]+\.mp4[^"'\s<>\\]*/gi) || [];
    matches.forEach((m) => urls.add(m));
  };

  document.querySelectorAll("video, source").forEach((el) => {
    const src = el.currentSrc || el.getAttribute("src") || "";
    if (src && !src.startsWith("blob:")) {
      try {
        const abs = new URL(src, location.href).toString();
        if (/\.mp4/i.test(abs)) urls.add(abs);
      } catch {
        // ignore unparsable src values
      }
    }
  });

  document.querySelectorAll("*").forEach((el) => {
    for (const attr of el.attributes) harvest(attr.value);
  });

  document.querySelectorAll("script:not([src])").forEach((s) => harvest(s.textContent));

  return [...urls];
}

let lastSent = "";
function sendFindings() {
  const meta = extractMetadata();
  const videoUrls = findMp4Urls();
  const key = JSON.stringify([meta, videoUrls]);
  if (key === lastSent) return;
  lastSent = key;
  chrome.runtime.sendMessage({ type: "CONTENT_METADATA", meta, videoUrls }).catch(() => {});
}

sendFindings();
setTimeout(sendFindings, 1500);
setTimeout(sendFindings, 4000);

let debounceTimer = null;
const observer = new MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendFindings, 500);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

setTimeout(() => observer.disconnect(), 60000);
