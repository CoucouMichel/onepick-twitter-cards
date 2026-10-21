// tools/twitter-cards/lib.js — Briques communes aux générateurs de cartes X (generate.js : carte de
// match ; recap.js : carte récap). Voir CLAUDE.md, « Cartes image des posts X ».

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUPABASE_URL = 'https://ofyrmdbpnvbbnvmodckf.supabase.co';
// Clé PUBLIABLE (déjà en clair dans src/js/supabase-client.js), lecture seule sous RLS.
const SUPABASE_KEY = 'sb_publishable_x7NFCKKEiwqkvVOTse2csQ_8eoTex6j';
const JERSEY_BASE = `${SUPABASE_URL}/storage/v1/object/public/team-logos`;

// --- Règle de score (copie d'AFFICHAGE) ----------------------------------------------------------
// Copie de la règle de CLAUDE.md (« Règle de score », bonus clean sheet actif depuis le 2026-09-07), hors
// des 7 endroits qui comptent : à mettre à jour si la règle ou la date du bonus change.
// res : 'win' | 'draw' | 'loss' du camp pické ; odd = cote de ce camp.
const CLEAN_SHEET_FROM = '2026-09-07';
function calcPoints(res, odd, myGoals, oppGoals, matchDate) {
    const base = res === 'win' ? Math.round(odd * 10 + myGoals * 5) : res === 'draw' ? Math.round(odd * 5 + myGoals * 5) : Math.round(myGoals * 5);
    const cs = res !== 'loss' && oppGoals === 0 && String(matchDate) >= CLEAN_SHEET_FROM ? 5 : 0;
    return { total: base + cs, cs, base };
}

// fetch de Node ignore le proxy du conteneur sans cette variable : on se relance une fois avec.
function ensureProxy(entryFile) {
    if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
        const r = spawnSync(process.execPath, [entryFile, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' } });
        process.exit(r.status === null ? 1 : r.status);
    }
}

function parseArgs(argv) {
    const opt = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const k = argv[i].slice(2), next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) opt[k] = true; else { opt[k] = next; i++; }
    }
    return opt;
}
const str = (v) => (v && v !== true ? String(v) : null); // valeur textuelle d'une option, ou null
function die(msg) { console.error('Erreur : ' + msg); process.exit(1); }

// --- Noms et slugs (copies d'index.html : à garder identiques) ---------------------------------------
// normalizeTeamName : même fonction que dans index.html / send-live-push (slug du fichier maillot).
const normalizeTeamName = (name) => (name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
// clubDisplayName : affichage seulement (jamais une clé), copie d'index.html.
const TEAM_SHORT = { 'real racing club de santander': 'Racing Santander', '1899 hoffenheim': 'Hoffenheim', 'fc basel 1893': 'Basel', 'us catanzaro 1929': 'Catanzaro', 'inter milan': 'Inter', 'estac troyes': 'Troyes', 'fc koln': 'Köln', 'fc nurnberg': 'Nürnberg', 'fc viktoria koln': 'Viktoria Köln', 'wolves': 'Wolverhampton', 'afc wimbledon': 'Wimbledon', 'saburtalo': 'FC Iberia 1999' };
const LEADING = ['1.', 'FC', 'AC', 'AS', 'AD', 'AF', 'SC', 'SD', 'CD', 'SCR', 'SV', 'SSV', 'VSG', 'VfB', 'VfL', 'TSV', 'FSV', 'SpVgg', 'FK', 'NK', 'HNK', 'SK', 'ŠK', 'PFC', 'FS', 'BFC', 'BB', 'KV', 'KVC', 'KAA', 'RSC', 'OH', 'US', 'FF', 'IF', 'IFK', 'BK'];
const TRAILING = ['FC', 'SC', 'CF', 'AC', 'AFC', 'KV', 'FK', 'CT', 'HSC', 'FA', 'GF', 'FF', 'IF', 'BK'];
const KEEP = new Set(['as roma', 'as roma women', 'cf montreal', 'fc andorra', 'paris fc', 'pau fc', 'fc dallas', 'karlsruher sc', 'hallescher fc']);
function clubDisplayName(raw) {
    const key = (raw || '').toLowerCase().trim();
    if (TEAM_SHORT[key]) return TEAM_SHORT[key];
    if (KEEP.has(key)) return raw;
    const w = (raw || '').trim().split(/\s+/);
    while (w.length > 1 && LEADING.includes(w[0])) w.shift();
    while (w.length > 1 && TRAILING.includes(w[w.length - 1])) w.pop();
    if (w.length > 2 && /^\d+$/.test(w[w.length - 1]) && TRAILING.includes(w[w.length - 2])) w.splice(w.length - 2, 1);
    return w.join(' ');
}

// --- Supabase (lecture seule) ----------------------------------------------------------------------
async function sbGet(pathAndQuery) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!r.ok) die(`Supabase ${r.status} sur ${pathAndQuery.split('?')[0]}`);
    return r.json();
}

