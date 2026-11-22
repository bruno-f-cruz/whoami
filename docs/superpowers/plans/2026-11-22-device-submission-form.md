# Device Submission Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static device-submission form, hosted on GitHub Pages, that validates a contributor's `WhoAmI` request against the registry's real rules. It then generates the exact `whoami.yml` change and walks the contributor through GitHub's fork → commit → PR flow, so the PR is authored by their own account. A GitHub Actions check validates every PR, including hand-edited ones.

**Architecture:** The site is plain HTML and ES modules under `site/`, with no build step and no backend. At load time the form fetches `whoami.yml` and `whoami.json` from `raw.githubusercontent.com`. That gives it live uniqueness checks, and the regexes come from the schema, so the rules have a single source. GitHub can't prefill an edit to an existing file from a URL, so the form copies a generated YAML block to the clipboard and opens GitHub's web editor on `whoami.yml`. For non-collaborators GitHub forks automatically. The contributor pastes the block at the end of the file and clicks "Propose changes". A Python validator run by Actions enforces the same rules on each PR.

**Tech Stack:** Vanilla JS (ES2020 modules), vendored `js-yaml@4.1.0`, Node ≥ 20 `node --test` for JS unit tests, Python 3.12 + `uv` inline-script deps (`pyyaml==6.0.2`, `jsonschema==4.23.0`, `pytest`) for the CI validator, GitHub Pages deployed via `actions/deploy-pages@v4`.

**Spec (the original ask, verbatim intent):**
> Build a device submission form for harp-tech/whoami. Host it as a static website, ideally on GitHub Pages. Collect fields such as device name and whoami, validate them against the repository's actual format and rules, and generate the required registry change. After submission, guide the contributor through GitHub's fork/commit/PR flow so the PR is authored by their GitHub account. Minimize GitHub steps and prefill where possible. Host everything on GitHub (no AWS or other backend). Check whether GitHub's file editor reliably accepts prefilled content from a URL (possibly undocumented). Add PR validation in GitHub Actions so changes are checked even if someone edits the generated content. Inspect the repo before choosing fields, format, or rules.

**Decision already made with the user:** keep `whoami.yml` as the single registry file. Do **not** migrate to per-device files.

## Repository facts (inspected 2026-11-22, `main` @ `3e2d036`)

- `whoami.yml`: YAML 1.1 (`%YAML 1.1` header), top-level `devices:` map keyed by integer WhoAmI with 2-space indented keys and 4-space indented fields. It uses an anchor plus merge key: entry `123` defines `&harptechdevice` and others use `<<: *harptechdevice`. **Any parser must support merge keys.** It has 45 entries, range 123–2110. **The keys are not sorted** (`1200` follows `1264`, and the `1400`–`1410` block follows `2110`). The de facto convention is to **append new entries at the end of the file**.
- Field order in existing entries: `name, authors, copyright, repositoryUrl, projectUrl`.
- `whoami.json` (draft-07): `name` is required and matches `^[a-zA-Z][a-zA-Z0-9_]*$`. `authors`, `copyright`, `projectUrl` and `repositoryUrl` are optional strings. **Bug:** the WhoAmI key pattern is `^[1-9][0-9][0-9]|[1-9][0-9][0-9][0-9]$`, an ungrouped alternation that matches more than intended, and nothing forbids extra properties.
- `.github/workflows/gen-whoami-table.yml` regenerates `whoami.md` and auto-commits on `main`. Leave it untouched.
- `README.md` says to submit a PR editing `whoami.yml`, with a device description plus source/project website in the PR body.
- The protocol spec (`harp-tech/protocol/Device.md`, R_WHO_AM_I) defines the register as U16, and `0` means "no allocated identity".
- No existing name collides case-insensitively.

## GitHub prefill findings (Task 1 must verify these)

