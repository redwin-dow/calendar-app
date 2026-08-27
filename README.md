# Datebook — Calendar & Tasks (PWA)

A local-only calendar & task app with Month/Week/Day views, categories,
priorities, color tags, and recurring "special dates" (one-off, annual,
monthly). All data is stored on your device only (IndexedDB) — nothing
is sent anywhere, and there's no login.

## Try it locally first (desktop browser)

You can't just double-click `index.html` — browsers block IndexedDB and
service workers on `file://` pages. Run a tiny local server instead:

```bash
cd calendar-app
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Install on your Android phone

A PWA needs to be served over **HTTPS** from a real URL for "Add to Home
screen" / offline support to work. Two easy, free ways to get that:

### Option A — GitHub Pages (you already use GitHub)
1. Push this `calendar-app` folder to a GitHub repo (or a `docs/` folder in
   an existing repo).
2. Repo Settings → Pages → set source to that branch/folder.
3. GitHub gives you a URL like `https://yourname.github.io/calendar-app/`.

### Option B — Netlify Drop (no git needed)
1. Go to https://app.netlify.com/drop
2. Drag the whole `calendar-app` folder onto the page.
3. You instantly get an `https://random-name.netlify.app` URL.

### Then, on your phone
1. Open the HTTPS URL in **Chrome** on Android.
2. Tap the **⋮** menu → **"Add to Home screen"** (or you may see an
   automatic **"Install app"** prompt).
3. It now opens full-screen from your home screen like a native app.

## Notes & limitations

- **Offline**: once installed, the app shell is cached, so it opens even
  without signal. Data lives in the browser's IndexedDB on that device only.
- **No multi-device sync**: by design (per your answer) — this is single
  phone/browser only. If you ever install it fresh, or clear site data,
  you start empty.
- **No background push notifications**: this is a static, serverless app,
  so it can't reliably wake up and buzz you when closed. Instead, it
  actively checks for overdue (unfinished, past-date) tasks every time you
  open it, and prompts you once per day to reassign or complete them.
- **Backups**: since everything is local to the phone, consider it "at
  risk" if you uninstall the app or clear browser data. If that matters,
  let me know and I can add an export/import-to-JSON button so you can
  back up your data manually.

## File overview

- `index.html` — structure & modals
- `styles.css` — dark theme, mobile-first
- `app.js` — all app logic (storage, rendering, task/date CRUD)
- `manifest.json` — PWA metadata (name, icons, colors)
- `sw.js` — service worker (offline caching)
- `icons/` — app icons
