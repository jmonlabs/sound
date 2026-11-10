// La liste des instruments SFZ d'un dossier, pour les explorer dans un carnet (le navigateur ne peut pas lister un dossier).
//
//   node tools/sfz-index.js /Volumes/instruments/jmon/sfz
//
// Écrit `index.json` dans ce dossier : [{ library, path, name }], `path` relatif au dossier, `library` le premier dossier du chemin.
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, basename } from "node:path";

const root = process.argv[2];
if (!root) { console.error("usage : node tools/sfz-index.js <dossier>"); process.exit(1); }
const found = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "__MACOSX") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.toLowerCase().endsWith(".sfz")) found.push(full);
  }
};
walk(root);
const index = found.sort().map((full) => {
  const path = relative(root, full);
  const parts = path.split("/");
  return { library: parts[0] === "pianobook" ? `pianobook/${parts[1]}` : parts[0], path, name: basename(full, ".sfz") };
});
writeFileSync(join(root, "index.json"), JSON.stringify(index, null, 1));
console.log(`${index.length} instruments, ${new Set(index.map((i) => i.library)).size} bibliothèques → ${join(root, "index.json")}`);
