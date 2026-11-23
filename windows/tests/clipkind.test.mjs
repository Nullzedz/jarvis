// The island's Clipboard tab: what each copy is (src/views/pocket.ts clipKind).
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith(".css")) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "", shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { clipKind } = await import("../src/views/pocket.ts");
const kind = (text) => clipKind({ kind: "text", text });

test("links, emails, code and plain text are told apart", () => {
  assert.equal(kind("https://github.com/Nullzedz/jarvis/pull/17"), "link");
  assert.equal(kind("github.com/Nullzedz/jarvis/pull/17"), "link");
  assert.equal(kind("www.example.com"), "link");
  assert.equal(kind("hello@example.com"), "email");
  assert.equal(kind("const TVA = 0.2;"), "code");
  assert.equal(kind("npm run tauri dev"), "code");
  assert.equal(kind("fn main() {\n    println!(\"hi\");\n}"), "code");
  assert.equal(kind("Design review moved to 21:00"), "text");
  assert.equal(kind("Call Maya about the invoice, then send it."), "text");
});

test("an image is an image", () => {
  assert.equal(clipKind({ kind: "image", text: "1280 × 720" }), "image");
});
