#!/usr/bin/env node
// tools/twitter-cards/recap.js — Carte « récap » des posts X de @OnePickFootball (refonte du 21 oct. 2026).
//
// Pourquoi : l'ancien récap était une liste de cinq lignes à plat. Celui-ci raconte UNE histoire : le meilleur
// pick en héros (énorme chiffre doré, maillot géant, pseudos), puis un podium de quatre picks, des chiffres du
// jour et un appel à l'action. Plan : docs/plans/strategie-twitter.md ; aperçu des règles : CLAUDE.md,
// « Cartes image des posts X ».
//
// Usage (depuis la racine du repo) :
//   node tools/twitter-cards/recap.js --out recap.png                  # hier (heure de Paris)
//   node tools/twitter-cards/recap.js --date 2026-10-20 --out recap.png
//   node tools/twitter-cards/recap.js --date 2026-10-18 --days 7       # la semaine qui finit le 18 (récap du lundi)
// Données : picks RÉGLÉS (points_earned non nul) de user_predictions et matchs de daily_games, lus en lecture
// seule avec la clé publiable. Classe les camps GAGNANTS de tous les matchs terminés : points réels s'il y a eu des
// picks, sinon points qu'un pick aurait rapportés (cote du jour) avec « Personne ne l'avait pické ». Ne cite donc que des matchs TERMINÉS : la confidentialité des picks avant le
// coup d'envoi ne se pose pas ici. Un « groupe » = les joueurs qui ont pické le même camp du même match.
// MODE AUTONOME : --data fichier.json fournit picks, matchs et maillots (voir le commentaire dans le code) : AUCUN appel
// réseau, pour une action planifiée dont le shell n'atteint pas supabase.co mais qui lit Supabase par son connecteur.
// Sortie : un PNG 1080 x 1350 + sur la sortie standard les FAITS (héros, podium, braquage, chiffres) pour
// écrire le texte du post sans rouvrir la base.

const path = require('path');
const lib = require('./lib');
const { loadJson, toDataUri, normalizeTeamName, calcPoints, parseArgs, str, die, clubDisplayName, sbGet, jerseyDataUri, parisLabels, renderPng } = lib;
lib.ensureProxy(__filename);
const opt = parseArgs(process.argv.slice(2));

const BRAQUAGE_ODD = 4; // à partir de cette cote, un pick gagnant est un « braquage »

const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const fmt = (n) => Number(n).toFixed(2);

