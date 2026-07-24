---
name: wsl-bridge
description: Pont vers le WSL du poste, réservé aux sessions Cowork (sandbox isolée où le connecteur wsl-bridge est présent). Exécuter des commandes sur le poste — son réseau (GitLab interne), ses jetons (GITLAB_TOKEN), ses outils installés — et échanger des fichiers avec le dossier de session, sans les faire transiter par le contexte de la conversation. Utiliser dès qu'une tâche ou un autre skill exécuté en Cowork doit toucher le poste. Jamais hors Cowork — en Claude Code local, le poste et son réseau sont déjà accessibles directement.
---

# wsl-bridge — pont Cowork ↔ WSL du poste

En session Cowork, la sandbox est isolée du poste. Le connecteur **`wsl-bridge`** donne sept outils
pour agir de l'autre côté : `init`, `run`, `job_start`, `job_status`, `push`, `pull`, `clean` —
paramètres et sorties décrits par leurs schémas. S'il manque, proposer son installation
([README racine](README.md), « Installer ») avant tout contournement.

Le **dossier de session** est visible des deux côtés à la fois : dossier de travail de la sandbox,
et `/mnt/c/…` côté WSL. Un fichier déposé d'un côté apparaît de l'autre sans transiter par le
contexte ; `push` et `pull` copient entre ce dossier et le **workspace WSL** de la session.

## Amorçage — une fois par tâche

1. Écrire côté sandbox un fichier vide `.wsl-bridge-marker-<uuid>` (uuid réellement aléatoire,
   régénéré à chaque tentative) à la racine du dossier de travail, puis appeler `init` avec ce nom
   en `marker`.
2. Vérifier côté sandbox que `.wsl-bridge-handshake.json` est apparu à la racine du dossier de
   travail. Absent → le dossier découvert n'est pas le bon : refaire avec un marqueur neuf.
3. Reprise (le handshake existe déjà) : `init` avec son `session_path`, sans nouvelle recherche.

Si `init` échoue ou que le décalage persiste : demander à l'utilisateur le chemin Windows de son
dossier des sessions Cowork, en dériver le `/mnt/c/…` du dossier de session et rappeler `init` avec
`session_path` — ne pas partir en exploration du disque.

## Règle d'or : aucun contenu de fichier via le contexte

- Vers le WSL : écrire le fichier dans le dossier de session (outils natifs), puis `push`.
- Depuis le WSL : `pull`, puis lecture native côté sandbox — jamais par tranches de `tail`.
- `run` et `job_status` ne rendent que le code retour et la fin du log (leur schéma dit s'il est
  couvert en entier) ; un résultat volumineux s'écrit dans un fichier côté WSL. Un échec de commande
  n'est pas une erreur d'outil : lire le code retour qu'ils rendent.
- `push`/`pull` prennent aussi un dossier, dans les limites que leur schéma pose. Pour du JSON
  rapatrié, contrôler quelques clés (`jq`) — un gros mono-ligne paraît vide dans un aperçu tronqué.

## Mener une tâche par le pont

1. **Amener la matière** dans le dossier de session (outils natifs, `cp -r`), puis un seul `push`
   du dossier — jamais un `push` par fichier.
2. **Exécuter côté WSL** depuis le workspace : `run` ; au-delà de quelques minutes, `job_start`
   puis `job_status` jusqu'au code retour — le job détaché survit à un redémarrage du connecteur.
3. **Pousser toute édition avant la commande qui la lit** — non poussée, elle n'est pas vue.
4. **Rapatrier selon le destinataire, jamais selon la taille** : pour une autre étape → reste côté
   WSL, contrôlé par `jq`/`grep` via `run` ; pour le LLM → `pull`, lecture intégrale.
5. **Livrer** : le livrable final se `pull` dans le dossier de session.

Un skill qui a besoin du poste s'exécute intégralement ainsi — son dossier est la matière de
l'étape 1 ; il n'a rien à savoir du pont.

## Conventions

- Chemins absolus, ou relatifs au workspace (`cwd` par défaut).
- L'environnement vient du poste (`~/.bashrc`) : pour ajouter une variable manquante, voir le
  [README racine](README.md), « Pont WSL ».
- Fin de tâche : proposer `clean`, ou signaler que le workspace reste dans `/tmp`.

## Replis, dans l'ordre

1. Les outils du pont.
2. Connecteur absent : proposer l'installation (README racine).
3. `init` en échec : demander le chemin (« Amorçage »).
4. Mode manuel : fournir les commandes bash exactes à coller dans le terminal WSL de l'utilisateur ;
   les fichiers passent par le dossier de session, ou par la conversation.
