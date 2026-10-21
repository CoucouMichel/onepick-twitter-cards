# onepick-twitter-cards

Générateurs de cartes image pour les posts X de [@OnePickFootball](https://x.com/OnePickFootball) :

- **`generate.js`** : carte de match « tu sécurises ou tu tentes le braquage ? » (1080 x 1350, format 4:5).
- **`recap.js`** : carte récap du jour (ou de la semaine avec `--days 7`) : un héros, trois lignes, un appel à l'action.
- **`affiche.js`** : « affiche du soir », UNE image qui présente 1 à 4 matchs (maillots, cotes, points d'une victoire 1-0), pour un post unique.
  `node affiche.js --in affiche.json --out affiche.png` ; JSON comme `exemples/affiche-21-oct.json` (aucun maillot à fournir : lus dans `jerseys/`).

> **Ceci est une COPIE.** La source de vérité est le dossier `tools/twitter-cards/` du projet privé OnePick
> (`footpick`). Ce dépôt est public seulement pour qu'une action planifiée, qui n'a aucun accès au dépôt privé,
> puisse le cloner sans identifiants. Ne modifier le code que dans le projet OnePick, puis recopier ici.
> Aucun secret ici : la seule clé présente (`lib.js`) est la clé **publiable** de Supabase, déjà publique dans l'appli.

## Prérequis

Node.js 18+ et Playwright avec Chromium (`npm i playwright && npx playwright install chromium`, ou la variable
`PLAYWRIGHT_MODULE=/chemin/vers/playwright`). Aucune autre dépendance, aucune police ni image distante.

## Maillots : dossier `jerseys/` (HD)

`jerseys/` est une copie du bucket public `team-logos` (~580 fichiers, 6 Mo) : `<slug>-hd.webp` (1024 px, utilisé en grand
pour la carte de match et le héros du récap), `<slug>.webp` (512 px, petites vignettes) et `<slug>.svg` pour les anciens clubs
non republiés. Les scripts le lisent EN LOCAL (aucun réseau) ; un club absent retombe sur le bucket si le réseau est
disponible, sinon sur ses initiales. Slug = nom du club en minuscules sans accents ni espaces (« Bodø/Glimt » -> `bodglimt`).

Mise à jour (nouveaux maillots publiés, à lancer avec le réseau) : `node sync-jerseys.js` puis commit du dossier `jerseys/`.
`--force` retélécharge aussi les fichiers de même taille (maillot republié).

## Mode autonome (sans aucun appel réseau)

C'est le mode de l'action planifiée : les données sont lues ailleurs (connecteur Supabase) et données en fichiers JSON.

```
node recap.js --date 2026-10-20 --data donnees.json --out recap.png
node generate.js --in carte.json --out carte.png
```

- `recap.js --data` attend `{ "preds": [...], "games": [...], "jerseys": {...} }` : le format est décrit dans le
  commentaire du fichier. `jerseys` est FACULTATIF : `{ "<slug>": "<texte SVG | data URI | chemin d'une image>" }` ; sans lui, le
  dossier `jerseys/` est utilisé.
- `generate.js --in` attend un JSON comme `exemples/lyon-nice.json`, avec `home.jersey` / `away.jersey` (même
  forme que ci-dessus). Sans maillot fourni : le dossier `jerseys/`, puis les initiales du club.

## Mode connecté (lecture directe de Supabase, nécessite le réseau)

```
node generate.js --game <id> --picks N --out carte.png
node recap.js --date 2026-10-20 --out recap.png
```

## Règle de confidentialité des picks

Dans le jeu, le camp choisi par chaque joueur n'est révélé qu'au coup d'envoi. `generate.js` n'écrit donc, avant le
match, que « les picks sont révélés au coup d'envoi » (ou le nombre de joueurs avec `--picks`) ; sa variante
`--variant reveal` (répartition des picks) est **refusée** tant que le match n'a pas commencé.
