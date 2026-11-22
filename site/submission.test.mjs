import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import {
  NEW_OWNER,
  foldSubmissions,
  parseRegistry,
  parseSubmission,
  renderSubmission,
  rulesFromSchema,
  submissionPath,
  submissionUrl,
} from "./lib.js";

const root = new URL("../", import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));
const baseYml = readFileSync(path("tests/fixtures/base.yml"), "utf8");
const schema = JSON.parse(readFileSync(path("whoami.json"), "utf8"));
const rules = rulesFromSchema(schema);

const full = {
  whoami: "1413",
  name: "Fresh",
  owner: NEW_OWNER,
  newOwnerKey: "bonsai-lab",
  newOwnerAuthors: "Smith: Lab #2",
  repositoryUrl: "https://github.com/a/b",
  projectUrl: "https://x.org",
  appPackage: "Harp.Fresh.App",
  description: 'Multi-line\ndescription with "quotes" and: colons #hash',
};

test("renderSubmission round-trips through parseSubmission", () => {
  assert.deepEqual(parseSubmission(renderSubmission(full)), full);
  const minimal = { whoami: "2200", name: "Fresh", owner: "aind", description: "x" };
  assert.deepEqual(parseSubmission(renderSubmission(minimal)), {
    ...minimal, newOwnerKey: "", newOwnerAuthors: "", repositoryUrl: "", projectUrl: "", appPackage: "",
  });
});

test("renderSubmission starts with an explanatory comment and omits empty fields", () => {
  const text = renderSubmission({ whoami: "2200", name: "Fresh", owner: "", description: "x" });
  assert.match(text, /^# /);
  assert.doesNotMatch(text, /owner|repositoryUrl|app/);
});

test("parseSubmission rejects unknown keys and missing fields", () => {
  assert.throws(() => parseSubmission("whoami: 2200\nname: Fresh\ndescription: x\nemail: a@b.c\n"), /email/);
  assert.throws(() => parseSubmission("whoami: 2200\ndescription: x\n"), /name/);
  assert.throws(() => parseSubmission("- not a mapping\n"), /mapping/);
});

test("submissionPath and submissionUrl", () => {
  assert.equal(submissionPath(full), "submissions/1413.yml");
  const url = new URL(submissionUrl("me/sandbox", full));
  assert.equal(url.origin + url.pathname, "https://github.com/me/sandbox/new/main");
  assert.equal(url.searchParams.get("filename"), "submissions/1413.yml");
  assert.equal(url.searchParams.get("value"), renderSubmission(full));
});

test("foldSubmissions applies submissions in order and keeps the registry valid", () => {
  const subs = [
    { path: "submissions/1413.yml", text: renderSubmission(full) },
    { path: "submissions/2200.yml", text: renderSubmission({ whoami: "2200", name: "Other", owner: "bonsai-lab", description: "d" }) },
  ];
  const { text, errors } = foldSubmissions(baseYml, rules, subs);
  assert.deepEqual(errors, []);
  const after = parseRegistry(text);
  assert.equal(after.devices.size, 50);
  assert.equal(after.devices.get(1413).authors, "Smith: Lab #2");
  assert.equal(after.devices.get(2200).authors, "Smith: Lab #2");
  assert.deepEqual(after.devices.get(1413).app, { type: "dotnetTool", package: "Harp.Fresh.App" });
});

test("foldSubmissions reports conflicts, bad file names and parse errors per file", () => {
  const subs = [
    { path: "submissions/1040.yml", text: renderSubmission({ whoami: "1040", name: "Fresh", owner: "", description: "d" }) },
    { path: "submissions/9999.yml", text: renderSubmission({ whoami: "2300", name: "Other", owner: "", description: "d" }) },
    { path: "submissions/2400.yml", text: "whoami: [oops\n" },
    { path: "submissions/2500.yml", text: renderSubmission({ whoami: "2500", name: "NoDesc", owner: "", description: "" }) },
  ];
  const { errors } = foldSubmissions(baseYml, rules, subs);
  assert.deepEqual(errors.map((e) => e.path), [
    "submissions/1040.yml", "submissions/9999.yml", "submissions/2400.yml", "submissions/2500.yml",
  ]);
  assert.match(errors[0].message, /MultiPwm/);
  assert.match(errors[1].message, /2300\.yml/);
});

test("foldSubmissions flags two submissions claiming the same WhoAmI", () => {
  const a = renderSubmission({ whoami: "2200", name: "One", owner: "", description: "d" });
  const b = renderSubmission({ whoami: "2200", name: "Two", owner: "", description: "d" });
  const { errors } = foldSubmissions(baseYml, rules, [
    { path: "submissions/2200.yml", text: a },
    { path: "submissions/2200.yml", text: b },
  ]);
  assert.equal(errors.length, 1);
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "fold-"));
  copyFileSync(path("tests/fixtures/base.yml"), join(dir, "whoami.yml"));
  copyFileSync(path("whoami.json"), join(dir, "whoami.json"));
  mkdirSync(join(dir, "submissions"));
  return dir;
}

const script = path("scripts/fold-submissions.mjs");

test("fold script --out writes the folded registry and the CI validator accepts it", () => {
  const dir = sandbox();
  writeFileSync(join(dir, "submissions", "1413.yml"), renderSubmission(full));
  const out = join(dir, "folded.yml");
  execFileSync("node", [script, "--root", dir, "--out", out], { encoding: "utf8" });
  assert.ok(existsSync(join(dir, "submissions", "1413.yml")), "--out leaves submissions in place");
  const check = execFileSync(
    "uv",
    ["run", "-q", path("scripts/validate_whoami.py"), out, "--base", join(dir, "whoami.yml"), "--schema", join(dir, "whoami.json")],
    { encoding: "utf8" },
  );
  assert.match(check, /OK: 49 devices/);
});

test("fold script --write updates whoami.yml and removes the submissions", () => {
  const dir = sandbox();
  writeFileSync(join(dir, "submissions", "1413.yml"), renderSubmission(full));
  const stdout = execFileSync("node", [script, "--root", dir, "--write"], { encoding: "utf8" });
  assert.ok(!existsSync(join(dir, "submissions", "1413.yml")));
  assert.equal(parseRegistry(readFileSync(join(dir, "whoami.yml"), "utf8")).devices.get(1413).name, "Fresh");
  assert.match(stdout, /1413 Fresh/);
});

test("fold script fails with annotations on a bad submission and changes nothing", () => {
  const dir = sandbox();
  writeFileSync(join(dir, "submissions", "1040.yml"), renderSubmission({ whoami: "1040", name: "Fresh", owner: "", description: "d" }));
  const r = spawnSync("node", [script, "--root", dir, "--write"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /::error file=submissions\/1040\.yml::/);
  assert.ok(existsSync(join(dir, "submissions", "1040.yml")));
  assert.equal(readFileSync(join(dir, "whoami.yml"), "utf8"), baseYml);
});

test("fold script with no submissions is a no-op", () => {
  const dir = sandbox();
  const out = join(dir, "folded.yml");
  execFileSync("node", [script, "--root", dir, "--out", out], { encoding: "utf8" });
  assert.equal(readFileSync(out, "utf8"), baseYml);
});
