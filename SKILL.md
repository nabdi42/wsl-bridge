---
name: wsl-bridge
description: Pont vers le WSL du poste, réservé aux sessions Cowork (sandbox isolée où le connecteur wsl-bridge est présent). Exécuter des commandes sur le poste — son réseau interne, ses jetons, ses outils installés — et échanger des fichiers avec le dossier de session, sans les faire transiter par le contexte de la conversation. Utiliser dès qu'une tâche ou un autre skill exécuté en Cowork doit toucher le poste. Jamais hors Cowork — en Claude Code local, le poste et son réseau sont déjà accessibles directement.
---

# wsl-bridge — pont Cowork ↔ WSL du poste

En session Cowork, la sandbox est isolée du poste. Le connecteur **`wsl-bridge`** donne sept outils
pour agir de l'autre côté : `init`, `run`, `job_start`, `job_status`, `push`, `pull`, `clean`
(paramètres et sorties décrits par leurs schémas). S'il manque, proposer son installation
(voir le [README](README.md), « Installation ») avant tout contournement.

Le **dossier de session** est visible des deux côtés à la fois : dossier de travail de la sandbox,
et `/mnt/c/…` côté WSL. `push` et `pull` copient entre ce dossier et le **workspace WSL** de la
session — un vrai disque Linux, rapide, à l'écart du montage lent.

## Amorçage — une fois par tâche

1. Écrire côté sandbox un fichier vide `.wsl-bridge-marker-<uuid>` (uuid aléatoire, neuf à chaque
   essai) à la racine du dossier de travail, puis appeler `init` avec ce nom en `marker`.
2. Vérifier côté sandbox que `.wsl-bridge-handshake.json` est apparu à la racine. Absent → le
   dossier découvert n'est pas le bon : refaire avec un marqueur neuf.
3. Reprise (le handshake existe déjà) : `init` avec son `session_path`, sans nouvelle recherche.

Si `init` échoue : demander à l'utilisateur le chemin Windows de son dossier des sessions Cowork,
en dériver le `/mnt/c/…` et rappeler `init` avec `session_path` — ne pas explorer le disque.

## Règle d'or : aucun contenu de fichier via le contexte

- **Vers le WSL** : écrire le fichier dans le dossier de session (outils natifs), puis `push`.
- **Depuis le WSL** : `pull`, puis lecture native côté sandbox — jamais par tranches de `tail`.
- `run` et `job_status` ne rendent que le code retour et la fin du log ; un résultat volumineux
  s'écrit dans un fichier côté WSL. Un échec de commande n'est pas une erreur d'outil : lire le
  code retour qu'ils rendent.

## Mener une tâche par le pont

1. **Amener la matière** dans le dossier de session, puis un seul `push` du dossier — jamais fichier
   par fichier.
2. **Exécuter côté WSL** depuis le workspace : `run` ; au-delà de quelques minutes, `job_start` puis
   `job_status` jusqu'au code retour (le job survit à un redémarrage du connecteur).
3. **Pousser toute édition avant la commande qui la lit** — non poussée, elle n'est pas vue.
4. **Rapatrier selon le destinataire** : pour une étape suivante → rester côté WSL, contrôlé par
   `jq`/`grep` via `run` ; pour le modèle → `pull`, lecture intégrale.
5. **Livrer** : `pull` du livrable final dans le dossier de session.

Un autre skill qui a besoin du poste suit ce même déroulé — son dossier est la matière de l'étape 1.

## Conventions

- Chemins absolus, ou relatifs au workspace (`cwd` par défaut).
- L'environnement vient du poste (`~/.bashrc`) : pour une variable manquante, voir le
  [README](README.md), « Configuration ».
- Fin de tâche : proposer `clean`, ou signaler que le workspace reste dans `/tmp`.

## Replis, dans l'ordre

1. Les outils du pont.
2. Connecteur absent → proposer l'installation (README).
3. `init` en échec → demander le chemin (voir « Amorçage »).
4. Mode manuel → fournir les commandes bash exactes à coller dans le terminal WSL ; les fichiers
   passent par le dossier de session.
