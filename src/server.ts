#!/usr/bin/env node
import "dotenv/config";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Redis } from "ioredis";

import { describeCommand, isReadOnlyCommand, isWriteAllowed } from "./guard.js";

const url = process.env.REDIS_URL || "redis://localhost:6379";
const writeAllowed = isWriteAllowed(process.env.REDIS_WRITE_ALLOWED);
const extraReadOnlyCommands = process.env.REDIS_EXTRA_READONLY_COMMANDS || "";

const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });

const TOOLS = [
  {
    name: "redis_get",
    description: "GET a string key and its TTL.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "redis_scan",
    description: "Cursor-safe key scan by glob pattern using SCAN.",
    inputSchema: {
      type: "object",
      properties: {
        match: { type: "string", default: "*" },
        count: { type: "number", default: 100 },
      },
    },
  },
  {
    name: "redis_inspect",
    description: "Inspect type, TTL, size, and a small preview for a key.",
    inputSchema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
    },
  },
  {
    name: "redis_command",
    description: "Run an arbitrary Redis command restricted to the read-only allowlist unless writes are enabled.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["command"],
    },
  },
  {
    name: "redis_info",
    description: "Run Redis INFO, optionally scoped to a section.",
    inputSchema: {
      type: "object",
      properties: { section: { type: "string" } },
    },
  },
];

const server = new Server(
  { name: "mcp-redis-allowlist", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

function ok(data: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function fail(message: string) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

async function inspect(key: string) {
  const type = await redis.type(key);
  const ttl = await redis.ttl(key);

  switch (type) {
    case "string":
      return { type, ttl, value: await redis.get(key) };
    case "hash":
      return { type, ttl, fields: await redis.hlen(key), preview: await redis.hgetall(key) };
    case "list":
      return { type, ttl, length: await redis.llen(key), preview: await redis.lrange(key, 0, 19) };
    case "set":
      return { type, ttl, size: await redis.scard(key), preview: await redis.srandmember(key, 20) };
    case "zset":
      return { type, ttl, size: await redis.zcard(key), preview: await redis.zrange(key, 0, 19, "WITHSCORES") };
    case "none":
      return { type: "none", ttl, note: "key does not exist" };
    default:
      return { type, ttl };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const argsObject = (req.params.arguments ?? {}) as Record<string, unknown>;

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }

    switch (name) {
      case "redis_get": {
        const key = String(argsObject.key);
        return ok({ value: await redis.get(key), ttl: await redis.ttl(key) });
      }
      case "redis_scan": {
        const [, keys] = await redis.scan(
          "0",
          "MATCH",
          String(argsObject.match ?? "*"),
          "COUNT",
          Number(argsObject.count) || 100,
        );
        return ok({ count: keys.length, keys });
      }
      case "redis_inspect":
        return ok(await inspect(String(argsObject.key)));
      case "redis_command": {
        const command = String(argsObject.command ?? "");
        const args = Array.isArray(argsObject.args) ? argsObject.args.map(String) : [];
        const subcommand = args[0];

        if (!isReadOnlyCommand(command, subcommand, { extraReadOnlyCommands, writeAllowed })) {
          return fail(
            `command "${describeCommand(command, subcommand)}" is not on the read-only allowlist ` +
              `(set REDIS_EXTRA_READONLY_COMMANDS for safe diagnostics, or REDIS_WRITE_ALLOWED=true to override)`,
          );
        }

        return ok(await redis.call(command, ...args));
      }
      case "redis_info":
        return ok(argsObject.section ? await redis.info(String(argsObject.section)) : await redis.info());
      default:
        return fail(`unknown tool ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`error in ${name}: ${message}`);
  }
});

void server.connect(new StdioServerTransport());
