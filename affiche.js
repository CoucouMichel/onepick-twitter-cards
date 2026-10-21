#!/usr/bin/env node
// tools/twitter-cards/affiche.js — « Affiche du soir » : UNE image pour un post qui présente jusqu'à 4 matchs.
//
// Pourquoi : le propriétaire veut tous les gros matchs du soir (21 oct. 2026 : Bayern – Arsenal, Lille – Galatasaray,
// Lens – Bruges), pas seulement un ou deux. Un post à 4 cartes de match serait recadré par X (le bas de chaque carte,
// les encadrés de points, serait coupé dans le fil) : on fait donc une carte dédiée, lisible sans clic.
// Par match : maillots, noms, cotes et points d'une victoire 1-0 de chaque camp (calcPoints, lib.js), heure de Paris.
//
// CONFIDENTIALITÉ : aucune donnée de picks de joueurs, jamais (le camp choisi n'est révélé qu'au coup d'envoi).
//
// Usage :
//   node tools/twitter-cards/affiche.js --in tools/twitter-cards/exemples/affiche-21-oct.json --out affiche.png
//   node tools/twitter-cards/affiche.js --games 7326,7320,7321 --out affiche.png   (lit daily_games : réseau)
// JSON (--in), MODE AUTONOME sans réseau : { "title": "…**mots en jaune**…" (facultatif), "matches": [ { "league", "kickoff"
//   (ISO), "matchDate" (facultatif), "home": { "raw", "name"?, "odd" }, "away": { … } } ] }, 1 à 4 matchs, triés par heure.
//   Maillots : lus dans jerseys/ (HD si présent, voir lib.js) ; sinon dans le bucket ; sinon initiales.
// Sortie : PNG 1080 x 1350 (4:5).

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const { calcPoints, parseArgs, str, die, clubDisplayName, sbGet, jerseyDataUri, parisLabels, escHtml, renderPng } = lib;
lib.ensureProxy(__filename);
const opt = parseArgs(process.argv.slice(2));

async function loadSpec() {
    if (opt.in && opt.in !== true) return JSON.parse(fs.readFileSync(path.resolve(opt.in), 'utf8'));
    if (opt.games && opt.games !== true) {
        const ids = String(opt.games).split(',').map((s) => s.trim()).filter(Boolean);
        const rows = await sbGet(`daily_games?id=in.(${ids.map(encodeURIComponent).join(',')})&select=*`);
        return {
            matches: rows.map((g) => ({
                league: g.league_name, kickoff: g.kickoff_time, matchDate: g.match_date,
                home: { raw: g.home_team_name, odd: Number(g.base_home_odd) }, away: { raw: g.away_team_name, odd: Number(g.base_away_odd) },
            })),
        };
    }
    die('Donne --in <fichier.json> ou --games <id,id,…> (voir l\'en-tête de affiche.js).');
}

(async () => {
    const spec = await loadSpec();
    const list = (spec.matches || []).slice().sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
    if (!list.length || list.length > 4) die(`L'affiche présente 1 à 4 matchs (reçu : ${list.length}).`);

    const fmtOdd = (o) => Number(o).toFixed(2);
    const build = async (t, matchDate) => {
        const raw = t.raw || t.name, odd = Number(t.odd);
        if (!(odd > 0)) die(`Cote invalide pour ${raw}.`);
        const jersey = lib.toDataUri(t.jersey) || await jerseyDataUri(raw);
        return { name: t.name || clubDisplayName(raw), oddLabel: fmtOdd(odd), points: calcPoints('win', odd, 1, 0, matchDate).total, jersey };
    };
    // Une seule compétition : chip dans l'en-tête ; sinon le nom est écrit sous l'heure de chaque match.
    const leagues = [...new Set(list.map((m) => m.league).filter(Boolean))];
    const matches = [];
    for (const m of list) {
        const matchDate = m.matchDate || new Date(m.kickoff).toISOString().slice(0, 10);
        const [home, away] = await Promise.all([build(m.home, matchDate), build(m.away, matchDate)]);
        matches.push({ time: parisLabels(m.kickoff).time, league: leagues.length > 1 ? m.league : '', home, away });
    }
    const first = parisLabels(list[0].kickoff);
    const titleText = spec.title || 'Ce soir, tu **pickes** qui ?';
    const data = {
        dayLabel: first.day, leagueChip: leagues.length === 1 ? leagues[0] : '',
        title: escHtml(titleText).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'),
        matches,
        cta: { main: 'Un seul pick par jour. Lequel ?', sub: 'Verrouille-le avant le coup d\'envoi' },
    };
    const out = path.resolve(str(opt.out) || 'affiche-onepick.png');
    await renderPng('affiche.html', data, out);
    console.log(`Affiche : ${out}`);
    for (const m of matches) console.log(`  ${m.time} ${m.home.name} ${m.home.oddLabel} (+${m.home.points}) · ${m.away.name} ${m.away.oddLabel} (+${m.away.points})`);
})();
