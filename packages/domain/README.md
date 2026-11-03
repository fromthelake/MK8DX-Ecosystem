# Domain contracts

Shared identity and submission contracts live here. API and Web may consume public exports; this package must not import either application or deployment configuration. Change a contract at its canonical definition and verify producer plus reverse consumers with `python tooling/check_boundaries.py`, API/Web typecheck and focused tests. The component registry names the dependent components.
