// Exécuter des commandes sur le poste, dans le workspace d'une session amorcée. La sortie complète
// (stdout+stderr entremêlés) va dans un log du workspace ; la réponse ne porte qu'un résumé d'état :
// code retour et fin de log. Un résultat volumineux s'écrit dans un fichier, jamais dans la sortie.

import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { badArgs, ioError, notFound } from "./errors.mjs";
import { SAFE_NAME } from "./discovery.mjs";

// Fin de fichier réellement lue par tailLog : au-delà, le début du log n'est pas même parcouru.
const TAIL_READ_BYTES = 64 * 1024;

// Suffixe anti-collision des identifiants générés dans la même milliseconde.
let seq = 0;

function uid() {
  return `${Date.now().toString(36)}-${++seq}`;
}

/**
 * Réduit un log à sa fin : au plus `maxBytes` octets puis `maxLines` lignes. `tail_complete` dit si
 * rien n'a été coupé — un aperçu tronqué qui se ferait passer pour le tout serait un mensonge.
 */
export function tail(text, { maxLines, maxBytes }) {
  let slice = text;
  let complete = true;
  const buffer = Buffer.from(slice, "utf8");
  if (buffer.length > maxBytes) {
    slice = buffer.subarray(buffer.length - maxBytes).toString("utf8");
    complete = false;
  }
  const lines = slice.split("\n");
  if (lines.length > maxLines) {
    slice = lines.slice(lines.length - maxLines).join("\n");
    complete = false;
  }
  return { tail: slice, tail_complete: complete };
}

/** Déduit l'état d'un job de la présence du fichier de code retour : absent = en cours. */
export function jobStateFrom(exitContent) {
  if (exitContent === null || exitContent === undefined) return { state: "running" };
  const code = Number.parseInt(String(exitContent).trim(), 10);
  return { state: "done", exit_code: Number.isNaN(code) ? null : code };
}

/**
 * Fin d'un log sur disque : seuls les derniers 64 Ko sont lus, puis réduits par `tail`. Rend
 * `{ tail, tail_complete, log_bytes }` — `log_bytes` donne la taille totale du log.
 */
export async function tailLog(logPath, { maxLines, maxBytes }) {
  let handle;
  try {
    handle = await fs.open(logPath, "r");
  } catch {
    return { tail: "(log vide ou absent)", tail_complete: true, log_bytes: 0 };
  }
  try {
    const { size } = await handle.stat();
    if (size === 0) return { tail: "(aucune sortie)", tail_complete: true, log_bytes: 0 };
    const chunk = Math.min(size, TAIL_READ_BYTES);
    const buffer = Buffer.alloc(chunk);
    await handle.read(buffer, 0, chunk, size - chunk);
    // Le saut de ligne final d'un log n'est pas une ligne : il ne compte ni ne s'affiche.
    const text = buffer.toString("utf8").replace(/\n$/, "");
    const cut = tail(text, { maxLines, maxBytes });
    return { ...cut, tail_complete: cut.tail_complete && chunk === size, log_bytes: size };
  } finally {
    await handle.close();
  }
}

// Lance `bash -c command` dans son propre groupe, sortie ajoutée à `logPath`. Le groupe propre permet
// de tuer toute la descendance ; l'environnement est hérité du serveur (lancé par un shell -lic).
function bashToLog(command, { cwd, logPath }) {
  const fd = openSync(logPath, "a");
  try {
    return spawn("bash", ["-c", command], { cwd, detached: true, stdio: ["ignore", fd, fd] });
  } finally {
    closeSync(fd);
  }
}

/**
 * Commande courte : attend la fin (au plus `timeout_ms` — 0 = sans limite —, puis SIGKILL sur le
 * groupe), log complet dans `<workspace>/logs/`. Rend `{ exit_code, log, log_bytes, tail,
 * tail_complete }`, plus `signal` et `timed_out`/`timeout_ms` quand la commande n'a pas fini seule.
 */
