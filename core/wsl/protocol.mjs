// Le protocole MCP à la main : JSON-RPC 2.0, un message par ligne sur stdin/stdout.
// Cette couche ne connaît que le routage : elle parse, dispatche vers le registre, et met en forme.

import { BridgeError } from "./errors.mjs";

// Version du protocole servie par défaut, quand le client n'en propose pas.
const PROTOCOL_VERSION = "2024-11-05";

// Codes JSON-RPC standard.
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/**
 * Traite un message JSON-RPC et rend la réponse à écrire, ou `null` pour une notification (sans `id`).
 * Une erreur de méthode/paramètre devient une erreur JSON-RPC ; une erreur d'exécution d'outil devient
 * un résultat `isError` (convention MCP : l'échec métier se rend au modèle, pas au transport).
 */
export async function dispatch(message, context) {
  const { id } = message;
  const isNotification = id === undefined;
  try {
    const result = await route(message, context);
    return isNotification ? null : { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, error: { code: codeFor(error), message: error.message } };
  }
}

async function route({ method, params = {} }, { registry, serverInfo }) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo,
      };
    case "notifications/initialized":
      return {};
    case "ping":
      return {};
    case "tools/list":
      return { tools: registry.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case "tools/call":
      return callTool(registry, params);
    default:
      throw methodNotFound(method);
  }
}

async function callTool(registry, { name, arguments: args = {} }) {
  const tool = registry.find((entry) => entry.name === name);
  if (!tool) throw invalidParams(`Outil inconnu : ${name}`);
  try {
    const result = await tool.handler(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    // L'échec d'un outil est une matière que le modèle doit voir, pas une panne du transport.
    return { content: [{ type: "text", text: `Erreur ${errorKind(error)} : ${error.message}` }], isError: true };
  }
}

function codeFor(error) {
  if (error.code === METHOD_NOT_FOUND) return METHOD_NOT_FOUND;
  if (error instanceof BridgeError && error.kind === "bad-args") return INVALID_PARAMS;
  if (error.code === INVALID_PARAMS) return INVALID_PARAMS;
  return INTERNAL_ERROR;
}

function errorKind(error) {
  return error instanceof BridgeError ? error.kind : "interne";
}

function methodNotFound(method) {
  return Object.assign(new Error(`Méthode inconnue : ${method}`), { code: METHOD_NOT_FOUND });
}

function invalidParams(message) {
  return Object.assign(new Error(message), { code: INVALID_PARAMS });
}
