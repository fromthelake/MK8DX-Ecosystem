# Contributing to MK8DX Ecosystem

Thank you for improving the project for the Mario Kart 8 Deluxe community.
Start with the [README](README.md), [architecture overview](docs/architecture/COMPONENTS.md)
and [developer guide](docs/DEVELOPMENT.md). The [agent guide](AGENTS.md) gives
a reading order and a map of the source. Read the affected component's README
before editing it.

Open an issue to describe a bug or a proposed change. For a code change, make
a small branch, explain the user-visible effect in your pull request, and run
the checks for the affected components in [TESTING.md](docs/TESTING.md).
Mention what you tested and what remains untested. Changes to shared contracts,
assets or database migrations need their affected consumers checked too.

Keep accounts, credentials, recordings, private installation data, databases
and personal results out of commits and issues. Use synthetic examples. Do not
add Nintendo or other third-party assets unless their provenance and right to
redistribute them have been reviewed. [License scope](LICENSE_SCOPE.md) and
[third-party materials](docs/THIRD_PARTY_MATERIALS.md) explain the current
boundary.

The project's own files are licensed under MPL 2.0 through the
[LICENSE](LICENSE) file at the repository root; no per-file license header is
required, and new files need none. By submitting your own changes, you offer
them under MPL 2.0. Keep existing third-party notices intact. Separate
files with their own licenses retain those terms; flag any uncertainty in the
pull request. A pull request is welcome, but not required by the license.

## AI-assisted contributions

You may use AI tools (code assistants, agents, chat models) to prepare a contribution. Then:

- **Disclose it** in the pull request: which tool, and what it did (for example "drafted the tests",
  "wrote the first version of this function").
- **You are the author and you are responsible** for every line: you have read and understood it, you can
  explain it in review, and you have the right to submit it under MPL 2.0. Do not submit generated code that
  reproduces third-party code you may not license.
- **The same checks apply**: run the tests from [TESTING.md](docs/TESTING.md) yourself and report the real
  results. Do not paste unverified claims ("all tests pass") from a tool.
- Keep private data out of prompts as well as commits: do not give a tool credentials, `secrets.json`,
  databases, recordings or other people's personal data.

The [agent guide](AGENTS.md) (also read through `CLAUDE.md` and `GEMINI.md`) tells coding agents how to work in
this repository. Automated pull requests from bots other than Dependabot are not accepted.

## How development works

This repository is the project's main repository: pull requests are reviewed and merged here, and releases are
tagged here. The maintainer's own installation keeps its private parts outside the repository - production
configuration, private recognition test sets, recordings and the Android release signing key - and never needs
them in a pull request. Recognition changes are measured on the maintainer's private sets before a release; the
parity vectors of the central reader (`packages/icon-matcher`) are the recognition checks everyone can run.

## Branches and pull requests

- `main` is protected: changes arrive through a pull request whose Verify and CodeQL checks pass. No review
  approval is required, force pushes and deleting `main` are blocked.
- Work on a short-lived branch from `main` named `feat/`, `fix/`, `docs/` or `chore/` plus a short description,
  open a pull request, and **squash-merge** it once the checks pass. GitHub deletes the branch after the merge.
- A `release/*` branch exists only for an actual maintenance or release need (for example `release/0.2`) and is
  merged into `main` through a pull request; it is not a second development line.
- Do not force-push shared branches, rewrite published history or delete release tags.

## Releases

A maintainer tags `v<version>`; the Release workflow builds the client packages and the source archive, writes
`SHA256SUMS.txt` and `manifest.json`, and opens a draft release. The maintainer attaches the server packages (and
a release-signed APK, if any), refreshes `SHA256SUMS.txt`, reviews and publishes it. See
[Release packages](docs/RELEASE_PACKAGES.md#publishing-a-release).

Please follow the [code of conduct](CODE_OF_CONDUCT.md). Report security
problems privately as described in [SECURITY.md](SECURITY.md), not in a public
issue. Record user-visible changes in [CHANGELOG.md](CHANGELOG.md) under
*Unreleased*.
