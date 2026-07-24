// Le registre des outils du pont : nom, schéma d'entrée, et handler branché sur les modules de
// core/wsl/. L'état de session vit dans la closure du registre : un pont à la fois, le dernier
// `init` gagne ; tout autre outil exige une session amorcée.

import fs from "node:fs/promises";
import path from "node:path";
import { copyAnyVerified, resolveIn } from "./copy.mjs";
import { discoverSessionPath } from "./discovery.mjs";
import { badArgs, noSession } from "./errors.mjs";
import { jobStart, jobStatus, run } from "./exec.mjs";
import { openSession } from "./session.mjs";

// Fabriques de schémas JSON minimaux — le contrat de chaque outil, lisible par le client MCP.
const object = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = (description) => ({ type: "string", description });
const integer = (description) => ({ type: "integer", description });

// Paramètres communs à run, job_start et job_status.
const cwd = string("Répertoire d'exécution, chemin absolu côté WSL (défaut : workspace de la session).");
const tailLines = integer("Nombre de lignes de fin de log rendues (défaut : config).");

/**
 * Construit les sept outils du pont au-dessus de la config `wsl`. `cfg.sessionRootPatterns` porte
 * les racines des sessions Cowork, éventuellement surchargées par la façade.
 */
export function createRegistry(cfg) {
  let session = null;

  function requireSession() {
    if (!session) {
      throw noSession(
        "Pont non amorcé : appeler d'abord `init` (avec `marker` écrit côté sandbox, ou le " +
        `\`session_path\` du ${cfg.handshakeName} d'une session déjà amorcée).`,
      );
    }
    return session;
  }

  async function init({ marker, session_path }) {
    let sessionPath;
    if (session_path) {
      sessionPath = session_path;
    } else if (marker) {
      sessionPath = await discoverSessionPath(marker, cfg);
    } else if (session) {
      return { ...session.handshake, note: "Pont déjà amorcé (état courant renvoyé)." };
    } else {
      throw badArgs("Fournir `marker` (première amorce) ou `session_path` (reprise).");
    }
    session = await openSession(sessionPath, cfg);
    return {
      ...session.handshake,
      note:
        `Vérifier côté sandbox que ${cfg.handshakeName} est visible à la racine du dossier de ` +
        "travail de la session ; sinon le chemin découvert est faux — refaire l'amorçage avec un " +
        "marqueur neuf.",
    };
  }

  return [
    {
      name: "init",
      description:
        "Amorce le pont pour la session Cowork courante : localise le dossier de session (fichier " +
        "marqueur écrit côté sandbox, ou chemin déjà connu), crée le workspace WSL et écrit " +
        `${cfg.handshakeName} dans le dossier de session. À appeler avant les autres outils.`,
      inputSchema: object({
        marker: string("Nom du fichier marqueur écrit à la racine du dossier de travail de la session (première amorce)."),
        session_path: string(`Chemin /mnt/c/… du dossier de session, lu dans ${cfg.handshakeName} (reprise sans nouvelle recherche).`),
      }),
      handler: init,
    },
    {
      name: "run",
      description:
        "Commande courte sur le poste. La sortie complète (stdout+stderr) va dans un log du " +
        "workspace ; ne rend que le code retour et la fin du log — un résultat volumineux s'écrit " +
        "dans un fichier, à rapatrier avec `pull`, jamais via la sortie.",
      inputSchema: object(
        {
          command: string("La commande bash à exécuter."),
          cwd,
          timeout_ms: integer("Délai avant interruption, en millisecondes (0 = sans limite). Au-delà de quelques minutes, préférer job_start."),
          tail_lines: tailLines,
        },
        ["command"],
      ),
      handler: (params) => run(params, requireSession(), cfg),
    },
    {
      name: "job_start",
      description:
        "Lance une commande longue en détaché (aucun timeout) et rend son job_id. Le job survit à " +
        "un redémarrage du connecteur ; suivre avec job_status.",
      inputSchema: object(
        {
          command: string("La commande bash à lancer en arrière-plan."),
          cwd,
          name: string("Préfixe lisible de l'identifiant du job (ex. « export »)."),
        },
        ["command"],
      ),
      handler: (params) => jobStart(params, requireSession()),
    },
    {
      name: "job_status",
      description:
        "État d'un job : en cours (running), terminé (done, avec code retour) ou disparu (aborted), " +
        "avec la fin de son log.",
      inputSchema: object(
        { job_id: string("L'identifiant rendu par job_start."), tail_lines: tailLines },
        ["job_id"],
      ),
      handler: (params) => jobStatus(params, requireSession(), cfg),
    },
    {
      name: "push",
      description:
        "Copie un fichier, ou un dossier récursivement, du dossier de session Cowork vers le " +
        "workspace WSL, taille vérifiée à l'arrivée. Le contenu ne transite pas par la conversation. " +
        "Rend `bytes`, plus `files` pour un dossier.",
      inputSchema: object(
        {
          source: string("Fichier ou dossier à copier, relatif au dossier de session (ou chemin absolu)."),
          dest: string("Destination, relative au workspace (défaut : racine du workspace, même nom). Chemin absolu accepté."),
        },
        ["source"],
      ),
      handler: ({ source, dest }) => {
        const s = requireSession();
        const src = resolveIn(s.sessionPath, source);
        return copyAnyVerified(src, resolveIn(s.workspace, dest ?? path.basename(src)), cfg);
      },
    },
    {
      name: "pull",
      description:
        "Copie un fichier, ou un dossier récursivement, du workspace WSL (ou d'un chemin absolu) " +
        "vers le dossier de session Cowork, où la sandbox le lit avec ses outils natifs. Taille " +
        "vérifiée à l'arrivée ; rend `bytes`, plus `files` pour un dossier.",
      inputSchema: object(
        {
          source: string("Fichier ou dossier à copier, relatif au workspace (ou chemin absolu WSL)."),
          dest: string("Destination, relative au dossier de session (défaut : racine de la session, même nom). Chemin absolu accepté."),
        },
        ["source"],
      ),
      handler: ({ source, dest }) => {
        const s = requireSession();
        const src = resolveIn(s.workspace, source);
        return copyAnyVerified(src, resolveIn(s.sessionPath, dest ?? path.basename(src)), cfg);
      },
    },
    {
      name: "clean",
      description: "Supprime le workspace WSL de la session (logs, jobs, fichiers de travail).",
      inputSchema: object({}),
      handler: async () => {
        const s = requireSession();
        await fs.rm(s.workspace, { recursive: true, force: true });
        return { removed: s.workspace };
      },
    },
  ];
}
