# wsl-bridge

Connecteur MCP qui donne aux sessions **Cowork** un accès au **WSL du poste** : exécuter des
commandes sur la machine (son réseau interne, ses jetons, ses outils installés) et échanger des
fichiers avec le dossier de session — sans les faire transiter par le contexte de la conversation.

En Cowork, la sandbox est isolée du poste. Ce pont tourne côté WSL, enregistré comme connecteur
Cowork, et fait le lien. Hors Cowork (Claude Code local), il est inutile : le poste est déjà
accessible directement.

## Prérequis

- **WSL** avec une distribution Linux et **Node.js ≥ 18** (`node --version`).
- **Claude Desktop** sous Windows.
- Le dossier de ce dépôt cloné/copié dans la WSL (ci-dessous `<dépôt>` = son chemin, p. ex.
  `~/www/wsl-bridge`).

## Installation

### Côté WSL — un lien stable vers le serveur

Un lien symbolique fixe dans `~/.mcp/` : la config Windows pointe vers un chemin stable, quel que
soit l'emplacement du dépôt.

```bash
mkdir -p ~/.mcp
ln -sf <dépôt>/server.mjs ~/.mcp/wsl-bridge.mjs
```

Vérifier que le serveur démarre :

```bash
node ~/.mcp/wsl-bridge.mjs --help
```

### Côté Windows — enregistrer le connecteur dans Claude Desktop

1. Ouvrir `claude_desktop_config.json` : menu **Personnaliser → Développeur → Modifier la config**
   (le fichier vit dans `%APPDATA%\Claude\`).
2. Ajouter au nœud racine `mcpServers` :

   ```json
   "wsl-bridge": {
     "command": "wsl.exe",
     "args": ["bash", "-lic", "node ~/.mcp/wsl-bridge.mjs"]
   }
   ```

3. Redémarrer Claude **entièrement** — quitter le process, pas seulement fermer la fenêtre.

Le shell de connexion (`-lic`) source `~/.bashrc` : les variables d'environnement du poste
arrivent jusqu'aux commandes du pont (voir [Configuration](#configuration)). `wsl.exe` vise la
distribution **par défaut** ; si plusieurs sont installées, vérifier avec `wsl -l -v` et, au besoin,
ajouter `"-d", "<distribution>"` en tête des `args`.

## Configuration

### Variables d'environnement du poste

Les commandes lancées par le pont héritent de l'environnement chargé par `~/.bashrc`. Pour qu'un
jeton ou une variable soit disponible côté pont, l'exporter dans `~/.bashrc` :

```bash
export MA_VARIABLE="…"
```

puis redémarrer Claude Desktop.

### `WSL_BRIDGE_SESSION_ROOTS`

Racines où le pont cherche les dossiers de sessions Cowork, vues depuis la WSL. Par défaut il couvre
les deux emplacements standards de Claude Desktop (installation Microsoft Store et installation
classique). À définir **seulement** si Claude Desktop est installé ailleurs, ou si l'amorçage
(`init`) ne trouve pas le dossier de session.

Valeur : un ou plusieurs motifs `/mnt/c/…` séparés par `:` (les `*` sont développés). À exporter
dans `~/.bashrc`, puis redémarrer Claude Desktop :

```bash
export WSL_BRIDGE_SESSION_ROOTS="/mnt/c/Users/<moi>/AppData/Roaming/Claude/local-agent-mode-sessions"
```

## Vérification

En session Cowork, demander à Claude d'amorcer le pont (`init`). Le succès se voit à l'apparition
d'un fichier `.wsl-bridge-handshake.json` à la racine du dossier de travail de la session.

## Dépannage

- **Connecteur absent des outils** — config Windows non prise en compte : revoir le JSON et
  redémarrer Claude entièrement.
- **`node: command not found`** — Node introuvable dans le shell de connexion : l'installer, ou
  exporter son chemin dans `~/.bashrc`.
- **`init` ne trouve pas la session** — définir `WSL_BRIDGE_SESSION_ROOTS`, ou fournir à Claude le
  chemin Windows du dossier des sessions Cowork (il le convertira en `/mnt/c/…`).
- **Plusieurs distributions WSL** — ajouter `"-d", "<distribution>"` aux `args`.
