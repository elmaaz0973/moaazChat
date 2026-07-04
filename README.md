# Moaaz Chat

A real-time chat app built with Firebase (Auth + Firestore).

## Files
- `index.html` — page structure
- `style.css` — custom styles
- `script.js` — app logic (Firebase Auth, Firestore, chat, friends, groups, stories)

## Run locally
This project uses ES modules, so it must be served over `http://`, not opened directly as a file.

**Option 1 — Node.js**
```bash
npx serve .
```
Then open the printed `http://localhost:3000` link.

**Option 2 — VS Code**
Install the "Live Server" extension, right-click `index.html`, and choose "Open with Live Server".

## Run on GitHub Pages (works from any device, no install needed)
1. Push this folder to a GitHub repository.
2. Go to the repo's **Settings → Pages**.
3. Under "Source", pick the branch (usually `main`) and root folder, then Save.
4. GitHub will give you a public URL like:
   ```
   https://<your-username>.github.io/<repo-name>/
   ```
5. Open that link from any phone, tablet, or computer — no setup required.

## Firebase setup
Make sure in the [Firebase Console](https://console.firebase.google.com) for this project:
- **Authentication → Sign-in method → Email/Password** is enabled.
- **Firestore Database → Rules** are published (see the app's data model: `users`, `friends`, `groups`, `groupMembers`, `messages`, `stories`, `storyViews`, `typingStatus`).

Note: image/file uploads (Firebase Storage) are disabled in this version to avoid requiring the paid Blaze plan. The app works fully with text messages, friends, groups, and text-only stories.
