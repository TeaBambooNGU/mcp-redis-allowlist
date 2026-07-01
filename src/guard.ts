export type CommandSpec = {
  command: string;
  subcommand?: string;
};

export type ReadOnlyGuardOptions = {
  extraReadOnlyCommands?: string | string[];
  writeAllowed?: boolean;
};

const READ_ONLY = new Set([
  "get",
  "mget",
  "strlen",
  "getrange",
  "substr",
  "exists",
  "type",
  "ttl",
  "pttl",
  "keys",
  "scan",
  "randomkey",
  "dbsize",
  "dump",
  "object",
  "memory",
  "hget",
  "hmget",
  "hgetall",
  "hkeys",
  "hvals",
  "hlen",
  "hexists",
  "hstrlen",
  "hscan",
  "lrange",
  "llen",
  "lindex",
  "lpos",
  "smembers",
  "sismember",
  "smismember",
  "scard",
  "srandmember",
  "sscan",
  "sinter",
  "sunion",
  "sdiff",
  "zrange",
  "zrangebyscore",
  "zrangebylex",
  "zrevrange",
  "zcard",
  "zscore",
  "zmscore",
  "zrank",
  "zrevrank",
  "zcount",
  "zscan",
  "xrange",
  "xrevrange",
  "xlen",
  "xinfo",
  "xread",
  "bitcount",
  "bitpos",
  "getbit",
  "pfcount",
  "geopos",
  "geodist",
  "geohash",
  "geosearch",
  "ping",
  "info",
  "time",
  "lolwut",
  "command",
  "config",
]);

const BLOCKED_SUBCOMMANDS = new Set([
  "config:set",
  "config:resetstat",
  "config:rewrite",
  "client:caching",
  "client:kill",
  "client:no-evict",
  "client:no-touch",
  "client:pause",
  "client:reply",
  "client:setinfo",
  "client:setname",
  "client:tracking",
  "client:unblock",
  "client:unpause",
  "latency:reset",
  "slowlog:reset",
]);

const SUBCOMMAND_FAMILIES = new Set([
  "acl",
  "client",
  "cluster",
  "command",
  "config",
  "function",
  "latency",
  "memory",
  "module",
  "object",
  "pubsub",
  "script",
  "sentinel",
  "slowlog",
  "xinfo",
]);

const COMMAND_TOKEN = /^[a-z][a-z0-9_.-]*$/;

function normalizeToken(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizeCommandSpec(spec: CommandSpec): CommandSpec {
  return {
    command: normalizeToken(spec.command),
    subcommand: spec.subcommand ? normalizeToken(spec.subcommand) : undefined,
  };
}

function parseOneSpec(raw: string): CommandSpec | undefined {
  const spec = raw.trim().toLowerCase();
  if (!spec) return undefined;

  const delimiter = spec.includes(":") ? ":" : spec.includes("|") ? "|" : "";
  const parts = delimiter ? spec.split(delimiter) : [spec];
  if (parts.length > 2) {
    throw new Error(`invalid command allowlist spec "${raw}"`);
  }

  const [command, subcommand] = parts.map((part) => part.trim());
  if (!COMMAND_TOKEN.test(command)) {
    throw new Error(`invalid Redis command in allowlist spec "${raw}"`);
  }
  if (subcommand !== undefined && !COMMAND_TOKEN.test(subcommand)) {
    throw new Error(`invalid Redis subcommand in allowlist spec "${raw}"`);
  }

  return { command, subcommand };
}

export function parseCommandSpecs(input: string | string[] | undefined): CommandSpec[] {
  const values = Array.isArray(input) ? input : [input || ""];
  const specs: CommandSpec[] = [];

  for (const value of values) {
    for (const raw of value.split(/[\s,]+/)) {
      const parsed = parseOneSpec(raw);
      if (parsed) specs.push(parsed);
    }
  }

  return specs;
}

function toLookup(specs: CommandSpec[]): { commands: Set<string>; subcommands: Set<string> } {
  const commands = new Set<string>();
  const subcommands = new Set<string>();

  for (const spec of specs.map(normalizeCommandSpec)) {
    if (!spec.command) continue;
    if (spec.subcommand) {
      subcommands.add(`${spec.command}:${spec.subcommand}`);
    } else {
      commands.add(spec.command);
    }
  }

  return { commands, subcommands };
}

export function isWriteAllowed(value: string | undefined): boolean {
  return ["1", "true", "yes"].includes((value || "").toLowerCase());
}

export function isReadOnlyCommand(
  command: string,
  subcommand?: string,
  options: ReadOnlyGuardOptions = {},
): boolean {
  if (options.writeAllowed) return true;

  const cmd = normalizeToken(command);
  const sub = subcommand ? normalizeToken(subcommand) : undefined;
  if (!cmd) return false;

  const subcommandKey = sub ? `${cmd}:${sub}` : undefined;
  if (subcommandKey && BLOCKED_SUBCOMMANDS.has(subcommandKey)) {
    return false;
  }

  if (READ_ONLY.has(cmd)) {
    return true;
  }

  const extra = toLookup(parseCommandSpecs(options.extraReadOnlyCommands));
  if (subcommandKey && extra.subcommands.has(subcommandKey)) {
    return true;
  }

  return !sub && extra.commands.has(cmd);
}

export function describeCommand(command: string, subcommand?: string): string {
  const cmd = normalizeToken(command);
  const sub = normalizeToken(subcommand);
  return sub && SUBCOMMAND_FAMILIES.has(cmd) ? `${cmd} ${sub}` : cmd;
}
