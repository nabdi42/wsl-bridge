// Trouver le dossier de session Cowork depuis WSL : développer les racines candidates, chercher le
// fichier marqueur écrit côté sandbox, et rendre le dossier qui le contient. Chaque échec porte la
// marche à suivre — c'est ici que l'amorçage se joue.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { badArgs, notFound } from "./errors.mjs";

const execFileAsync = promisify(execFile);

// Noms acceptés pour un marqueur ou un identifiant : rien qui puisse s'échapper d'un chemin.
export const SAFE_NAME = /^[\w.-]+$/;

/**
 * Développe un motif de chemin absolu dont des segments contiennent `*`, par lecture de répertoire
 * (sans shell). Rend les dossiers existants qui correspondent.
 */
export async function expandPattern(pattern) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let dirs = ["/"];
  for (const segment of pattern.split("/").filter(Boolean)) {
    const next = [];
    for (const dir of dirs) {
      if (segment.includes("*")) {
        const matches = new RegExp(`^${segment.split("*").map(escape).join(".*")}$`);
        let entries = [];
        try {
          entries = await fs.readdir(dir);
        } catch {
          continue; // branche absente ou illisible : elle ne mène à rien.
        }
        for (const entry of entries) if (matches.test(entry)) next.push(path.join(dir, entry));
      } else {
        next.push(path.join(dir, segment));
      }
    }
    dirs = next;
  }
  const existing = [];
  for (const dir of dirs) {
    try {
      if ((await fs.stat(dir)).isDirectory()) existing.push(dir);
    } catch {
      // candidat absent : ignoré.
    }
  }
  return existing;
}

/** Racines existantes pour un jeu de motifs, sans doublon. */
export async function expandRoots(patterns) {
  const roots = (await Promise.all(patterns.map(expandPattern))).flat();
  return [...new Set(roots)];
}

/**
 * Cherche le fichier `marker` sous `roots` via `find`, et rend les chemins trouvés. Le code retour
 * de `find` est ignoré : un sous-dossier illisible le fait sortir en erreur même quand des marqueurs
 * ont été imprimés. Seul le dépassement du délai est une erreur.
 */
export async function findMarkers(marker, roots, { findMaxDepth, findTimeoutMs }) {
  let stdout = "";
  try {
    ({ stdout } = await execFileAsync(
      "find", [...roots, "-maxdepth", String(findMaxDepth), "-name", marker],
      { timeout: findTimeoutMs },
    ));
  } catch (error) {
    if (error.killed) {
      throw notFound(
        `Recherche du marqueur interrompue après ${findTimeoutMs} ms (montage 9p lent ou racines de ` +
        "sessions trop larges). Rappeler `init` avec `session_path` si le chemin est connu, ou " +
        "resserrer les racines via WSL_BRIDGE_SESSION_ROOTS dans ~/.bashrc du poste.",
      );
    }
    stdout = error.stdout ?? "";
  }
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * Localise le dossier de session Cowork portant le fichier `marker`, et supprime ce dernier.
 * Échoue si aucune racine n'existe, si le marqueur est introuvable, ou s'il apparaît à plusieurs
 * endroits (tous supprimés : un marqueur ambigu ne doit pas resservir).
 */
export async function discoverSessionPath(marker, cfg) {
  if (!SAFE_NAME.test(marker)) {
    throw badArgs("Nom de marqueur invalide (lettres, chiffres, `.`, `_`, `-` uniquement).");
  }
  const roots = await expandRoots(cfg.sessionRootPatterns);
  if (roots.length === 0) {
    throw notFound(
      "Aucune racine de sessions Cowork trouvée sous /mnt/c (Claude Desktop installé ailleurs ?). " +
      "Demander à l'utilisateur le chemin Windows du dossier qui contient ses sessions Cowork, le " +
      "convertir en /mnt/c/… et rappeler `init` avec `session_path` — ou régler " +
      "WSL_BRIDGE_SESSION_ROOTS dans ~/.bashrc du poste.",
    );
  }
  const hits = await findMarkers(marker, roots, cfg);
  if (hits.length === 0) {
    throw notFound(
      `Marqueur « ${marker} » introuvable sous les racines de sessions Cowork. Vérifier qu'il a été ` +
      "écrit à la racine du dossier de travail de la session ; sinon, demander à l'utilisateur le " +
      "chemin Windows de son dossier des sessions et rappeler `init` avec `session_path`.",
    );
  }
  if (hits.length > 1) {
    await Promise.all(hits.map((hit) => fs.unlink(hit).catch(() => {})));
    throw notFound(
      `Marqueur « ${marker} » trouvé à ${hits.length} endroits — impossible de choisir le dossier ` +
      "de session (tous les marqueurs ont été supprimés) :\n" +
      hits.map((hit) => `- ${path.dirname(hit)}`).join("\n") +
      "\nRéécrire côté sandbox un marqueur au nom unique (nouvel uuid) et rappeler `init`.",
    );
  }
  const sessionPath = path.dirname(hits[0]);
  await fs.unlink(hits[0]).catch(() => {}); // marqueur consommé : il ne doit pas resservir.
  return sessionPath;
}
