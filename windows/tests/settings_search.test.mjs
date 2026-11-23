import test from "node:test";
import assert from "node:assert/strict";
import { normalize, words, match, searchSettings, SETTINGS_ENTRIES } from "../src/hub/search.ts";

test("SettingsSearch - words normalization and splitting", () => {
  assert.deepEqual(words("  Réglage   SON "), ["reglage", "son"]);
  assert.deepEqual(words("   "), []);
  assert.deepEqual(words("général"), ["general"]);
  assert.deepEqual(words("Türkçe Ayarlar"), ["turkce", "ayarlar"]);
  assert.deepEqual(words("Häufige Fragen"), ["haufige", "fragen"]);
});

test("SettingsSearch - match against box, title, and labels (Mac contract parity)", () => {
  const sound = {
    title: "Son",
    page: "Général",
    labels: ["Activer les sons", "Volume", "Ouvrir le dossier des sons"],
  };

  const m = (q) => match(words(q), sound.title, sound.page, sound.labels);

  // The box by its title or its page, whatever the accents and the case.
  assert.deepEqual(m("son"), { kind: "box" });
  assert.deepEqual(m("GENERAL"), { kind: "box" });
  assert.deepEqual(m("général son"), { kind: "box" });

  // A setting inside it.
  assert.deepEqual(m("volu"), { kind: "label", label: "Volume" });
  assert.deepEqual(m("dossier"), { kind: "label", label: "Ouvrir le dossier des sons" });

  // Every word somewhere; the label with most of them.
  assert.deepEqual(m("ouvrir dossier son"), { kind: "label", label: "Ouvrir le dossier des sons" });
  assert.deepEqual(m("volume general"), { kind: "label", label: "Volume" });

  // Not there.
  assert.equal(m("micro"), null);
  assert.equal(m("volume micro"), null, "every word must be found");
  assert.equal(m(""), null);
});

test("SettingsSearch - finds settings and pages by today's names (#84)", () => {
  const titles = { prefs: "Settings", mail: "Mail", mailOverview: "Sorting", integrations: "Connections", notes: "Notetaker", dictation: "Dictation" };
  const getPageTitle = (p) => titles[p] ?? p;
  const ids = (q) => searchSettings(q, getPageTitle).map((h) => h.entry.id);

  // The names the window shows, and words people search for.
  assert.ok(ids("auto-close").includes("s.autoclose"));
  assert.ok(ids("version").includes("s.version"));
  assert.ok(ids("microphone").includes("s.voice"));
  assert.ok(ids("api key").includes("s.apikey"));
  assert.ok(ids("volume").includes("s.volume"));
  assert.ok(ids("hands-free").includes("s.dictation"));
  assert.ok(ids("github").includes("c.all"));
  assert.ok(ids("banned").includes("m.sort"));
  assert.ok(ids("snippets").includes("n.dictation"));

  // Settings results say which group they live in and where to land.
  for (const e of SETTINGS_ENTRIES.filter((x) => x.page === "prefs")) {
    assert.ok(e.where && e.group?.startsWith("group-"), `${e.id} has no group`);
  }

  assert.deepEqual(searchSettings("", getPageTitle), []);
  assert.deepEqual(searchSettings("   ", getPageTitle), []);
  assert.deepEqual(searchSettings("nonexistentgibberishqueryxyz", getPageTitle), []);
});

test("SettingsSearch - no result shows a code name like hub.mail.autosort (#84)", () => {
  const dotted = /^[a-z][\w-]*(\.[\w-]+)+$/;
  for (const e of SETTINGS_ENTRIES) {
    for (const text of [e.title, ...e.terms, e.where ?? ""]) assert.ok(!dotted.test(text), `${e.id}: "${text}"`);
  }
});

test("SettingsSearch - SETTINGS_ENTRIES integrity and completeness", () => {
  assert.ok(SETTINGS_ENTRIES.length >= 30, "must include complete set of hub settings");
  const ids = new Set();
  for (const entry of SETTINGS_ENTRIES) {
    assert.ok(entry.id, "every entry must have an id");
    assert.ok(!ids.has(entry.id), `duplicate entry id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.page, `entry ${entry.id} must define a page`);
    assert.ok(entry.title, `entry ${entry.id} must define a title`);
    assert.ok(Array.isArray(entry.terms), `entry ${entry.id} must define terms array`);
  }
});
