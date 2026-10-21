#!/usr/bin/env node
// tools/twitter-cards/generate.js — Génère la carte image des posts X de @OnePickFootball.
//
// Pourquoi : les 4 cartes quotidiennes étaient jumelles (même visuel, même structure) et plafonnaient
// à ~45 vues. La nouvelle carte (maquette Gemini du 21 oct. 2026, reprise ici) met en scène un CHOIX :
// « tu sécurises (notre scénario, +31 pts) ou tu tentes le braquage (la surprise, +44 pts) ? ».
// Plan complet : docs/plans/strategie-twitter.md.
//
// Deux variantes, qui portent la règle de confidentialité des picks (le camp choisi par chaque joueur
// n'est révélé qu'au COUP D'ENVOI du match) :
//   --variant avant   (défaut)  avant le match : seulement le NOMBRE de joueurs ayant pické (--picks N),
//                               jamais la répartition entre les deux équipes ;
//   --variant reveal            après le coup d'envoi : barre « tendance du jour » (--split H:A).
//                               REFUSÉE tant que le match n'a pas commencé (sauf --force, à éviter).
//
// Usage (depuis la racine du repo) :
//   node tools/twitter-cards/generate.js --game 7326 --picks 12 --out carte.png
//   node tools/twitter-cards/generate.js --in tools/twitter-cards/exemples/lyon-nice.json --out carte.png
//   node tools/twitter-cards/generate.js --game 7326 --variant reveal --split 5:1 --out reveal.png
// Options : --scenario 2-1 (notre scénario, sinon déduit des cotes), --surprise 0-1 (sinon l'autre camp
//   gagne 1-0), --headline "Texte", --kickoff <ISO> (si absent du JSON), --force.
// Mode --game <id> : lit daily_games et la forme des deux équipes (vue finished_matches_history) avec la
//   clé publiable, lecture seule. Le NOMBRE de picks n'est PAS lu automatiquement (la RLS pourrait en
//   cacher une partie et faire publier un faux chiffre) : donne-le avec --picks, lu par une requête SQL
//   de confiance (count(*) de user_predictions pour ce game_id).
// Entrée JSON (--in) : voir exemples/lyon-nice.json. MODE AUTONOME (aucun appel réseau) : avec --in, ajouter
//   home.jersey / away.jersey (data URI, texte d'un SVG, ou chemin d'un fichier image) ; la forme (`form`) et les
//   cotes sont déjà dans le JSON. Sans `jersey`, le maillot est lu dans le bucket (réseau).
//
// Sortie : PNG 1080 x 1350 (format 4:5, que X n'a pas à rogner). Maillots lus dans le bucket public
// team-logos (<slug>-hd.webp, sinon <slug>.webp, sinon .svg) ; une équipe sans maillot (une sélection :
// son drapeau n'est pas géré ici) affiche ses initiales. Couleurs des halos = couleur dominante des maillots.
//
// Formule de score : calcPoints (lib.js) est une copie d'AFFICHAGE de la règle de CLAUDE.md : voir son commentaire.
//
// Prérequis : Playwright + Chromium (préinstallés en session cloud, trouvés comme dans tools/mobile-guard).
// Le proxy HTTPS du conteneur est géré par la relance avec NODE_USE_ENV_PROXY=1.

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const { toDataUri, calcPoints, parseArgs, str, die, clubDisplayName, sbGet, jerseyDataUri, parisLabels, escHtml, renderPng } = lib;
lib.ensureProxy(__filename);

const opt = parseArgs(process.argv.slice(2));

const fmtOdd = (o) => Number(o).toFixed(2);
function parseScore(s, label) {
    const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(String(s || '').trim());
    if (!m) die(`${label} doit ressembler à « 2-1 » (reçu : ${s}).`);
    return { home: +m[1], away: +m[2] };
}

// --- Données ---
// Forme : 5 derniers matchs terminés AVANT ce match, vus de l'équipe (V / N / D), du plus ancien au plus récent.
async function fetchForm(team, beforeDate) {
    const t = encodeURIComponent(team);
    const rows = await sbGet(`finished_matches_history?select=home_team_name,away_team_name,home_score,away_score,match_date&or=(home_team_name.eq.${t},away_team_name.eq.${t})&match_date=lt.${beforeDate}&order=match_date.desc&limit=5`);
    return rows.reverse().map((r) => {
        const mine = r.home_team_name === team ? r.home_score : r.away_score;
        const opp = r.home_team_name === team ? r.away_score : r.home_score;
        return mine > opp ? 'V' : mine === opp ? 'N' : 'D';
    });
}

