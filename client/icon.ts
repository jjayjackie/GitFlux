// GitFlux's glyph for the panel, its settings screen and the "Open" Command Center item: the three nodes of the app
// icon (assets/icon.png), a trunk and a branch curving to the right. Lucide's GitBranch, used before, has no node at the
// top of its line and read as cut off beside the GitFlux name. Drawn on Lucide's 24-unit grid with its 2-unit round
// stroke so it sits among Lucide icons; painted with `currentColor`, so Paseo gives it each surface's icon colour.
//
// Usage: icon: GITFLUX_ICON in a contribution (index.client.tsx, client/commands.ts).

import type { PluginSvgIcon } from "@getpaseo/plugin/client";

export const GITFLUX_ICON: PluginSvgIcon = {
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="10" r="2.5"/>' +
    '<path d="M6 7.5v9"/><path d="M7.8 17.2C9.2 12.6 11.2 10 15.5 10"/>' +
    "</svg>",
};
