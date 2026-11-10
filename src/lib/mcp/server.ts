/**
 * Minimal, stateless MCP server (Streamable HTTP, JSON responses only).
 *
 * Every POST carries one JSON-RPC message; we answer with one JSON response
 * (or 202 for notifications). No sessions, no SSE stream — each tool call is
 * a self-contained request, which suits serverless hosting.
 */

import { GitHubError } from '../github';
import { SERVER_INSTRUCTIONS, TOOLS, ToolContext, ToolInputError } from './tools';

export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type Id = string | number | null;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: Id;
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: Id; result: unknown }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string; data?: unknown } };

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function err(id: Id, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Returns null for notifications (no response body). */
export async function handleMessage(msg: unknown, ctx: () => Promise<ToolContext>, version: string): Promise<JsonRpcResponse | null> {
  if (Array.isArray(msg)) return err(null, INVALID_REQUEST, 'Batch requests are not supported.');
  const req = msg as JsonRpcRequest;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return err(null, INVALID_REQUEST, 'Not a JSON-RPC 2.0 request.');
  }
  const isNotification = req.id === undefined;
  if (isNotification) return null;
  const id = req.id ?? null;

  switch (req.method) {
    case 'initialize': {
      const asked = String(req.params?.protocolVersion ?? '');
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : version,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'dependash', title: 'dependash', version: '1.0.0' },
          instructions: SERVER_INSTRUCTIONS,
        },
      };
    }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
          })),
        },
      };
    case 'tools/call': {
      const name = req.params?.name;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return err(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const out = await tool.run(args, await ctx());
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] } };
      } catch (e) {
        // Tool failures go back to the model as results it can react to.
        const message =
          e instanceof ToolInputError
            ? `Invalid arguments: ${e.message}`
            : e instanceof GitHubError
              ? `GitHub API ${e.status} on ${e.url}: ${e.message}`
              : `Error: ${(e as Error).message}`;
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } };
      }
    }
    default:
      return err(id, METHOD_NOT_FOUND, `Method not found: ${req.method}`);
  }
}

export function parseBody(text: string): { ok: true; msg: unknown } | { ok: false; response: JsonRpcResponse } {
  try {
    return { ok: true, msg: JSON.parse(text) };
  } catch {
    return { ok: false, response: err(null, PARSE_ERROR, 'Invalid JSON.') };
  }
}
