# Security policy

MK8DX Ecosystem is a hobby project maintained by one person. Security reports are welcome and
are handled on a best-effort basis.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private
vulnerability reporting instead: open the repository's **Security** tab and choose
**Report a vulnerability**. Describe:

- the affected component (website, API, browser scanner, Android, LiveTrial or Tournament tools)
  and the version or commit;
- the steps to reproduce, using synthetic accounts and data;
- the impact you expect (for example account takeover, data exposure, or an unauthorized result change).

Do not include real passwords, sign-in links, session cookies, database backups, private recordings
or other people's personal data. If a maintainer needs a diagnostic, they will ask for a narrowly
redacted one.

You can expect an acknowledgement within two weeks. When a fix is ready it is released and the
report is credited in the [changelog](CHANGELOG.md) unless you prefer otherwise.

## Scope

In scope: the source in this repository and the release packages built from it, in particular
authentication and sign-in links, authorization of administrator and Tournament Director actions,
submission and review workflows, the installer (`tooling/install.py`) and its handling of secrets,
and the client-to-server delivery of results.

Out of scope: a community's own hosting, DNS, mail provider and server configuration; vulnerabilities
in third-party dependencies that are already publicly known (please report those upstream, a dependency
update here is still welcome); and reports that need physical access to an operator's computer.

## Supported versions

Only the latest release and the `main` branch receive fixes. The project is pre-1.0; see the
[changelog](CHANGELOG.md).

## For operators

Keep your installation directory, `secrets.json`, database backups and client signing keys outside Git
and out of public reports. `tooling/install.py` keeps them in a private state directory for this reason.
Update to the latest release after a security fix and follow the backup step in
[Operations](docs/OPERATIONS.md) before every upgrade.
