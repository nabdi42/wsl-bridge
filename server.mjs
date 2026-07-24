#!/usr/bin/env node
// Serveur MCP du pont wsl-bridge : façade mince stdin/stdout ↔ core/wsl. Tourne côté poste (WSL),
// enregistré comme connecteur Cowork lancé par un shell de connexion (`bash -lic`) : les commandes
// héritent de l'environnement du poste (~/.bashrc). Il ne porte aucune logique — tout vit dans core/wsl/.

import { config } from "./core/config.mjs";
import { dispatch } from "./core/wsl/protocol.mjs";
import { createRegistry } from "./core/wsl/tools.mjs";

const HELP = `wsl-bridge — serveur MCP, pont Cowork ↔ WSL du poste.

Parle le JSON-RPC 2.0 (MCP) sur stdin/stdout, un message par ligne. Ne pas lancer à la main : ce
serveur est enregistré comme connecteur Cowork et tourne côté poste (voir le README racine, « Installer »).

Outils exposés : init · run · job_start · job_status · push · pull · clean.
Le pont amorce une session (init), exécute des commandes sur le poste, et copie des fichiers entre le
dossier de session Cowork et son workspace WSL — jamais par le contexte de la conversation.

Variable reconnue : WSL_BRIDGE_SESSION_ROOTS (motifs de racines des sessions, séparés par \`:\`),
à régler dans ~/.bashrc quand Claude Desktop est installé hors des emplacements standards.`;

if (process.argv.includes("--help")) {
    process.stdout.write(`${HELP}\n`);
} else {
    serve();
}

function serve() {
    // Seule la façade lit l'environnement ; core/ reçoit tout en paramètre.
    const rootsFromEnv = (process.env.WSL_BRIDGE_SESSION_ROOTS ?? "").split(":").filter(Boolean);
    const registry = createRegistry({
        ...config.wsl,
        ...(rootsFromEnv.length > 0 && { sessionRootPatterns: rootsFromEnv }),
    });
    const context = { registry, serverInfo: { name: "wsl-bridge", version: "1" } };

    // Les messages se traitent un à un, dans l'ordre reçu : une réponse par ligne, sans entrelacement.
    // Cette file sert aussi de barrière d'amorçage : aucun outil ne part pendant qu'un init s'exécute.
    let queue = Promise.resolve();
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
        buffer += chunk;
        let cut;
        while ((cut = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, cut).trim();
            buffer = buffer.slice(cut + 1);
            if (line !== "") queue = queue.then(() => handle(line, context));
        }
    });
}

async function handle(line, context) {
    let message;
    try {
        message = JSON.parse(line);
    } catch {
        return; // une ligne qui n'est pas du JSON n'est pas un message : on l'ignore.
    }
    const response = await dispatch(message, context);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}
