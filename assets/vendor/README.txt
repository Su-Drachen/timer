Local dependencies for the main page's offline mode

Chart.js 4.5.1
Source: https://www.npmjs.com/package/chart.js/v/4.5.1
License: MIT (see chart-LICENSE.md and the script header).

Font Awesome 4.7.0
Source: https://www.npmjs.com/package/font-awesome/v/4.7.0
Copyright Dave Gandy. Font: SIL OFL 1.1; CSS: MIT.
License information: https://fontawesome.com/v4/license/
The CSS font-face declaration is adapted to use only the included WOFF2 font.

To reproduce: node scripts/vendor-offline.mjs
To rebuild the main page utilities and offline manifest: pnpm install --frozen-lockfile && pnpm run build
Tailwind CSS 3.4.17 (MIT) is pinned in package.json and pnpm-lock.yaml.
Runtime resources are committed; installing dependencies is only needed for development.
