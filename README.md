# Time-Turner

A Chrome extension that captures the hidden video links behind Canvas and Leccap lectures, so you can save them to a permanent, synced library or download them straight to your computer, no more right-click, Inspect Element, and searching for "mp4" by hand.

Live site: https://time-turner.base44.app

## What it does

- **Save Link**: stores the lecture's video URL along with professor, title, date, and course, organized and searchable in a personal library synced to your Google account.
- **Download Now**: downloads the lecture video directly to a "downloaded lectures" folder, no sign-in required.
- **Smart field filling**: parses the page and tab titles to auto-fill professor, course, date, and lecture title, so you rarely have to type anything by hand.
- **Google sign-in**: one click, no password, lands you straight on your library after authenticating.

## How it's built

- **Chrome Extension (Manifest V3)**: a background service worker watches network requests and the page DOM for video URLs, a content script scrapes page metadata, and a popup UI handles the save/download/library flow.
- **Backend and hosting (Base44)**: the `Lecture` and `Counter` entities, a backend function for the public download counter, authentication, and the hosted library website all run on Base44.
- **Website**: a small vanilla JS site (`web/`) serves as both the synced library and the public-facing "Get the Extension" install page.

## Project structure

```
extension/     Chrome extension source (background, content script, popup)
web/           Library website + extension install page
base44/        Entities, backend functions, and project config
```

## Local development

```bash
npm install
npm run build        # bundles the extension into extension/dist/
npm run build:site   # bundles the website + packages the extension zip into site-dist/
```

Load `extension/` (with `dist/` built) as an unpacked extension via `chrome://extensions`.

## Note on scope

This project is a portfolio piece exploring browser extension development, OAuth flows, and Base44 as a backend. It isn't concerned with enforcing any particular institution's policy on downloading lecture recordings, that's left to the user's own judgment and their school's rules.

---

Built with [Claude](https://claude.ai) using Base44 skills, as part of a Base44 microinternship deliverable.
