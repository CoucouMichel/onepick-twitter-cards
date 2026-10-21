#!/usr/bin/env node
// tools/twitter-cards/sync-jerseys.js — Copie les maillots du bucket public team-logos dans le dossier `jerseys/`.
//
// Pourquoi : l'action planifiée qui prépare les posts X n'atteint pas supabase.co depuis son shell, donc ne peut pas lire
// les maillots HD du bucket. On les lui donne dans le dépôt PUBLIC onepick-twitter-cards (dossier `jerseys/`, ~5 Mo pour
// ~410 clubs) ; recap.js / generate.js les lisent en local (voir lib.js, jerseyDataUri).
//
// Contenu copié (par club, un seul fichier le plus qualitatif suffit) : `<slug>-hd.webp` (1024 px) ET `<slug>.webp` (512 px,
// plus léger pour les petites vignettes) s'ils existent ; `<slug>.svg` seulement pour les clubs sans aucun webp (anciens
// maillots non republiés). Racine du bucket seulement : les sous-dossiers « à supprimer plus tard » et « PNG » sont ignorés.
//
// Usage :   node tools/twitter-cards/sync-jerseys.js [--dir chemin/vers/jerseys] [--force]
//   --dir    dossier de destination (défaut : ./jerseys à côté du script) ;
//   --force  retélécharge même les fichiers déjà présents de même taille (un maillot REPUBLIÉ garde souvent la même taille :
//            à utiliser après avoir republié des maillots).
// Lecture seule sur Supabase (clé publiable). À relancer quand de nouveaux maillots sont publiés, puis recopier
// `jerseys/` dans le dépôt public (voir CLAUDE.md, « Copie publique »).

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
lib.ensureProxy(__filename);
const opt = lib.parseArgs(process.argv.slice(2));

const BASE = `${lib.SUPABASE_URL}/storage/v1`;
const KEY = lib.SUPABASE_KEY;
const dir = path.resolve(lib.str(opt.dir) || lib.JERSEY_DIR);

(async () => {
    // Liste de la racine du bucket (le listing public est autorisé avec la clé publiable ; l'appli fait de même).
    const files = [];
    for (let offset = 0; ; offset += 1000) {
        const r = await fetch(`${BASE}/object/list/team-logos`, {
            method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix: '', limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
        });
        if (!r.ok) lib.die(`Listing du bucket refusé (HTTP ${r.status}).`);
        const page = await r.json();
        files.push(...page.filter((o) => o.id && /\.(webp|svg)$/.test(o.name)));
        if (page.length < 1000) break;
    }
    const slugOf = (n) => n.replace(/(-hd)?\.(webp|svg)$/, '');
    const hasWebp = new Set(files.filter((o) => o.name.endsWith('.webp')).map((o) => slugOf(o.name)));
    const wanted = files.filter((o) => o.name.endsWith('.webp') || !hasWebp.has(slugOf(o.name)));

    fs.mkdirSync(dir, { recursive: true });
    let got = 0, kept = 0, bytes = 0;
    for (const o of wanted) {
        const dest = path.join(dir, o.name);
        const size = Number(o.metadata && o.metadata.size);
        if (!opt.force && fs.existsSync(dest) && fs.statSync(dest).size === size) { kept++; bytes += size; continue; }
        const r = await fetch(`${lib.SUPABASE_URL}/storage/v1/object/public/team-logos/${encodeURIComponent(o.name)}`);
        if (!r.ok) { console.warn(`Avertissement : ${o.name} illisible (HTTP ${r.status}), ignoré.`); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        fs.writeFileSync(dest, buf);
        got++; bytes += buf.length;
    }
    // Fichiers locaux qui n'existent plus dans le bucket : signalés, pas supprimés.
    const names = new Set(wanted.map((o) => o.name));
    const orphans = fs.readdirSync(dir).filter((f) => /\.(webp|svg)$/.test(f) && !names.has(f));
    console.log(`Maillots : ${got} téléchargés, ${kept} déjà à jour, ${wanted.length} au total (${(bytes / 1048576).toFixed(1)} Mo) -> ${dir}`);
    if (orphans.length) console.log(`À vérifier : ${orphans.length} fichier(s) local(aux) absent(s) du bucket (non supprimés) : ${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? '…' : ''}`);
})();
