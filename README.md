# Time-Turner

A Chrome extension that captures the hidden video links behind Canvas, so you can save them to a permanent, synced library or download them directly to your computer. No more right-clicking, opening Inspect Element, and searching for "mp4" by hand. Even if your professor later removes or hides the video from Canvas, you'll still have access to any videos you already saved.

**Live site:** https://time-turner.base44.app

## What it does

- **Save Link**: Saves a lecture's video URL along with its professor, course, title, and date in a searchable library that's synced to your Google account.
- **Download Now**: Downloads the lecture video directly to your computer—no sign-in required.
- **Smart autofill**: Automatically extracts the professor, course, lecture title, and date from the page, so you rarely have to type anything yourself.
- **Google Sign-In**: Sign in with one click—no passwords to remember—and jump straight into your synced library.

## How it's built

- **Chrome Extension (Manifest V3)**: A background service worker monitors network requests and the page DOM for video URLs, a content script extracts page metadata, and a popup UI handles saving, downloading, and opening your library.
- **Backend & hosting (Base44)**: `Lecture` and `Counter` entities, Google authentication, a backend function for the public download counter, and the hosted library website are all powered by Base44.
- **Website**: A lightweight vanilla JavaScript site (`web/`) serves as both the synced lecture library and the public "Get the Extension" installation page.

## Project structure

```
extension/   Chrome extension source (background, content script, popup)
web/         Library website + extension install page
base44/      Entities, backend functions, and project configuration
```

## Local development

```bash
npm install
npm run build        # Bundles the extension into extension/dist/
npm run build:site   # Bundles the website and packages the extension ZIP into site-dist/
```

Load `extension/` (after building `dist/`) as an unpacked extension from `chrome://extensions`.

## Note

This project is a portfolio piece exploring Chrome extension development, OAuth authentication, and Base44 as a backend platform. It does not attempt to enforce or interpret any institution's policies regarding lecture recordings. Users are responsible for following their school's policies and applicable copyright rules.

Built with Claude using Base44 Skills as part of a Base44 micro-internship deliverable.
