# Group Project for Daikon Observation Lab

A small Discord-style chatroom: username/password accounts, a running log of
days on the left (a fresh empty tab appears automatically each new day),
a chat stream in the middle with timestamps, and a member list on the right
showing who's online/offline. When you go offline (closing the tab, switching
away, or hitting "Sign off") it remembers where you left off, and shows a
red "unread notes start here" line when you come back.

## 1. Deploy to GitHub Pages

1. Create a new GitHub repo (public or private, either works for Pages on
   most plans).
2. Push these three files to the repo root: `index.html`, `style.css`, `app.js`.
3. In the repo, go to **Settings → Pages**, set "Source" to your main branch
   (root folder), and save.
4. Wait a minute, then your site is live at
   `https://<your-username>.github.io/<repo-name>/`.

## 2. Lock down your Firebase database (do this before sharing the link)

Right now your Realtime Database is probably in "test mode," which means
**anyone on the internet can read and write to it**, not just your friends.
Go to Firebase console → Realtime Database → Rules, and paste this in:

```json
{
  "rules": {
    "users": {
      ".read": false,
      ".write": true,
      "$uid": {
        ".read": false
      }
    },
    "presence": {
      ".read": true,
      ".write": true
    },
    "days": {
      ".read": true,
      ".write": true
    },
    "lastRead": {
      ".read": true,
      ".write": true
    }
  }
}
```

This keeps password hashes unreadable from outside while still letting the
app work. It does **not** require a login to read/write chat data — true
per-user write authentication would need real Firebase Auth (email-based),
which you said you didn't want. Good enough for a small friend group; not
appropriate for anything sensitive.

## 3. Known limitations (read before you rely on this)

- **Passwords are hashed client-side (SHA-256) but that's it.** There's no
  real server checking credentials, so this is closer to "a lock on a shed"
  than "a bank vault." Don't reuse a real password here.
- **No rate limiting / spam protection.** Anyone with the link can technically
  hit the database directly, not just through your UI.
- **"Online/offline" is best-effort.** It updates on tab close, tab-hide, and
  manual sign-off, but a hard crash or killed browser process can occasionally
  leave someone shown as online for a few seconds until Firebase's own
  disconnect detection catches up.
- Free Firebase tier (Spark plan) comfortably covers a small friend group;
  you'd need heavy, sustained use to approach any limits.

## 4. Customizing

- Colors/fonts: `style.css`, top `:root` block.
- Day format / label: `formatDayLabel()` in `app.js`.
- The app always sets the page title to "Group Project for Daikon Observation
  Lab" — change that string at the top of `app.js` if you want something else.