// Maillot du bucket public team-logos en data URI : <slug>-hd.webp (si hd), <slug>.webp, <slug>.svg.
// Une sélection nationale n'y est pas : null (le gabarit affiche alors les initiales).
async function jerseyDataUri(raw, { hd = true } = {}) {
    const slug = normalizeTeamName(raw);
    const files = [...(hd ? [`${slug}-hd.webp`] : []), `${slug}.webp`, `${slug}.svg`];
    for (const f of files) {
        try {
            const r = await fetch(`${JERSEY_BASE}/${f}`);
            if (!r.ok) continue;
            return `data:${f.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
        } catch (e) { /* fichier suivant */ }
    }
    console.warn(`Avertissement : pas de maillot pour « ${raw} » (slug ${slug}) dans le bucket team-logos : initiales à la place.`);
    return null;
}


// --- Mode autonome (sans réseau) ---------------------------------------------------------------------
// Pourquoi : une action planifiée de type « Chat » n'atteint pas supabase.co depuis son shell (réseau
// restreint) mais lit Supabase par son connecteur. Elle écrit alors les données dans un fichier JSON
// (--data / --in) et les générateurs n'ont plus aucun appel réseau à faire.
function loadJson(file) {
    try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (e) { die(`Fichier JSON illisible : ${file} (${e.message})`); }
}
// Maillot fourni à la main -> data URI. Accepte : une data URI telle quelle, le TEXTE d'un SVG (« <svg… », ce
// que renvoie une lecture du bucket par SQL), ou le chemin d'un fichier image (.webp / .png / .svg / .jpg).
function toDataUri(v) {
    if (!v || typeof v !== 'string') return null;
    const t = v.trim();
    if (t.startsWith('data:')) return t;
    if (t.startsWith('<')) return `data:image/svg+xml;base64,${Buffer.from(t, 'utf8').toString('base64')}`;
    try {
        const ext = path.extname(t).toLowerCase();
        const mime = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[ext];
        if (mime) return `data:${mime};base64,${fs.readFileSync(path.resolve(t)).toString('base64')}`;
    } catch (e) { /* pas un fichier lisible */ }
    console.warn('Avertissement : maillot fourni illisible (ni data URI, ni SVG, ni fichier image).');
    return null;
}

// Date / heure de Paris : { day: 'DIM 18 OCT', time: '20H45' }.
function parisLabels(iso) {
    const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date(iso)).reduce((a, x) => (a[x.type] = x.value, a), {});
    const clean = (s) => s.replace('.', '').toUpperCase();
    return { day: `${clean(p.weekday)} ${p.day} ${clean(p.month)}`, time: `${p.hour}H${p.minute}` };
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- Rendu PNG -----------------------------------------------------------------------------------
// Playwright : variable explicite, installation du projet, ou celle préinstallée en session cloud.
function loadPlaywright() {
    for (const c of [process.env.PLAYWRIGHT_MODULE, 'playwright', '/opt/node-tools/node_modules/playwright']) {
        if (!c) continue;
        try { return require(c); } catch (e) { /* suivant */ }
    }
    die('Playwright introuvable (npm i -D playwright && npx playwright install chromium, ou PLAYWRIGHT_MODULE=...).');
}
// Ouvre `template` (fichier de ce dossier) avec `data` dans window.__CARD__, attend body[data-ready="1"],
// photographie #card à l'échelle 2.
async function renderPng(template, data, out, { width = 540, height = 675 } = {}) {
    const browser = await loadPlaywright().chromium.launch();
    try {
        const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })).newPage();
        await page.addInitScript((d) => { window.__CARD__ = d; }, data);
        await page.goto('file://' + path.join(__dirname, template));
        await page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        await page.locator('#card').screenshot({ path: out });
    } finally {
        await browser.close();
    }
}

module.exports = { loadJson, toDataUri, calcPoints, ensureProxy, parseArgs, str, die, normalizeTeamName, clubDisplayName, sbGet, jerseyDataUri, parisLabels, escHtml, renderPng, SUPABASE_URL };
