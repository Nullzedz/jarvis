import test from "node:test";
import assert from "node:assert/strict";
import { agentDoing, agentEye, agentTitle, hasSession, minutesBetween } from "../src/core/agents.ts";

const task = (o) => ({ id: "x", name: "Claude Code", state: "idle", steps: [], stepIndex: 0, isIntegration: true, ...o });

test("his eye takes the agent's state colour", () => {
  assert.equal(agentEye("working"), "#30d158");
  assert.equal(agentEye("approval"), "#ff9f0a");
  assert.equal(agentEye("question"), "#ff9f0a");
  assert.equal(agentEye("error"), "#ff453a");
  assert.equal(agentEye("finished"), "#636366");
});

test("only agents with a session get a row", () => {
  assert.ok(!hasSession(task({})), "a quiet integration: no row");
  assert.ok(hasSession(task({ state: "working" })));
  assert.ok(hasSession(task({ sessionCwd: "C:\\code\\korus" })));
  assert.ok(hasSession(task({ isIntegration: false })), "a tagged agent always");
});

test("the row is named for the project, and says what it's doing", () => {
  assert.equal(agentTitle(task({ sessionCwd: "C:\\code\\korus\\" })), "korus");
  assert.equal(agentTitle(task({ sessionCwd: "/home/me/api-server" })), "api-server");
  assert.equal(agentTitle(task({})), "Claude Code");
  assert.equal(agentDoing(task({ steps: ["reading", "editing invoice.ts"], stepIndex: 1 })), "editing invoice.ts");
  assert.equal(agentDoing(task({})), null);
  assert.equal(minutesBetween(0, 4.5 * 60_000), 4);
  assert.equal(minutesBetween(10, 0), 0);
});

test("Home's Agents widget: asking first, then working, then done; and the summary counts", async () => {
  const { rankRows, rowCounts } = await import("../src/core/agents.ts");
  const rows = [
    { id: "a", state: "finished", ask: null },
    { id: "b", state: "working", ask: null },
    { id: "c", state: "approval", ask: { requestId: "r1", command: "npm test", question: false } },
    { id: "d", state: "idle", ask: null },
    { id: "e", state: "thinking", ask: null },
  ];
  assert.deepEqual(rankRows(rows).map((r) => r.id), ["c", "b", "e", "a", "d"]);
  assert.deepEqual(rowCounts(rows), { asking: 1, working: 2, done: 2 });
  assert.deepEqual(rowCounts([]), { asking: 0, working: 0, done: 0 });
});

test("the solar system: asking on the inner ring, working in the middle, done outside", async () => {
  const { orbitRing, orbitAngle } = await import("../src/core/agents.ts");
  assert.equal(orbitRing({ state: "working", ask: { requestId: "r", command: "x", question: false } }), 0);
  assert.equal(orbitRing({ state: "error", ask: null }), 0);
  assert.equal(orbitRing({ state: "thinking", ask: null }), 1);
  assert.equal(orbitRing({ state: "finished", ask: null }), 2);
  assert.equal(orbitRing({ state: "idle", ask: null }), 2);
  const a = [0, 1, 2].map((i) => orbitAngle(i, 3, 0));
  assert.ok(Math.abs(a[1] - a[0] - (2 * Math.PI) / 3) < 1e-9, "spread evenly");
});
