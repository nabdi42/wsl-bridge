// Ouvrir une session du pont : vérifier le dossier de session, créer son workspace WSL, et y déposer
// le handshake — la preuve, lisible côté sandbox, que la découverte a visé le bon dossier.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { badArgs } from "./errors.mjs";

const execFileAsync = promisify(execFile);

/** Chemin du workspace d'une session : déterministe — même session, même workspace. */
export function workspacePathFor(sessionPath, bridgeRoot) {
  const hash = createHash("sha1").update(sessionPath).digest("hex").slice(0, 8);
  return path.join(bridgeRoot, `s-${hash}`);
}

// Espace libre sur /tmp (colonne « avail » de df -h) — à contrôler avant une opération volumineuse.
async function tmpFreeSpace() {
  try {
    const { stdout } = await execFileAsync("df", ["-h", "--output=avail", "/tmp"]);
    return stdout.split("\n")[1]?.trim() ?? "inconnu";
  } catch {
    return "inconnu";
  }
}

/**
 * Ouvre la session : vérifie que `sessionPath` est un répertoire, crée `<workspace>/{logs,jobs}` et
 * écrit le handshake `{ schema, session_path, workspace, disk_free_tmp, created_at }` dans le dossier
 * de session. Rend `{ sessionPath, workspace, handshake }`.
 */
export async function openSession(sessionPath, cfg) {
  let stat = null;
  try {
    stat = await fs.stat(sessionPath);
  } catch {
    // chemin inaccessible : traité juste après.
  }
  if (!stat?.isDirectory()) {
    throw badArgs(`session_path n'est pas un répertoire accessible : ${sessionPath}`);
  }
  const workspace = workspacePathFor(sessionPath, cfg.bridgeRoot);
  await fs.mkdir(path.join(workspace, "logs"), { recursive: true });
  await fs.mkdir(path.join(workspace, "jobs"), { recursive: true });
  const handshake = {
    schema: "wsl-bridge/1",
    session_path: sessionPath,
    workspace,
    disk_free_tmp: await tmpFreeSpace(),
    created_at: new Date().toISOString(),
  };
  await fs.writeFile(path.join(sessionPath, cfg.handshakeName), JSON.stringify(handshake, null, 2));
  return { sessionPath, workspace, handshake };
}
