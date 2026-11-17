// A Markdown link to a file, written the way Paseo reads a link to an absolute path: it takes the link's address as a
// URL path and decodes it, and ignores an address with a space in it. Each part of the path is encoded, brackets too,
// so that no name can end the link or change its meaning. Used by ui/FileOpener.tsx; adapted from upstream's
// client/fileLink.ts. Pure: unit-tested.

const part = (name: string) => encodeURIComponent(name).replace(/[()]/g, (bracket) => `%${bracket.charCodeAt(0).toString(16).toUpperCase()}`);

export const fileLink = (path: string) => `[open](${path.split("/").map(part).join("/")})`;