- `https://github.com/<o>/<r>/new/<branch>?filename=<path>&value=<urlencoded>` prefills a **new** file. `filename` is documented in GitHub's blog. `value` is **undocumented**, though Gitea copies it "for GitHub compatibility". It is not used in this design.
- `/edit/<branch>/<path>` has **no** content-prefill parameter. That is why the design uses the clipboard.
- PR query params `quick_pull=1&title=&body=` on `/compare/` are documented, but they need the fork's branch name, which the form can't know. So the PR description comes from a PR template plus a "Copy PR description" button.

## Global Constraints

- No backend, no secrets, no build step. `site/` is served as-is.
- The only third-party code is `js-yaml` 4.1.0. Vendor its ESM build (`dist/js-yaml.mjs` from the npm tarball) at `site/vendor/js-yaml.mjs`, so the browser and the `node --test` tests run identical code.
- Registry URLs used by the site: `https://raw.githubusercontent.com/harp-tech/whoami/main/whoami.yml`, `.../main/whoami.json`, and editor `https://github.com/harp-tech/whoami/edit/main/whoami.yml`.
- Validation rules: the WhoAmI pattern **`^[1-9][0-9]{2,3}$`** (100–9999, the schema's intent; fixed in Task 2) and the name pattern `^[a-zA-Z][a-zA-Z0-9_]*$`. The WhoAmI must be unused. The name must be unique case-insensitively. URLs, when present, must be `https://`. Allowed device keys: exactly `name, authors, copyright, repositoryUrl, projectUrl`.
- The site reads both patterns from the fetched `whoami.json` at runtime. JS must not hard-code them, except as an offline fallback that must equal the values above.
- Generated YAML: two-space key indent, four-space field indent, fields in the canonical order, omitted fields left out, a trailing newline, and string values quoted with JSON double-quote syntax whenever they aren't plain-safe.
- **Open question for maintainers (record it in the PR, don't block on it):** the U16 register allows up to 65535, while the schema restricts to 3–4 digits. Keep 100–9999.

## Review Focus

1. **Duplicate key pasted twice, or an ID claimed by another merged PR.** PyYAML silently keeps the last duplicate. The validator must fail on duplicate mapping keys (Task 2 test `test_duplicate_key_fails`).
2. **Block pasted with wrong indentation or tabs, or into the middle of another entry.** CI must fail with a message that names the line (Task 2 test `test_bad_indentation_reports_line`). The UI tells the user to paste at the very end of the file (Task 4).
3. **Values containing `:`, `#`, quotes or non-ASCII** (for example `authors: Smith: Lab #2`). The generated block must round-trip through `js-yaml` to the same values (Task 3 test `renders special characters safely`).
4. **Registry fetch fails** (offline, raw CDN rate limit). The form must still validate format with the fallback patterns and generate the block. It shows a warning that uniqueness wasn't checked (Task 4 manual check, and Task 3 test `validateEntry without registry skips uniqueness`).
5. **A PR edits or deletes an existing entry** (accidentally while pasting). CI fails and lists the changed WhoAmIs. Maintainers can still merge deliberate edits, because the check isn't marked required (Task 2 test `test_modified_existing_entry_fails`).

---

### Task 1: Spike — verify GitHub editor flows and record findings

**Files:**
- Create: `docs/submission-flow.md`

**Interfaces:**
- Produces: confirmed step list and URLs used verbatim by Task 4's guidance copy.

- [ ] **Step 1:** From a GitHub account **without** write access to `harp-tech/whoami` (or a test repo you don't own), open `https://github.com/harp-tech/whoami/edit/main/whoami.yml`. Record whether GitHub offers "Fork this repository", what the commit dialog looks like ("Propose changes", default branch name `patch-N`), and where it lands afterwards (the compare / open-PR page).
- [ ] **Step 2:** On a scratch repo you own, test `/new/main?filename=test.yml&value=<urlencoded 300-line yml>`. Record whether the content appears and the approximate URL length limit. This is for the record only. Then test whether `/edit/main/x?value=` is ignored.
- [ ] **Step 3:** Confirm that `.github/pull_request_template.md` content appears in the PR body when the PR is opened from the editor flow.
- [ ] **Step 4:** Write `docs/submission-flow.md` covering the findings, the dates tested, and screenshots or notes. If Step 1 contradicts this plan (for example, there's no automatic fork), stop and report before Task 4.
- [ ] **Step 5:** Commit: `git commit -m "docs: record GitHub editor prefill findings"`

### Task 2: CI validator and schema fix

**Files:**
- Modify: `whoami.json`. Device-key pattern → `^[1-9][0-9]{2,3}$`; add `"additionalProperties": false` on the `devices` map and on `definitions/device`; add `"format": "uri"` plus `"pattern": "^https://"` on both URL fields; add `"required": ["devices"]` at the root.
- Create: `scripts/validate_whoami.py` (uv inline script: `pyyaml==6.0.2`, `jsonschema==4.23.0`)
- Create: `tests/test_validate_whoami.py`, `tests/fixtures/*.yml`
- Create: `.github/workflows/validate-whoami.yml`
- Create: `.github/pull_request_template.md`. It has a checklist, "Device description:", "Repository URL:", "Project URL:", and "Submitted via form: yes/no".

**Interfaces:**
- Produces, in `scripts/validate_whoami.py`:
  - `load_registry(text: str) -> dict[int, dict]`: parses with a `yaml.SafeLoader` subclass whose `construct_mapping` raises `DuplicateKeyError(key, line)` on a repeated key. Merge keys must still resolve.
  - `validate(registry: dict[int, dict], schema: dict) -> list[str]`: jsonschema errors (keys converted to `str` before validation) plus case-insensitive duplicate-name errors. Each message starts with `WhoAmI <id>:`.
  - `diff_existing(base: dict[int, dict], head: dict[int, dict]) -> list[str]`: one error per WhoAmI that is present in base and changed or removed in head.
  - CLI: `validate_whoami.py <head.yml> [--base <base.yml>] [--schema whoami.json]`. Errors go to stdout as `::error file=whoami.yml,line=N::msg` (GitHub annotation) when a line is known. Exit code is 1 if there are any errors.

- [ ] **Step 1: Write failing tests** in `tests/test_validate_whoami.py`:
  - `test_current_registry_is_valid`: `validate(load_registry(open('whoami.yml').read()), schema) == []`. Note that the fixed schema must still accept today's file.
  - `test_merge_key_resolves`: entry `1040` has `authors == "harp-tech"`.
  - `test_duplicate_key_fails`: a fixture where `1410:` appears twice raises `DuplicateKeyError`, and the CLI exits 1 with `1410` in the output.
  - `test_bad_indentation_reports_line`: a fixture with the appended block indented by 1 space or a tab. The CLI exits 1 and the output contains `line=`.
  - `test_invalid_whoami_range`: keys `99`, `10000` and `0123` each give an error. Key `100` gives none.
  - `test_invalid_name`: `9Device` and `my-device` give errors.
  - `test_duplicate_name_case_insensitive`: adding `{name: "hobgoblin"}` under `1500` gives an error that mentions `Hobgoblin`.
  - `test_unknown_field_fails`: an `email:` field gives an error.
  - `test_http_url_fails`: `repositoryUrl: http://x` gives an error.
  - `test_modified_existing_entry_fails`: `diff_existing` with base = current and head = current with `1410.name` changed returns one error naming `1410`. Appending a new entry returns `[]`.
- [ ] **Step 2:** Run `uv run --with pytest --with pyyaml==6.0.2 --with jsonschema==4.23.0 pytest tests -v`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `scripts/validate_whoami.py` and the `whoami.json` changes per the Interfaces.
- [ ] **Step 4:** Rerun Step 2. Expected: all pass.
- [ ] **Step 5:** Create `.github/workflows/validate-whoami.yml`:
  - Triggers: `pull_request` on paths `whoami.yml`, `whoami.json`, `scripts/**`, `tests/**`.
  - Permissions: `contents: read`.
  - Steps: checkout with `fetch-depth: 0`, `astral-sh/setup-uv@v6`, then `git show origin/${{ github.base_ref }}:whoami.yml > /tmp/base.yml`, then `uv run scripts/validate_whoami.py whoami.yml --base /tmp/base.yml --schema whoami.json`, then the pytest command from Step 2.
  - Never use `pull_request_target`, because the job runs fork code with no secrets.
- [ ] **Step 6:** Commit: `git commit -m "ci: validate whoami.yml on pull requests; fix schema key pattern"`

### Task 3: Shared JS logic (pure, tested with `node --test`)

**Files:**
- Create: `site/lib.js` (ES module with no DOM access)
- Create: `site/lib.test.mjs`
- Create: `package.json`, containing only `{"private": true, "type": "module", "scripts": {"test": "node --test site/"}}`. No dependencies.
- Create: `site/vendor/js-yaml.mjs` (see Global Constraints)

**Interfaces:**
- Produces:
  - `FIELD_ORDER = ["name","authors","copyright","repositoryUrl","projectUrl"]`
  - `FALLBACK_RULES = { whoami: /^[1-9][0-9]{2,3}$/, name: /^[a-zA-Z][a-zA-Z0-9_]*$/ }`
  - `rulesFromSchema(schema: object) -> {whoami: RegExp, name: RegExp}`
  - `parseRegistry(yamlText: string) -> Map<number, object>`: uses `js-yaml` `load`, which resolves merge keys by default.
  - `validateEntry(entry: {whoami: string, name: string, authors?, copyright?, repositoryUrl?, projectUrl?}, rules, registry: Map|null) -> {field: string, message: string}[]`. Uniqueness checks are skipped when `registry` is `null`.
  - `suggestWhoAmI(registry: Map) -> number`: smallest unused integer greater than the current max, staying ≤ 9999.
  - `renderYamlBlock(entry) -> string`: per the Global Constraints, it begins with `  <whoami>:\n` and ends with `\n`. Empty optional fields are omitted. A value is emitted plain if it matches `^[A-Za-z0-9][A-Za-z0-9 _./:-]*$`, contains no `: ` or ` #`, and is not a YAML 1.1 boolean or null word (`yes`, `no`, `on`, `off`, `true`, `false`, `null`, `~`, case-insensitive). Otherwise it's `JSON.stringify(value)`.
  - `renderPrBody(entry, description: string) -> string`: fills the same headings as `.github/pull_request_template.md`.

- [ ] **Step 1: Write failing tests** in `site/lib.test.mjs`:
  - `rulesFromSchema reads patterns`: a schema object with the Task 2 patterns gives regexes that accept `1500`/`MyDevice` and reject `99`/`my-device`.
  - `parseRegistry resolves merge keys`: on the repo's `whoami.yml` (read with `fs`), `get(1040).authors === "harp-tech"` and `size === 45`.
  - `validateEntry flags taken whoami and duplicate name`: `{whoami:"1410"}` gives a whoami error. `{name:"HOBGOBLIN"}` gives a name error.
  - `validateEntry without registry skips uniqueness`: `{whoami:"1410", name:"Hobgoblin"}` with `null` gives `[]`.
  - `validateEntry rejects http urls and bad names`.
  - `suggestWhoAmI`: returns `2111` for the current registry.
  - `renderYamlBlock appends cleanly`: `whoamiYml + renderYamlBlock(e)` parsed with `parseRegistry` includes the new entry with exact field values, and the original 45 entries are unchanged.
  - `renders special characters safely`: `authors: 'Smith: Lab #2'`, `copyright: 'yes'` and `name` unchanged all round-trip exactly.
  - `renderYamlBlock field order and omission`: exact string equality for a full entry and for a name-only entry (`"  1500:\n    name: Foo\n"`).
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `site/lib.js` per the Interfaces.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Add a `node --test` step (`actions/setup-node@v4`, `node-version: 20`) to `validate-whoami.yml` and add `site/**` to its paths. Commit: `git commit -m "feat(site): add registry parsing, validation and YAML rendering"`

### Task 4: Form UI and guided GitHub flow

**Files:**
- Create: `site/index.html`, `site/app.js`, `site/style.css`

**Interfaces:**
- Consumes: everything Task 3 produces, plus the URLs in the Global Constraints and the step wording confirmed in Task 1.

Behaviour that must hold. The implementer chooses the layout. The page must work at phone width, support light and dark mode, and have accessible labels.

1. On load, fetch `whoami.yml` and `whoami.json` in parallel (`cache: "no-store"`). On success, show "Registry loaded: N devices" and prefill WhoAmI with `suggestWhoAmI`. On failure, use `FALLBACK_RULES` and show a persistent warning that uniqueness can't be checked until the PR's CI runs.
2. Fields: WhoAmI (required), Device name (required), Authors, Copyright, Repository URL, Project URL, and a Description textarea (required, PR body only, not written to YAML). Validate on input with inline errors. Show a link to the existing table (`whoami.md` on GitHub) for reference.
3. "Generate" is disabled while there are errors. When it's pressed, show three numbered steps:
   - **Step A:** a read-only `<pre>` with `renderYamlBlock(entry)` and a "Copy YAML" button (`navigator.clipboard.writeText`, with a select-text fallback).
   - **Step B:** "Open whoami.yml on GitHub" (`target=_blank`), plus instructions from Task 1. Sign in, accept the fork prompt if one appears, press Ctrl+End, make sure the cursor is on a new empty line at the very end, paste, and click "Commit changes… → Propose changes".
   - **Step C:** "Copy PR description" (`renderPrBody`). On the next page, click "Create pull request", replace the template text with the copied description, and submit. Explain that CI will validate the PR and report problems on it.
4. If the generated block contains a WhoAmI that becomes taken between load and generate, it doesn't matter: CI catches it. Don't add polling.

- [ ] **Step 1:** Implement the three files.
- [ ] **Step 2:** Serve locally (`npx http-server site -p 8080` or `python -m http.server -d site 8080`). Check that the registry loads, the suggested WhoAmI is `2111`, entering `1410` shows "already used by deLuxDriver", entering `Hobgoblin` shows a name collision, and both copy buttons work.
- [ ] **Step 3:** Block `raw.githubusercontent.com` in DevTools and reload. The warning appears and generation still works (Review Focus #4).
- [ ] **Step 4:** End to end on a scratch fork, following the site's instructions. The resulting PR's `whoami.yml` diff is a pure append, and the Task 2 workflow passes on it.
- [ ] **Step 5:** Commit: `git commit -m "feat(site): add device submission form with guided PR flow"`

### Task 5: Pages deployment and docs

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`

- [ ] **Step 1:** `pages.yml` triggers on `push` to `main` with paths `site/**`, and on `workflow_dispatch`. Permissions: `pages: write`, `id-token: write`, `contents: read`. Its `concurrency` group is `pages`. Steps: `actions/checkout@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3` with `path: site`, then `actions/deploy-pages@v4` in environment `github-pages`.
- [ ] **Step 2:** Put the form link at the top of the README's "Reserving a WhoAmI" section (`https://harp-tech.github.io/whoami/`). Keep the manual instructions as an alternative, and mention that CI validates PRs.
- [ ] **Step 3:** Maintainer action, to be listed in the PR description and not done by the agent: Settings → Pages → Source: **GitHub Actions**.
- [ ] **Step 4:** Validate the workflow syntax with `actionlint` if available, or by pushing to a fork that has Pages enabled and confirming the site serves.
- [ ] **Step 5:** Commit: `git commit -m "ci: deploy submission form to GitHub Pages; document it"`

## Out of scope

- A per-device file layout and the undocumented `/new/?value=` prefill (rejected by the user).
- Issue-form submission with bot-authored PRs. It would break the requirement that the contributor's own account authors the PR.
- Sorting `whoami.yml`. A separate `refactor-sort-on-whoami` branch exists. If it merges first, append-at-end still validates, because ordering isn't enforced.
