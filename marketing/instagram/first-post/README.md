# Instagram first post: Tableverse launch introduction

Final files (do not publish before approval; nothing here is committed):
- `slides/slide-01.png` to `slide-05.png`: the carousel, 1080 x 1350 (4:5).
- `preview-all-slides.png`: all five side by side.
- `cover-square-1080.png` (1080 x 1080) and `cover-link-1200x630.png`: shareable cover images.
- `caption.md`: posting order, the final caption and hashtags, alt text, and the claims check. `POSTING_GUIDE.md`: step-by-step posting and profile set-up.
- `src/`: editable source. `slides.html` and `cover.html` (HTML/CSS, one `.slide` per slide), `render.js` (renders PNGs with Playwright), `capture.js` (captures the screenshots from the running front-end), `assets/` (copies of the brand SVGs from `public/brand/svg`), `fonts/` (Poppins Bold, Inter, both SIL OFL), `shots/` (the captured app screenshots).

Identity: `docs/BRAND.md` ("Your Seat"). Colours deep felt #071510, felt #153228, turn gold #fbbf24, seat mint #86efac, table ivory #f0fdf4. Poppins Bold headlines, Inter text. The logo files are unmodified copies.

Screenshots: the real Tableverse front-end (`public/`) running the real game engines (`games/`) at 390 x 844 (2x), with sample player names and a sample table code. There is no live server and no real player data.

Rebuild (run from the repository root): `NODE_PATH=<playwright dir> node marketing/instagram/first-post/src/capture.js` to capture the screenshots, then `NODE_PATH=<playwright dir> node marketing/instagram/first-post/src/render.js` to render the PNGs. `NODE_PATH` is needed whenever Playwright is installed outside the project. Preview (run from `marketing/instagram/first-post/`, the folder that contains `slides/`): `montage slides/slide-0*.png -tile 5x1 -geometry 432x540+12+12 -background '#02070a' preview-all-slides.png`.
