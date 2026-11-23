import test from "node:test";
import assert from "node:assert/strict";
import { fileKind, hourStacks, isVip, senders, todaysFiles } from "../src/hub/pages/mail-home.ts";

const msg = (o) => ({ entryId: "e", storeId: "s", account: "me", senderName: "", address: "", subject: "", date: 0, unread: false, flagged: false, local: "", files: [], hour: 9, vip: false, ...o });

test("a part of the day shows its senders, VIPs first, then most mail", () => {
  const list = [
    msg({ senderName: "Maya", address: "maya@team.com" }),
    msg({ senderName: "Maya", address: "MAYA@team.com" }),
    msg({ senderName: "Stripe", address: "receipts@stripe.com" }),
    msg({ senderName: "Ethan", address: "ethan@client.com", vip: true }),
  ];
  assert.deepEqual(senders(list).map((s) => [s.name, s.n, s.vip]), [["Ethan", 1, true], ["Maya", 2, false], ["Stripe", 1, false]]);
});

test("today's hours split VIP, waiting on you and the rest", () => {
  const s = hourStacks([msg({ hour: 9, vip: true }), msg({ hour: 9, flagged: true }), msg({ hour: 9 }), msg({ hour: 15 })]);
  assert.equal(s.length, 24);
  assert.deepEqual(s[9], [1, 1, 1]);
  assert.deepEqual(s[15], [0, 0, 1]);
});

test("a file's badge and filter come from its extension", () => {
  assert.deepEqual(fileKind("contract.PDF").slice(0, 2), ["PDF", "PDF"]);
  assert.deepEqual(fileKind("mockup.png").slice(0, 2), ["IMG", "Images"]);
  assert.deepEqual(fileKind("budget.xlsx").slice(0, 2), ["XLS", "Sheets"]);
  assert.deepEqual(fileKind("notes.docx").slice(0, 2), ["DOC", "Other"]);
  assert.deepEqual(fileKind("readme").slice(0, 2), ["REA", "Other"]);
});

test("every attachment of today's mail is a tile", () => {
  const files = todaysFiles([msg({ files: ["a.pdf", "b.png"] }), msg({ files: [] }), msg({ files: ["c.zip"] })]);
  assert.deepEqual(files.map((f) => f.name), ["a.pdf", "b.png", "c.zip"]);
});

test("a VIP is a whole address or a domain, like the sorting's", () => {
  assert.ok(isVip("Paul@Client.com", ["paul@client.com"]));
  assert.ok(isVip("ann@client.com", ["@client.com"]));
  assert.ok(isVip("ann@mail.client.com", ["client.com"]));
  assert.ok(!isVip("ann@notclient.com", ["client.com"]));
  assert.ok(!isVip("ann@client.com", ["paul@client.com"]));
});
