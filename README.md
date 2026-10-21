# onepick-twitter-cards

Générateurs de cartes image pour les posts X de [@OnePickFootball](https://x.com/OnePickFootball) :

- **`generate.js`** : carte de match « tu sécurises ou tu tentes le braquage ? » (1080 x 1350, format 4:5).
- **`recap.js`** : carte récap du jour (ou de la semaine avec `--days 7`) : un héros, trois lignes, un appel à l'action.

> **Ceci est une COPIE.** La source de vérité est le dossier `tools/twitter-cards/` du projet privé OnePick
> (`footpick`). Ce dépôt est public seulement pour qu'une action planifiée, qui n'a aucun accès au dépôt privé,
> puisse le cloner sans identifiants. Ne modifier le code que dans le projet OnePick, puis recopier ici.
> Aucun secret ici : la seule clé présente (`lib.js`) est la clé **publiable** de Supabase, déjà publique dans l'appli.

## Prérequis

Node.js 18+ et Playwright avec Chromium (`npm i playwright && npx playwright install chromium`, ou la variable
`PLAYWRIGHT_MODULE=/chemin/vers/playwright`). Aucune autre dépendance, aucune police ni image distante.

## Mode autonome (sans aucun appel réseau)

C'est le mode de l'action planifiée : les données sont lues ailleurs (connecteur Supabase) et données en fichiers JSON.

```
node recap.js --date 2026-10-20 --data donnees.json --out recap.png
node generate.js --in carte.json --out carte.png
```

- `recap.js --data` attend `{ "preds": [...], "games": [...], "jerseys": {...} }` : le format est décrit dans le
  commentaire du fichier. `jerseys` : `{ "<slug>": "<texte SVG | data URI | chemin d'une image>" }`, slug =
  nom du club en minuscules sans accents ni espaces.
- `generate.js --in` attend un JSON comme `exemples/lyon-nice.json`, avec `home.jersey` / `away.jersey` (même
  forme que ci-dessus). Sans maillot fourni : les initiales du club.

## Mode connecté (lecture directe de Supabase, nécessite le réseau)

```
node generate.js --game <id> --picks N --out carte.png
node recap.js --date 2026-10-20 --out recap.png
```

## Règle de confidentialité des picks

Dans le jeu, le camp choisi par chaque joueur n'est révélé qu'au coup d'envoi. `generate.js` n'écrit donc, avant le
match, que « les picks sont révélés au coup d'envoi » (ou le nombre de joueurs avec `--picks`) ; sa variante
`--variant reveal` (répartition des picks) est **refusée** tant que le match n'a pas commencé.