(async () => {
    const days = Math.max(1, Number(str(opt.days) || 1));
    const to = str(opt.date) || addDays(parisToday(), -1);
    const from = addDays(to, -(days - 1));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) die('--date doit ressembler à 2026-10-20.');

    // MODE AUTONOME (--data fichier.json, aucun appel réseau) : { preds, games, jerseys } lus par SQL via le connecteur.
    //   preds   : [{ username, points_earned, locked_odd, picked_team ('home'|'away'), game_id }] picks RÉGLÉS de la période ;
    //   games   : [{ id, match_date, home_team_name, away_team_name, home_score, away_score, league_name,
    //                base_home_odd, base_away_odd }] matchs TERMINÉS (FT / AET / PEN) de la période ;
    //   jerseys : { "<normalizeTeamName(nom)>": data URI | texte SVG | chemin de fichier } (facultatif : initiales sinon).
    const offline = str(opt.data) ? loadJson(str(opt.data)) : null;
    const preds = offline ? (offline.preds || []) : await sbGet(`user_predictions?match_date=gte.${from}&match_date=lte.${to}&points_earned=not.is.null&select=username,points_earned,locked_odd,picked_team,game_id&limit=3000`);
    if (!preds.length) die(`Aucun pick réglé du ${from} au ${to}.`);
    const ids = [...new Set(preds.map((p) => p.game_id))];
    // TOUS les matchs terminés de la période (pas seulement ceux qui ont des picks) : le récap classe aussi les
    // équipes gagnantes que personne n'avait pickées (« Personne ne l'avait pické. Tu aurais dû ? »), comme l'ancien
    // « Top 5 des points d'hier ».
    const finished = offline ? (offline.games || []) : await sbGet(`daily_games?match_date=gte.${from}&match_date=lte.${to}&match_status=in.(FT,AET,PEN)&select=id,match_date,home_team_name,away_team_name,home_score,away_score,league_name,base_home_odd,base_away_odd&limit=1000`);
    const games = Object.fromEntries(finished.map((g) => [g.id, g]));

    // Chiffres globaux.
    const stats = {
        picks: preds.length,
        players: new Set(preds.map((p) => p.username)).size,
        winners: preds.filter((p) => p.points_earned > 0).length,
        totalPts: preds.reduce((s, p) => s + p.points_earned, 0),
        matches: ids.length,
    };
    stats.winPct = Math.round(stats.winners * 100 / stats.picks);

    // Groupes : un camp d'un match. Points du groupe = le meilleur pick du groupe (les cotes verrouillées
    // peuvent différer d'un point entre joueurs) ; joueurs = ceux qui ont marqué.
    const groups = new Map();
    for (const p of preds) {
        const g = games[p.game_id];
        if (!g || p.points_earned <= 0) continue;
        const key = `${p.game_id}|${p.picked_team}`;
        const grp = groups.get(key) || { game: g, side: p.picked_team, points: 0, odd: 0, players: [] };
        if (p.points_earned > grp.points) { grp.points = p.points_earned; grp.odd = Number(p.locked_odd); }
        grp.players.push({ name: p.username, points: p.points_earned });
        groups.set(key, grp);
    }
    // Camps gagnants SANS aucun pick : points qu'un pick aurait rapportés avec la cote du jour (si elle existe).
    for (const g of finished) {
        if (g.home_score == null || g.away_score == null || g.home_score === g.away_score) continue;
        const side = g.home_score > g.away_score ? 'home' : 'away';
        const odd = Number(side === 'home' ? g.base_home_odd : g.base_away_odd);
        if (groups.has(`${g.id}|${side}`) || !(odd > 0)) continue;
        const mine = side === 'home' ? g.home_score : g.away_score, opp = side === 'home' ? g.away_score : g.home_score;
        groups.set(`${g.id}|${side}`, { game: g, side, points: calcPoints('win', odd, mine, opp, g.match_date).total, odd, players: [], nobody: true });
    }
    const sorted = [...groups.values()].sort((a, b) => b.points - a.points || b.players.length - a.players.length);
    if (!sorted.length) die('Aucun pick gagnant à montrer.');
    const hero = sorted[0];
    let podium = sorted.slice(1, 4); // trois lignes seulement : au-delà, la carte devient illisible

    // Le « braquage » : le pick gagnant à la plus grosse cote. Une victoire (le camp pické a marqué plus), pas un nul.
    const isWin = (g) => (g.side === 'home' ? g.game.home_score > g.game.away_score : g.game.away_score > g.game.home_score);
    const braq = sorted.filter((g) => isWin(g) && g.odd >= BRAQUAGE_ODD).sort((a, b) => b.odd - a.odd)[0] || null;
    if (braq && braq !== hero && !podium.includes(braq) && podium.length) podium[podium.length - 1] = braq; // il prend la dernière place du podium
    podium = podium.sort((a, b) => b.points - a.points || b.players.length - a.players.length);

    const names = (g) => g.players.sort((a, b) => b.points - a.points).map((p) => p.name);
    const view = (g, extra = {}) => ({
        home: clubDisplayName(g.game.home_team_name), away: clubDisplayName(g.game.away_team_name), hs: g.game.home_score, as: g.game.away_score,
        side: g.side, league: g.game.league_name, odd: fmt(g.odd), points: g.points, players: names(g), nobody: !!g.nobody, ...extra,
        raw: g.side === 'home' ? g.game.home_team_name : g.game.away_team_name,
        oppRaw: g.side === 'home' ? g.game.away_team_name : g.game.home_team_name,
        // Score vu du camp pické (« 4–2 » = le camp pické en a mis 4) : le tableau d'affichage de la carte
        // met le maillot du pick à gauche, celui de l'adversaire à droite.
        sm: g.side === 'home' ? g.game.home_score : g.game.away_score,
        so: g.side === 'home' ? g.game.away_score : g.game.home_score,
    });
    const heroV = view(hero);
    const rowsV = podium.map((g, i) => view(g, { rank: i + 2, tag: g === braq ? 'braquage' : '' }));
    // Maillots : fournis (mode autonome) ou lus dans le bucket public team-logos (réseau).
    const jersey = (raw, hd) => (offline ? Promise.resolve(toDataUri((offline.jerseys || {})[normalizeTeamName(raw)])) : jerseyDataUri(raw, { hd }));
    const [heroJersey, ...rest] = await Promise.all([jersey(heroV.raw, true), ...rowsV.flatMap((r) => [jersey(r.raw, false), jersey(r.oppRaw, false)])]);
    heroV.jersey = heroJersey;
    rowsV.forEach((r, i) => { r.jersey = rest[i * 2]; r.oppJersey = rest[i * 2 + 1]; });

    // Libellés : « RÉCAP · MAR 20 OCT » ou « RÉCAP · 13–19 OCT ».
    const dl = (iso) => parisLabels(iso + 'T12:00:00Z').day; // « MAR 20 OCT »
    const [, dFrom, mFrom] = dl(from).split(' '), [, dTo, mTo] = dl(to).split(' ');
    const chip = days === 1 ? `${dl(to)}` : `${mFrom === mTo ? `${dFrom}–${dTo} ${mTo}` : `${dFrom} ${mFrom} – ${dTo} ${mTo}`}`;
    const isYesterday = to === addDays(parisToday(), -1);
    const heroLabel = days > 1 ? 'Meilleur pick de la semaine' : isYesterday ? 'Meilleur pick d\'hier' : `Meilleur pick du ${dl(to).replace(/^\S+ /, '')}`;
    const data = {
        chip, heroLabel, hero: heroV, rows: rowsV,
        stats: { winPct: stats.winPct, period: days > 1 ? 'cette semaine' : (isYesterday ? 'hier' : '') }, // pas d'effectif : montrer qu'on est une trentaine n'attire personne
        cta: { main: 'Et toi, ton pick du jour ?', sub: 'Un seul par jour · 100% gratuit' },
    };

    const out = path.resolve(str(opt.out) || 'recap-onepick.png');
    await renderPng('recap.html', data, out);
    console.log(`Récap ${from === to ? to : `${from} → ${to}`} : ${out}`);
    console.log('--- FAITS pour le texte du post ---');
    const line = (v) => `${v.home} ${v.hs}-${v.as} ${v.away} · pick ${v.raw} · cote ${v.odd} · +${v.points} pts · ${v.players.length ? v.players.join(', ') : "PERSONNE ne l'avait pické"}`;
    console.log(`Héros : ${line(heroV)}  (${heroV.players.length} joueur${heroV.players.length > 1 ? 's' : ''})`);
    rowsV.forEach((r) => console.log(`#${r.rank}    : ${line(r)}${r.tag ? '  [BRAQUAGE]' : ''}`));
    console.log(`Chiffres (la carte n'affiche pas le nombre de joueurs ; les pseudos, eux, sont cités) : ${stats.players} joueurs, ${stats.picks} picks réglés sur ${stats.matches} matchs, ${stats.winners} gagnants (${stats.winPct}%), ${stats.totalPts} pts distribués`);
    if (!braq) console.log(`Pas de braquage (aucun pick gagnant à cote >= ${BRAQUAGE_ODD}).`);
})();
