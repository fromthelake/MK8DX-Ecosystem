# Offline LAN installation profile foundation — 2026-11-05

`tooling/install.py init --mode offline-lan --lan-bind-address <private IPv4>`
now creates a separate `A2_OFFLINE` profile, exact IP HTTPS origin, unique
private CA and offline gateway Compose selection. It needs no SMTP address or
password. The existing A1/A2/A3/B1/B2 wizard choices remain unchanged.

This profile is **not yet installable**: startup and upgrade are explicitly
refused until the local invitation runtime and host administration are wired.
The route is not offered in the interactive wizard or support matrix. This
gate avoids an apparently working gateway with unusable sign-in. The offline
Compose command inserts `--pull never` for `up` and `run`, so it cannot silently
fetch images during installation. The eventual host package must supply all
images locally and the installer must validate the selected host interface and
private firewall profile before opening ports 80/443.

The installer status path validates signer key/certificate/issuer/expiry,
root fingerprint and profile IP before the future gateway start. Generic
`change-origin` and `change-lan-address` cannot alter an offline profile; an
IP-change action must rotate the exact-IP signer, regenerate the setup QR and
update all origin-bound fields as one reviewed operation.

On Windows, the separate disposable CA venv ran eight focused CA/lifecycle/
installer tests, and `docker compose config --quiet` succeeded for the new
profile. The existing four installation-route tests passed. No container,
browser, Android device or physical phone was used for this foundation step.