async function loadSpec() {
    if (opt.in && opt.in !== true) return JSON.parse(fs.readFileSync(path.resolve(opt.in), 'utf8'));
    if (opt.game && opt.game !== true) {
        const [g] = await sbGet(`daily_games?id=eq.${encodeURIComponent(opt.game)}&select=*`);
        if (!g) die(`Match ${opt.game} introuvable dans daily_games.`);
        if (g.base_home_odd == null || g.base_away_odd == null) die('Ce match n\'a pas de cotes : pas de carte.');
        const [fh, fa] = await Promise.all([fetchForm(g.home_team_name, g.match_date), fetchForm(g.away_team_name, g.match_date)]);
        return {
            league: g.league_name, kickoff: g.kickoff_time, matchDate: g.match_date,
            home: { raw: g.home_team_name, odd: Number(g.base_home_odd), form: fh },
            away: { raw: g.away_team_name, odd: Number(g.base_away_odd), form: fa },
        };
    }
    die('Donne --game <id> ou --in <fichier.json> (voir l\'en-tête de generate.js).');
}

(async () => {
    const spec = await loadSpec();
    const variant = opt.variant && opt.variant !== true ? opt.variant : (spec.variant || 'avant');
    if (!['avant', 'reveal'].includes(variant)) die('--variant vaut « avant » ou « reveal ».');
    const kickoff = (opt.kickoff && opt.kickoff !== true ? opt.kickoff : spec.kickoff);
    if (!kickoff) die('Heure de coup d\'envoi inconnue (champ « kickoff » ISO, ou --kickoff).');
    const matchDate = spec.matchDate || new Date(kickoff).toISOString().slice(0, 10);

    // Règle de confidentialité des picks : la répartition n'existe qu'après le coup d'envoi.
    if (variant === 'reveal' && new Date(kickoff) > new Date() && !opt.force) {
        die(`Le match (${kickoff}) n'a pas commencé : on ne révèle jamais la répartition des picks avant le coup d'envoi. Utilise la variante « avant » (--picks N).`);
    }
    let picksCount = opt.picks && opt.picks !== true ? Number(opt.picks) : (spec.picksCount != null ? Number(spec.picksCount) : null);
    let split = null;
    if (variant === 'reveal') {
        const s = opt.split && opt.split !== true ? String(opt.split) : (spec.picks ? `${spec.picks.home}:${spec.picks.away}` : '');
        const m = /^(\d+):(\d+)$/.exec(s);
        if (!m) die('La variante reveal demande --split H:A (picks sur l\'équipe à domicile : picks sur l\'équipe extérieure).');
        split = { home: +m[1], away: +m[2] };
        if (split.home + split.away === 0) die('Aucun pick à montrer.');
    }

    const home = { raw: spec.home.raw || spec.home.name, odd: Number(spec.home.odd), form: spec.home.form || [] };
    const away = { raw: spec.away.raw || spec.away.name, odd: Number(spec.away.odd), form: spec.away.form || [] };
    home.name = spec.home.name || clubDisplayName(home.raw);
    away.name = spec.away.name || clubDisplayName(away.raw);
    if (!(home.odd > 0) || !(away.odd > 0)) die('Cotes invalides.');

    // Notre scénario : donné, sinon le favori (cote la plus basse) gagne 2-1.
    const favHome = home.odd <= away.odd;
    const scn = opt.scenario && opt.scenario !== true ? parseScore(opt.scenario, '--scenario')
        : spec.scenario ? (typeof spec.scenario === 'string' ? parseScore(spec.scenario, 'scenario') : spec.scenario)
        : (favHome ? { home: 2, away: 1 } : { home: 1, away: 2 });
    const res = scn.home > scn.away ? 'home' : scn.home < scn.away ? 'away' : 'draw';

    // Deux encadrés : le pick du scénario, et « la surprise » (l'autre camp gagne, 1-0 par défaut).
    let safe, risk, scnLabel2, riskScore;
    const goals = (side, s) => (side === 'home' ? [s.home, s.away] : [s.away, s.home]);
    const sideInfo = { home, away };
    if (res === 'draw') {
        const mk = (side) => {
            const [mine, opp] = goals(side, scn);
            const p = calcPoints('draw', sideInfo[side].odd, mine, opp, matchDate);
            return { points: p.total, title: `Tu pickes ${sideInfo[side].name}`, math: `Nul (${fmtOdd(sideInfo[side].odd)} × 5 = ${Math.round(sideInfo[side].odd * 5)}) + ${mine} but${mine > 1 ? 's' : ''} (${mine * 5})${p.cs ? ' + clean sheet (5)' : ''}` };
        };
        safe = { tag: `Si c'est le nul (${scn.home}-${scn.away})`, ...mk('home') };
        risk = { tag: `Si c'est le nul (${scn.home}-${scn.away})`, ...mk('away') };
    } else {
        const win = res, other = res === 'home' ? 'away' : 'home';
        const [m1, o1] = goals(win, scn);
        const p1 = calcPoints('win', sideInfo[win].odd, m1, o1, matchDate);
        safe = { tag: 'Si notre scénario tombe', points: p1.total, title: `Tu pickes ${sideInfo[win].name} (${scn.home}-${scn.away})`,
            math: `Victoire (${Math.round(sideInfo[win].odd * 10)}) + ${m1} but${m1 > 1 ? 's' : ''} (${m1 * 5})${p1.cs ? ' + clean sheet (5)' : ''}` };
        const sur = opt.surprise && opt.surprise !== true ? parseScore(opt.surprise, '--surprise')
            : spec.surprise ? (typeof spec.surprise === 'string' ? parseScore(spec.surprise, 'surprise') : spec.surprise)
            : (other === 'home' ? { home: 1, away: 0 } : { home: 0, away: 1 });
        const [m2, o2] = goals(other, sur);
        if (!(m2 > o2)) die('La surprise doit être une victoire de l\'autre camp (ex. --surprise 0-1).');
        const p2 = calcPoints('win', sideInfo[other].odd, m2, o2, matchDate);
        const bold = sideInfo[other].odd > sideInfo[win].odd;
        risk = { tag: `En cas de surprise (${sur.home}-${sur.away})`, points: p2.total, title: bold ? `Tu tentes le braquage ${sideInfo[other].name}` : `Tu changes de camp : ${sideInfo[other].name}`,
            math: `Cote (${Math.round(sideInfo[other].odd * 10)}) + ${m2} but${m2 > 1 ? 's' : ''} (${m2 * 5})${p2.cs ? ' + clean sheet (5)' : ''}`, bold };
    }

    const when = parisLabels(kickoff);
        const headlineText = opt.headline && opt.headline !== true ? opt.headline : (spec.headline || (variant === 'reveal' ? 'Coup d\'envoi : voilà ce que nos joueurs ont pické' : 'Un seul pick par jour. Lequel ?'));
    // Les mots entre ** ** passent en jaune.
    const headlineHtml = escHtml(headlineText).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

    // Maillot fourni dans le JSON (mode autonome : home.jersey / away.jersey) ou lu dans le bucket public.
    const [jh, ja] = await Promise.all([toDataUri(spec.home.jersey) || jerseyDataUri(home.raw), toDataUri(spec.away.jersey) || jerseyDataUri(away.raw)]);
    const cardData = {
        variant, league: spec.league || '', whenLabel: `${when.day} · ${when.time}`, headline: headlineHtml,
        scenarioBadge: res === 'draw' ? 'Notre scénario' : 'Notre scénario', scenarioLabel: `${scn.home}–${scn.away}`,
        home: { name: home.name, oddLabel: fmtOdd(home.odd), form: home.form, jersey: jh },
        away: { name: away.name, oddLabel: fmtOdd(away.odd), form: away.form, jersey: ja },
        picksCount, safe, risk,
        cta: variant === 'reveal'
            ? { main: 'Les picks sont verrouillés.', sub: 'Demain, un nouveau match, un nouveau pick.' }
            : { main: risk.bold ? 'Alors, tu sécurises ou tu tentes le braquage ?' : 'Alors, tu prends qui ?', sub: 'Verrouille ton unique pick du jour avant le coup d\'envoi' },
    };
    if (variant === 'reveal') {
        const tot = split.home + split.away, lp = Math.round(split.home * 100 / tot);
        cardData.reveal = { leftPct: lp, rightPct: 100 - lp, leftLabel: `${lp}% ${home.name}`, rightLabel: `${100 - lp}% ${away.name}` };
    }

    const out = path.resolve(str(opt.out) || 'carte-onepick.png');
    await renderPng('card.html', cardData, out);
    console.log(`Carte ${variant} : ${out}`);
    console.log(`  ${home.name} ${fmtOdd(home.odd)} · ${away.name} ${fmtOdd(away.odd)} · scénario ${scn.home}-${scn.away} · +${safe.points} pts / +${risk.points} pts · ${when.day} ${when.time}`);
})();
