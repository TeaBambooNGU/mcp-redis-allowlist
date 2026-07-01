import assert from "node:assert/strict";
import test from "node:test";

import { isReadOnlyCommand, parseCommandSpecs } from "./guard.js";

test("allows built-in read commands", () => {
  for (const command of ["get", "mget", "hgetall", "lrange", "smembers", "zrange", "scan", "info", "ttl", "xrange", "pfcount"]) {
    assert.equal(isReadOnlyCommand(command), true);
  }
});

test("blocks mutating commands", () => {
  for (const command of ["set", "del", "expire", "flushall", "flushdb", "hset", "lpush", "sadd", "zadd", "rename", "setex", "getset", "eval", "shutdown"]) {
    assert.equal(isReadOnlyCommand(command), false);
  }
});

test("is case-insensitive", () => {
  assert.equal(isReadOnlyCommand("GET"), true);
  assert.equal(isReadOnlyCommand("FlushAll"), false);
});

test("blocks unsafe subcommands on built-in command families", () => {
  assert.equal(isReadOnlyCommand("config", "get"), true);
  assert.equal(isReadOnlyCommand("config", "set"), false);
  assert.equal(isReadOnlyCommand("config", "resetstat"), false);
});

test("rejects diagnostic command families by default", () => {
  assert.equal(isReadOnlyCommand("client", "list"), false);
  assert.equal(isReadOnlyCommand("slowlog", "get"), false);
  assert.equal(isReadOnlyCommand("latency", "latest"), false);
});

test("allows configured diagnostic subcommands", () => {
  const extraReadOnlyCommands = "client:list,slowlog:get,latency:latest";
  assert.equal(isReadOnlyCommand("CLIENT", "LIST", { extraReadOnlyCommands }), true);
  assert.equal(isReadOnlyCommand("SLOWLOG", "GET", { extraReadOnlyCommands }), true);
  assert.equal(isReadOnlyCommand("LATENCY", "LATEST", { extraReadOnlyCommands }), true);
});

test("supports Redis ACL style command|subcommand notation", () => {
  const extraReadOnlyCommands = "client|list slowlog|get latency|latest";
  assert.equal(isReadOnlyCommand("client", "list", { extraReadOnlyCommands }), true);
  assert.equal(isReadOnlyCommand("slowlog", "get", { extraReadOnlyCommands }), true);
  assert.equal(isReadOnlyCommand("latency", "latest", { extraReadOnlyCommands }), true);
});

test("does not let extra allowlist override known dangerous subcommands", () => {
  const extraReadOnlyCommands = "client:kill,client:pause,slowlog:reset,latency:reset";
  assert.equal(isReadOnlyCommand("client", "kill", { extraReadOnlyCommands }), false);
  assert.equal(isReadOnlyCommand("client", "pause", { extraReadOnlyCommands }), false);
  assert.equal(isReadOnlyCommand("slowlog", "reset", { extraReadOnlyCommands }), false);
  assert.equal(isReadOnlyCommand("latency", "reset", { extraReadOnlyCommands }), false);
});

test("writeAllowed explicitly bypasses the guard", () => {
  assert.equal(isReadOnlyCommand("set", undefined, { writeAllowed: true }), true);
  assert.equal(isReadOnlyCommand("client", "kill", { writeAllowed: true }), true);
});

test("parses command specs", () => {
  assert.deepEqual(parseCommandSpecs("client:list slowlog|get, latency:latest"), [
    { command: "client", subcommand: "list" },
    { command: "slowlog", subcommand: "get" },
    { command: "latency", subcommand: "latest" },
  ]);
});
