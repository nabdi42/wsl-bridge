# wsl-bridge

## Configuration

`WSL_BRIDGE_SESSION_ROOTS` : @TODO

## Installation

**Côté WSL — un lien stable vers le serveur du plugin.**

1. Enregistrer le serveur MCP

```
  mkdir -p ~/.mcp
  ln -sf ~/@TODO/wsl-bridge/server.mjs ~/.mcp/wsl-bridge.mjs
```

**Côté Windows — enregistrer le connecteur dans Claude Desktop.**

1. Ouvrir `claude_desktop_config.json` : menu `Personnaliser → Développeur → Modifier la config` (le
   fichier vit dans `%APPDATA%\Claude\`).
2. Ajouter au nœud racine `mcpServers` :
   ```json
   "wsl-bridge": {
     "command": "wsl.exe",
     "args": ["bash", "-lic", "node ~/.mcp/wsl-bridge.mjs"]
   }
   ```
   Le shell de connexion (`-lic`) source `~/.bashrc` : `GITLAB_TOKEN` et les autres variables du
   poste arrivent jusqu'aux commandes du pont. `wsl.exe` vise la distro **par défaut** — si
   plusieurs sont installées, vérifier avec `wsl -l -v`, ou ajouter `"-d", "<distro>"` en tête des
   `args`.
3. Redémarrer Claude entièrement — tuer le process, pas seulement fermer la fenêtre.
