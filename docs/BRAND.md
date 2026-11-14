# Tableverse brand: "Your Seat"

The mark is an oval felt table seen from above with three mint seats (top, left, right) and one gold seat at the bottom. The gold seat is you. Gold means "you / your turn / action" everywhere in the UI, and a composition uses one gold element.

Assets live in `public/brand/` (`svg/` sources, `png/` exports, `favicon.ico`). The brand identity is integrated into the application: browser and install icons, social preview metadata, the top-bar mark and the loading-screen mark are wired up.

## Colours
| Name | Value | Use |
|---|---|---|
| Deep felt | `#071510` | page ground |
| Felt | `#153228` | surfaces |
| Turn gold | `#fbbf24` | you, your turn, primary action |
| Seat mint | `#86efac` | other seats, accents |
| Table ivory | `#f0fdf4` | text on dark |
| Paper | `#f3f1e8` | light surfaces (print, social) |
| Paper ink | `#0d2a20` | text on paper |

On paper use `mark-on-light.svg` and `lockup-on-light.svg`: seats and gold are darkened there for contrast.

## Type
Wordmark: Poppins Bold, supplied as outlines (no font load). UI text stays Inter.

## Files
- `mark`, `mark-on-light`, `mark-mono` (uses `currentColor`), `badge` (round, for notifications)
- `lockup-on-dark`, `lockup-on-light` (mark plus name; use the mark alone where width is tight, such as a 360 px top bar)
- `app-icon` (rounded), `app-icon-square` (iOS, full bleed), `app-icon-maskable` (Android), `favicon` (simplified for 16 to 48 px)
- `players-2` to `players-6`: seats follow the game, the gold seat stays at the bottom
- `tint-*`: per-game table tint; seats and gold never change
- `social-profile` (1080), `social-banner` (1500x500), `share-card` (1200x630)

## Rules
- Keep clear space of one seat diameter around the mark.
- Do not recolour the gold seat, add outlines, or rotate the mark.
- Ovals and circles only for brand shapes.

## Status
Application integration is implemented: browser favicon and icons, web-app manifest and install artwork, social sharing image and metadata, top-bar mark, loading-screen mark, and service-worker cache handling.

Post-release verification remains: check the deployed site and preview metadata, and confirm the browser/install icons and branding on representative real devices. These checks are separate from the completed application wiring.
