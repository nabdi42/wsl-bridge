// Copier des fichiers entre le dossier de session Cowork et le workspace WSL, taille vérifiée à
// l'arrivée — la troncature silencieuse est l'échec le plus courant d'un transfert 9p. Un dossier se
// copie récursivement, sous gardes contrôlées avant la première écriture : complet, ou rien.

import fs from "node:fs/promises";
import path from "node:path";
import { badArgs, ioError, notFound } from "./errors.mjs";

/** Résout `p` relativement à `base` ; un chemin absolu est gardé tel quel. */
export function resolveIn(base, p) {
  return path.isAbsolute(p) ? p : path.join(base, p);
}

/** Compare les tailles d'une copie ; des tailles différentes signent une copie tronquée. */
export function verifySize(sourceBytes, destBytes, dest) {
  if (sourceBytes !== destBytes) {
    throw ioError(`Copie tronquée : ${sourceBytes} octets à la source, ${destBytes} à l'arrivée (${dest}).`);
  }
}

/**
 * Copie un fichier vers `dst` (un dossier existant reçoit le fichier sous son nom), et vérifie la
 * taille à l'arrivée. Rend `{ source, dest, bytes }`.
 */
export async function copyVerified(src, dst) {
  let sourceStat;
  try {
    sourceStat = await fs.stat(src);
  } catch {
    throw notFound(`Fichier source introuvable : ${src}`);
  }
  if (!sourceStat.isFile()) throw badArgs(`La source n'est pas un fichier : ${src}`);
  try {
    if ((await fs.stat(dst)).isDirectory()) dst = path.join(dst, path.basename(src));
  } catch {
    // destination inexistante : c'est un chemin de fichier.
  }
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.copyFile(src, dst);
  verifySize(sourceStat.size, (await fs.stat(dst)).size, dst);
  return { source: src, dest: dst, bytes: sourceStat.size };
}

/**
 * Recense les fichiers réguliers sous `dir`, récursivement. Les entrées qui ne sont ni un fichier ni
 * un dossier — liens, sockets, périphériques — sont ignorées : elles n'ont pas de contenu à copier,
 * et un lien suivi ferait sortir la copie de l'arborescence.
 */
export async function listRegularFiles(dir) {
  const found = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await listRegularFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/**
 * Copie un dossier récursivement, chaque fichier vérifié par `copyVerified`. Les gardes sont
 * contrôlées sur le recensement, avant la première copie : une source trop large (dépôt cloné,
 * node_modules) échoue sans rien avoir écrit. Rend `{ source, dest, files, bytes }`.
 */
export async function copyDirVerified(src, dst, { copyMaxFiles, copyMaxBytes }) {
  const files = await listRegularFiles(src);
  if (files.length > copyMaxFiles) {
    throw badArgs(`Dossier trop fourni : ${files.length} fichiers sous ${src}, maximum ${copyMaxFiles}.`);
  }
  const sizes = await Promise.all(files.map(async (file) => (await fs.stat(file)).size));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > copyMaxBytes) {
    throw badArgs(`Dossier trop volumineux : ${total} octets sous ${src}, maximum ${copyMaxBytes}.`);
  }
  for (const file of files) {
    await copyVerified(file, path.join(dst, path.relative(src, file)));
  }
  return { source: src, dest: dst, files: files.length, bytes: total };
}

/** Copie un fichier, ou un dossier récursivement, selon la nature de la source. */
export async function copyAnyVerified(src, dst, cfg) {
  let sourceStat;
  try {
    sourceStat = await fs.stat(src);
  } catch {
    throw notFound(`Source introuvable : ${src}`);
  }
  return sourceStat.isDirectory() ? copyDirVerified(src, dst, cfg) : copyVerified(src, dst);
}
