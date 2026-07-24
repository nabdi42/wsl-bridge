
export const config = {

    // Le pont wsl-bridge : connecteur Cowork tournant côté poste (voir mcps/wsl-bridge/).
    wsl: {
        // Racine des workspaces créés par `init` ; déterministe : même session, même workspace.
        bridgeRoot: "/tmp/wsl-bridge",
        // Fichier d'amorce écrit par `init` dans le dossier de session ; sa présence, vérifiée côté
        // sandbox, prouve que le dossier découvert est le bon.
        handshakeName: ".wsl-bridge-handshake.json",
        // Racines des sessions Cowork vues de WSL (installation MSIX, puis classique) ; les `*` sont
        // développés par lecture de répertoire, sans shell. Surchargeables par la variable
        // WSL_BRIDGE_SESSION_ROOTS (motifs séparés par `:`), lue par la façade.
        sessionRootPatterns: [
            "/mnt/c/Users/*/AppData/Local/Packages/Claude_*/LocalCache/Roaming/Claude/local-agent-mode-sessions",
            "/mnt/c/Users/*/AppData/Roaming/Claude/local-agent-mode-sessions",
        ],
        // Recherche du marqueur sous les racines : profondeur, et délai (le montage 9p est lent).
        findMaxDepth: 6,
        findTimeoutMs: 120000,
        // Délai par défaut d'une commande `run` courte, en millisecondes.
        runTimeoutMs: 120000,
        // Fin de log rendue par run/job_status ; `tail_complete` dit si le log tient entier.
        tailLines: 40,
        tailBytes: 8192,
        // Gardes de push/pull d'un dossier, contrôlées sur le recensement, avant toute copie.
        copyMaxFiles: 500,
        copyMaxBytes: 64 * 1024 * 1024,
    },
};
