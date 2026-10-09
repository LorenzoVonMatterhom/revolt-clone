# Re-Volt Three.js Clone

A browser-based RC racing prototype using Three.js, Rapier, and the game assets supplied with this project.

## Development

```sh
npm ci
npm run dev
```

## Controls

- WASD or arrow keys: drive
- Space: handbrake
- F or left Ctrl: use power-up
- R: reset car
- C: change camera
- Escape: main menu

The temporary Debug panel can give, activate, and clear power-ups during races.

## Tests and Build

```sh
npm test
npm run build
```

## Online Preview

The GitHub Actions workflow builds and deploys the game to GitHub Pages on pushes to `main`. In repository Settings > Pages, select **GitHub Actions** as the deployment source.

For a repository-scoped local production build, set `GITHUB_PAGES=true` before running `npm run build`.

## Asset Rights

Original Re-Volt models, textures, and sounds retain their original owners' rights. Their inclusion does not grant a license to redistribute them; use and hosting require appropriate permission. No ownership of those assets is claimed by this prototype.
