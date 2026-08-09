# TimeTracker

A simple installable web app (PWA) for tracking time spent on projects. Runs entirely
in the browser — no build step, no backend required. Data is stored locally on your
device (IndexedDB); optional cloud sync is available via your own free Firebase project.

## Features

- Start/stop timer per project, with a live-updating elapsed time display
- Manual time entries (add/edit/delete by hand)
- History grouped by day, with today/this-week totals
- Projects with custom colors, archive or delete
- Installable to the iPhone Home Screen, works offline
- Optional cloud sync (Firestore) to back up data and sync across devices

## Running it locally (for testing on a computer)

No Node.js or build tools required. From this folder, run a static file server, e.g.:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080` in a browser. A service worker requires `https://`
or `http://localhost` — both work fine for local testing.

## Installing on your iPhone

The app needs to be served over HTTPS from a real URL for your iPhone to reach it
(localhost only works for a computer browser). The easiest free options:

1. **GitHub Pages** — push this folder to a GitHub repo, enable Pages in the repo
   settings (Settings → Pages → Deploy from branch), and it'll be live at
   `https://<username>.github.io/<repo>/`.
2. **Netlify / Vercel** — drag-and-drop the folder deploy, free tier, HTTPS included.

Once it's live:

1. Open the URL in **Safari** on your iPhone (must be Safari, not Chrome, for
   "Add to Home Screen" to create a full standalone app).
2. Tap the Share icon → **Add to Home Screen**.
3. Launch it from the Home Screen icon — it opens full-screen, no browser chrome,
   and works offline after the first load.

## Optional: cloud sync setup

By default all data stays on-device only. To sync across devices/backups:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and
   create a free project.
2. In **Build → Firestore Database**, create a database (start in production mode;
   you can tighten security rules later — see below).
3. In **Build → Authentication → Sign-in method**, enable **Google** as a provider.
4. In **Project settings → Your apps**, add a **Web app** and copy the config
   object it gives you (looks like `{ apiKey: "...", authDomain: "...", ... }`).
5. In the TimeTracker app, go to **Settings → Set up cloud sync**, paste that
   JSON config in, and tap **Connect**. Sign in with Google when prompted.

### Recommended Firestore security rules

By default a new Firestore database may allow open access. Lock it down to each
signed-in user's own data by pasting this into **Firestore → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Project structure

```
index.html        App shell and markup
css/styles.css     Styling (light/dark aware, iPhone safe-area aware)
js/db.js           IndexedDB local storage layer
js/app.js          App logic, rendering, event handling
js/sync.js         Optional Firebase sync (lazy-loaded, off by default)
manifest.json      PWA manifest (icons, name, theme)
sw.js              Service worker for offline caching
icons/             App icons
gen_icons.py       One-off script used to generate the icons (not needed at runtime)
```
