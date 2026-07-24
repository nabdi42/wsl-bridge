// Les erreurs du pont wsl-bridge. `kind` classe l'échec ; le protocole en dérive la forme JSON-RPC.

/**
 * Échec du pont. `kind` : "bad-args" (requête invalide) | "not-found" (session, marqueur ou job
 * introuvable) | "no-session" (pont non amorcé) | "io" (copie ou lancement en échec).
 */
export class BridgeError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = "BridgeError";
    this.kind = kind;
  }
}

export const badArgs = (message) => new BridgeError("bad-args", message);
export const notFound = (message) => new BridgeError("not-found", message);
export const noSession = (message) => new BridgeError("no-session", message);
export const ioError = (message) => new BridgeError("io", message);
