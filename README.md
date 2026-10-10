# Re-Volt Browser Game

The game runs directly from `index.html`. Its styles, game modules, asset manifest, and phone controls are embedded in that HTML page. There is no npm installation or Vite compilation step to play or publish it.

Keep the `cars`, `gfx`, `levels`, `models`, and `wavs` folders next to the HTML page. Three.js, Rapier, and three-mesh-bvh load from pinned CDN URLs, so an internet connection is required. Serve the page over HTTP; opening it with a file:// URL does not support the game's asset requests.

## Local play

Run a static server from the repository folder:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Open http://localhost:8000/ on your computer, or http://YOUR_COMPUTER_IP:8000/ on a phone connected to the same Wi-Fi. Edit `index.html` and refresh to see changes immediately.

## Controls

- Phone: tap Start Race, then hold Gas and the left/right steering buttons together. Brake also reverses; Slide is the handbrake. Tap the power-up icon to use it.
- Keyboard: WASD or arrows drive; Space handbrake; F or left Ctrl uses a power-up; R resets; C changes camera; Escape opens the menu.

## Public site

The GitHub Actions workflow only copies and publishes the static HTML and asset folders on pushes to main. It does not install dependencies, run Vite, or compile the game. GitHub Pages still needs a short publishing step to make changed repository files available on the public URL.

For runtime edits, change the embedded modules and styles in `index.html`. The `src` files and existing Node tests remain as reference sources; editing those files alone does not change the embedded HTML game.

## Asset Rights

Original Re-Volt models, textures, and sounds retain their original owners' rights. Their inclusion does not grant a license to redistribute them; use and hosting require appropriate permission. No ownership of those assets is claimed by this prototype.
