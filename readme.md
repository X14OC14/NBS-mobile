# NBS Mobile

Note Block Studio clone, mobile-friendly. Import `.nbs`, edit grid, playback via Web Audio.

## Deploy ke GitHub Pages (via Actions)

1. Push folder ini ke repo GitHub (branch `main`).
2. Di repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push apa aja ke `main` → workflow `.github/workflows/deploy.yml` otomatis build (Vite) dan deploy ke Pages.
4. URL live-nya muncul di tab **Actions** (job `deploy`) atau di Settings → Pages, biasanya `https://<username>.github.io/<repo>/`.

## Dev lokal

```bash
npm install
npm run dev
```

