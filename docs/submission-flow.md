# Submission flow: GitHub editor prefill findings

Status: researched 2026-11-22. **Manual verification pending.** It needs a GitHub account without write access to the target repository.

## What GitHub supports

| URL | Prefill | Documented |
|---|---|---|
| `/<owner>/<repo>/new/<branch>?filename=<path>` | file name | Yes ([GitHub blog, 2012](https://github.blog/2012-12-05-creating-files-on-github/)) |
| `/<owner>/<repo>/new/<branch>?filename=<path>&value=<urlencoded>` | file name + content | **No.** Widely used and copied by Gitea "for GitHub compatibility", but it could change without notice. |
| `/<owner>/<repo>/edit/<branch>/<path>` | none | No content parameter exists |
| `/<owner>/<repo>/compare/<base>...<user>:<branch>?quick_pull=1&title=&body=` | PR title/body | Yes, but it needs the fork branch name, which the form can't know |

Because registry entries are appended to the existing `whoami.yml`, the form **can't** prefill the edit. Instead it:

1. copies the generated YAML block to the clipboard,
2. opens `/edit/main/whoami.yml` (for an account without write access, GitHub offers to fork automatically and commits to a new `patch-N` branch in the fork),
3. copies a PR description to paste into the PR that GitHub offers after "Propose changes".

The `.github/pull_request_template.md` provides the PR body's structure when the PR is opened from the editor flow.

## Manual test checklist

Run these against a test deployment (for example `https://bruno-f-cruz.github.io/whoami/`, which targets `bruno-f-cruz/whoami`). Use a **second GitHub account** that:

- has no write access to the target repo, and
- does not already own a fork anywhere in the `harp-tech/whoami` fork network (GitHub allows only one fork per account in a network).

- [ ] The form loads and shows "Registry loaded: N devices".
- [ ] "Open whoami.yml on GitHub" shows the fork prompt. Accepting it opens the editor.
- [ ] Ctrl+End, paste on a new empty last line, then "Commit changes… → Propose changes" lands on the "Open a pull request" page.
- [ ] The PR body shows the template. Pasting the copied description works.
- [ ] The PR's diff is a pure append to `whoami.yml`.
- [ ] The "Validate WhoAmI registry" workflow waits for "Approve and run" (first-time contributor), then passes.
- [ ] Re-test with a duplicate WhoAmI pasted in by hand. The workflow fails with an annotation.
- [ ] Optional: confirm whether `/new/main?filename=x.yml&value=...` still prefills content (for the record only).

Record results and the test date here.