export async function run({ command, cwd, timeout_ms, tail_lines }, session, cfg) {
  const limitMs = timeout_ms ?? cfg.runTimeoutMs;
  const logDir = path.join(session.workspace, "logs");
  await fs.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `run-${uid()}.log`);

  const outcome = await new Promise((resolve, reject) => {
    const child = bashToLog(command, { cwd: cwd ?? session.workspace, logPath });
    let timedOut = false;
    const timer = limitMs > 0
      ? setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // groupe déjà terminé.
        }
      }, limitMs)
      : null;
    child.on("error", (cause) => (clearTimeout(timer), reject(ioError(`Lancement impossible : ${cause.message}`))));
    child.on("exit", (code, signal) => (clearTimeout(timer), resolve({ code, signal, timedOut })));
  });

  const summary = await tailLog(logPath, { maxLines: tail_lines ?? cfg.tailLines, maxBytes: cfg.tailBytes });
  return {
    exit_code: outcome.code,
    ...(outcome.signal && { signal: outcome.signal }),
    ...(outcome.timedOut && { timed_out: true, timeout_ms: limitMs }),
    log: logPath,
    ...summary,
  };
}

/**
 * Commande longue : détachée, sans timeout, rend `{ job_id, pid, log }` aussitôt. Log, code retour
 * et méta vivent dans `<workspace>/jobs/` : l'état se relit du disque, donc survit à un redémarrage
 * du connecteur. Suivre avec `jobStatus`.
 */
export async function jobStart({ command, cwd, name }, session) {
  if (name !== undefined && !SAFE_NAME.test(name)) {
    throw badArgs("Nom de job invalide (lettres, chiffres, `.`, `_`, `-` uniquement).");
  }
  const jobsDir = path.join(session.workspace, "jobs");
  await fs.mkdir(jobsDir, { recursive: true });
  const jobId = `${name ?? "job"}-${uid()}`;
  const logPath = path.join(jobsDir, `${jobId}.log`);
  const exitPath = path.join(jobsDir, `${jobId}.exit`);

  // Sous-shell `( … )`, pas groupe `{ … }` : un `exit` de la commande ne quitte que lui, et le code
  // retour est toujours déposé — seul moyen de le récupérer d'un processus détaché.
  const script = `(\n${command}\n); echo $? > ${quote(exitPath)}`;
  const child = bashToLog(script, { cwd: cwd ?? session.workspace, logPath });
  // Un spawn qui échoue (cwd inexistant…) émet `error` après coup : sans écouteur, l'exception
  // tuerait le serveur. L'échec se dépose dans le log et le fichier exit, lisible par job_status.
  child.on("error", (cause) => {
    fs.appendFile(logPath, `[wsl-bridge] lancement impossible : ${cause.message}\n`).catch(() => {});
    fs.writeFile(exitPath, "127\n").catch(() => {});
  });
  child.unref();

  const meta = {
    job_id: jobId,
    pid: child.pid,
    command,
    cwd: cwd ?? session.workspace,
    log: logPath,
    exit_file: exitPath,
    started_at: new Date().toISOString(),
  };
  await fs.writeFile(path.join(jobsDir, `${jobId}.json`), JSON.stringify(meta, null, 2));
  return { job_id: jobId, pid: child.pid, log: logPath };
}

/**
 * État d'un job, relu du disque : `running` (processus vivant), `done` (avec `exit_code`) ou
 * `aborted` (processus disparu sans code retour). Rend aussi `started_at`, `log` et la fin du log.
 */
export async function jobStatus({ job_id, tail_lines }, session, cfg) {
  if (!SAFE_NAME.test(job_id)) throw badArgs(`Identifiant de job invalide : ${job_id}`);
  const jobsDir = path.join(session.workspace, "jobs");
  let meta;
  try {
    meta = JSON.parse(await fs.readFile(path.join(jobsDir, `${job_id}.json`), "utf8"));
  } catch {
    throw notFound(`Job inconnu : ${job_id} (aucune trace dans ${jobsDir}).`);
  }

  let status = jobStateFrom(await readIfPresent(meta.exit_file));
  if (status.state === "running" && !alive(meta.pid)) {
    status = { state: "aborted", note: "Processus disparu sans code retour (tué ou crash)." };
  }

  const summary = await tailLog(meta.log, { maxLines: tail_lines ?? cfg.tailLines, maxBytes: cfg.tailBytes });
  return { job_id, ...status, started_at: meta.started_at, log: meta.log, ...summary };
}

// Échappe un chemin pour un contexte bash entre guillemets simples.
function quote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readIfPresent(target) {
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}
