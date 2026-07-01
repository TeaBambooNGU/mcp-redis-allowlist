# mcp-redis-allowlist

Read-only Redis MCP server with a configurable command allowlist.

This project is a fixed local variant for production diagnostics. It keeps the small tool surface from `@infoinlet/mcp-redis` and adds an environment-driven allowlist for exact read-only diagnostic subcommands such as `CLIENT LIST`, `SLOWLOG GET`, and `LATENCY LATEST`.

## Tools

- `redis_get`: get a string key and TTL.
- `redis_scan`: scan keys with `SCAN`.
- `redis_inspect`: inspect type, TTL, size, and preview for string/hash/list/set/zset keys.
- `redis_command`: run a Redis command if it passes the read-only guard.
- `redis_info`: run `INFO`, optionally with a section.

## Security Model

By default, writes are blocked at the MCP layer.

- `REDIS_WRITE_ALLOWED=false` keeps the read-only guard enabled.
- `REDIS_EXTRA_READONLY_COMMANDS` appends exact read-only command specs.
- `REDIS_WRITE_ALLOWED=true` bypasses the guard and should not be used for production diagnostics.

Extra command specs are comma or whitespace separated:

```sh
REDIS_EXTRA_READONLY_COMMANDS=client:list,slowlog:get,latency:latest
```

Redis ACL style syntax is also accepted:

```sh
REDIS_EXTRA_READONLY_COMMANDS='client|list slowlog|get latency|latest'
```

Known dangerous subcommands remain blocked unless `REDIS_WRITE_ALLOWED=true`, including:

- `CLIENT KILL`
- `CLIENT PAUSE`
- `CLIENT UNPAUSE`
- `CLIENT UNBLOCK`
- `CLIENT SETNAME`
- `SLOWLOG RESET`
- `LATENCY RESET`
- `CONFIG SET`
- `CONFIG RESETSTAT`
- `CONFIG REWRITE`

Use a Redis read-only or diagnostic ACL user as an additional safety boundary whenever possible.

## Install

```sh
npm install
npm run build
```

## Run

```sh
REDIS_URL='redis://localhost:6379' \
REDIS_WRITE_ALLOWED=false \
REDIS_EXTRA_READONLY_COMMANDS='client:list,slowlog:get,latency:latest' \
node dist/server.js
```

## Codex MCP Config

```toml
[mcp_servers.redis_yesorno_prod]
command = "/Users/jason/.local/nodejs/current/bin/node"
args = ["/Users/jason/workspace/mcp-redis-allowlist/dist/server.js"]
startup_timeout_sec = 30.0

[mcp_servers.redis_yesorno_prod.env]
REDIS_URL = "redis://USER:PASSWORD@HOST:PORT/DB"
REDIS_WRITE_ALLOWED = "false"
REDIS_EXTRA_READONLY_COMMANDS = "client:list,slowlog:get,latency:latest"
PATH = "/Users/jason/.local/nodejs/current/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
```

Do not commit real Redis URLs, passwords, or production hostnames.

## Diagnostic Examples

Use `redis_command` with exact subcommands:

```json
{ "command": "CLIENT", "args": ["LIST"] }
```

```json
{ "command": "SLOWLOG", "args": ["GET", "128"] }
```

```json
{ "command": "LATENCY", "args": ["LATEST"] }
```

## Development

```sh
npm install
npm run build
npm test
```

The tests verify that the diagnostic commands above can be allowlisted while dangerous related subcommands remain blocked.

## Attribution

This server is inspired by the read-only guard and tool shape from `@infoinlet/mcp-redis`, which is MIT licensed.
