# B1 — your own public MK8DX site on a VPS

Nederlands: [B1_VPS.md](B1_VPS.md)

This route is meant for a **self-managed Ubuntu 24.04 LTS x86-64 VPS** with at least the **recommended** 2 vCPU, 8 GB RAM and 40 GB SSD. An example of a suitable package is mijn.host **unmanaged VPS M**: the [current VPS page](https://mijn.host/vps) lists 2 cores, 8 GB RAM, 40 GB storage and root/SSH, but **no MK8DX installation has been tested on that exact package**. The provider manages the physical machine; you manage Ubuntu, Docker, MK8DX, mail, backups and security updates. Before paying, check the order summary, IPv4, x86-64/Ubuntu 24.04, root or sudo, your own ports 80/443, persistent storage, outgoing SMTP 465 and any separate mailbox. Do not buy anything on the strength of the words “Node.js” or “SSH” alone. See [B2](B2_WEBHOSTING_EN.md) for shared web hosting with Node.js (such as mijn.host Starter).

In this guide `www.mijneigenwebsite.nl` is an **example**, not an existing target. Replace it with one host name of your own choosing. The server IP `203.0.113.10` in the examples is a documentation IP, not a real server. The SSH port `22` in the examples is also only a form; take the actual VPS port from your provider details. Do not assume the web-hosting SSH port 26 for a VPS.

## 1. Keep the five kinds of details separate

**Where:** in the provider portal or the welcome email you received. **Do:** write down in a private place (not in this document): the provider login, VPS IPv4, VPS administration account and SSH port, domain/DNS management, and later the SMTP mailbox details. The MK8DX admin mail is your own identity to be verified and can be a different address. **You see:** a VPS with Ubuntu 24.04 x86-64, enough capacity and a reachable IPv4 address. **If it differs:** ask the provider in writing which option is missing. A provider login is not a database password and does not belong in MK8DX.

## 2. Download, check and upload the host package

**Where first:** on your Windows PC. **Do:** take the host package `mk8dx-host-local-<versie>-amd64.zip` (`<versie>` is the version) from the newest release with `SHA256SUMS.txt`; check the SHA-256 as in [Start here](START_HERE_EN.md#which-file-do-you-get). Download [WinSCP from the official site](https://winscp.net/eng/download.php) and install the normal Windows version. **Where next:** WinSCP → **New Site**. Choose **SFTP**; fill in **Host name** = the actual VPS IP, **Port number** = the actual VPS SSH/SFTP port, **User name** = the provider account on the VPS (`root` on this concrete route), and the authentication method the provider gave you. The first connection shows a host key fingerprint. Compare it with the fingerprint you got through the **independent provider console or provider support**; do not accept it just because WinSCP shows it. [WinSCP connection help](https://winscp.net/eng/docs/guide_connect). **You see:** your PC on the left, the server folder `/root/` on the right. Drag the checked ZIP to `/root/`. **If it differs:** check the host/IP/port, key or password; a password may be entered invisibly. With an unknown host key: stop and ask the provider for verification. Do not upload secrets, a database backup or the complete developer source to a public `public_html`.

If the provider accepts only an SSH key: open **WinSCP → Tools → Run PuTTYgen**, choose **Generate**, move the mouse as asked, set a strong passphrase and keep the private key outside the MK8DX folder. Add the **public** key through the VPS key field the provider designates. Ask the provider for the exact place when the portal does not show it. The private key never goes to the server as a web file.

## 3. Open the server terminal and check the machine

**Where:** on your Windows PC, PowerShell (Start → type `PowerShell`). Fill in your real values, for example:

```powershell
$serverIp = '203.0.113.10'
$sshPort = 22
ssh -p $sshPort "root@$serverIp"
```

**Do:** here too, compare the host key shown with the provider console; only then type the server password or use your key. **You see:** a shell prompt on Ubuntu, often `root@...#`. **If it differs:** look up the actual VPS port/account in the portal. mijn.host's web-hosting documentation mentions [SSH port 26](https://mijn.host/kb/webhosting/verbinden-met-ssh) and a separate [SFTP article with port 22](https://mijn.host/kb/webhosting/verbinden-via-sftp-in-filezilla); those are not proven VPS settings. On the server run:

```sh
cat /etc/os-release
uname -m
free -h
df -h /
python3 --version
```

**You see:** Ubuntu 24.04, `x86_64`, roughly the chosen RAM/storage and Python 3.12+. **If it differs:** stop before you load images; this package is labelled for Linux `amd64` only.

## 4. Install Docker Engine and Compose on Ubuntu

**Where:** in the same SSH window, as root or with `sudo` for the system commands. Follow the [official Ubuntu apt repository method](https://docs.docker.com/engine/install/ubuntu/). First check with `command -v docker` and `docker compose version` whether Docker is already correctly present; do not install a second, conflicting variant. For a new Ubuntu 24.04 VPS run the following small groups and check each time that no error appears:

```sh
apt update
apt install ca-certificates curl unzip
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
```

**You see:** `/etc/apt/keyrings/docker.asc`. Then add the official source:

```sh
cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt update
apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

**Check:** `systemctl is-active docker` must give `active`; `docker compose version` a version number. **If it differs:** read the apt error and the official Docker page; do not haphazardly install `docker.io` alongside it. Docker warns that published container ports can bypass certain host firewall rules: **also** check the provider's firewall panel and publish only 80/443 for the Web gateway. Keep the working SSH port reachable; do not open a MySQL port. Do not do a broad firewall reset.

## 5. Connect the domain before the first HTTPS start

**Where:** in the browser at the party that manages your DNS zone. **Do:** choose one host name, here `www.mijneigenwebsite.nl`. Create or change an **A record** for it with **Name/Host** `www`, **Type** `A`, **Value/Target** = the actual VPS IPv4, **TTL** = default or 300 seconds. Leave existing MX/SPF/DKIM mail records alone. Remove a wrong AAAA record for the same host only after you have established that there is no working IPv6 target for this site; if in doubt, ask your DNS administrator. **You see:** in PowerShell on your PC, after propagation, `Resolve-DnsName www.mijneigenwebsite.nl -Type A` gives your VPS IPv4. **If it differs:** check which party manages the authoritative DNS zone and wait out the TTL. The installer cannot change DNS automatically.

**Where:** in the VPS provider panel and possibly on Ubuntu. **Do:** allow incoming TCP 80 and 443 to the VPS, keep the checked SSH port, close MySQL 3306 to the outside. **You see:** the provider shows allowed 80/443 rules and no public database port. **If it differs:** correct the provider firewall first; without reachable 80/443, Caddy cannot get a normal public certificate. Caddy uses the persistent Docker volumes `caddy_data` and `caddy_config` [Caddy](https://caddyserver.com/docs/automatic-https).

**Trying B1 privately first (optional):** without DNS or open ports you can rehearse the steps on a spare Ubuntu machine with a private name ending in `.home.arpa` (for example `mk8dx-test.home.arpa`) that you point at that machine in the `hosts` file of the PC you test from. Caddy then makes its own local certificate instead of asking Let's Encrypt, so the browser warns; that is expected for a rehearsal and not acceptable for the real site. Mail is not simulated in B1: the API checks the SMTP server's certificate at start and refuses a mail server with a self-signed certificate (`SMTP readiness check failed`), so a B1 rehearsal uses your real mailbox with port 465 (a separate sender address is fine). **Never switch certificate checking off** (for example `NODE_TLS_REJECT_UNAUTHORIZED=0` in `api.env`): the API would then trust any server it talks to, not only the mail server. To rehearse the sign-in mail itself without a mailbox, use the same package with **A1** instead (a separate installation folder, for example `sh tooling/start-mk8dx.sh ~/mk8dx-rehearsal`, and choose `A1`): A1 brings its own local inbox (Mailpit), and the window shows its address, for example `http://127.0.0.1:18025`, where the magic link arrives ([A1](A1_ONE_COMPUTER_EN.md); tested with 0.2.6 on Ubuntu 24.04 in WSL 2). Remove the rehearsal afterwards as described in [Remove an installation](../guides/HOSTING.md#remove-an-installation).

## 6. Arrange a real outgoing mailbox

**Where:** at your mail provider. For a mijn.host mailbox the [public mail help](https://mijn.host/kb/email/e-mail-account-instellen-in-gmail) has an SMTP example with host `mail.<jouwdomein>`, **port 465 with SSL/TLS**, the full mailbox as user name and the mailbox password. The [general article](https://mail.mijn.host/kb/email/standaard-email-poorten-voor-imap-pop-smtp) also mentions 587; the current MK8DX wizard supports **465 with implicit TLS** for this route. Check the exact host name and sender authorisation in your mail package, plus any sending limit and outgoing VPS port block. Do not make up an SPF/DKIM record; follow the provider's actual instructions. **You see:** an existing mailbox and the five SMTP details from step 3 of [A2](A2_EIGEN_NETWERK.md) (Dutch). **If it differs:** ask the mail provider whether 465/TLS and authenticated sending from your VPS are allowed. A website that opens but sends no mail is not a finished public installation.

## 7. Extract and start the wizard

**Where:** in the SSH window on the VPS. **Do:** check `pwd` and the uploaded ZIP, make the package folder, extract and go to the folder with `compose.yaml`:

```sh
pwd
ls -lh /root/mk8dx-host-local-<versie>-amd64.zip
mkdir -p /opt/mk8dx/host /var/lib/mk8dx
unzip -q /root/mk8dx-host-local-<versie>-amd64.zip -d /opt/mk8dx/host
cd /opt/mk8dx/host
ls Start-MK8DX.cmd compose.yaml tooling/start-mk8dx.sh images/docker-images-amd64.tar
```

**You see:** all four file names. **If it differs:** the ZIP is incomplete or was extracted into an extra folder. Keep `/var/lib/mk8dx` private and outside the replaceable package folder. Now:

```sh
sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance
```

Choose **B1**, fill in only your exact host name without `https://`, the SMTP host/port `465`/login/sender, and your **own future MK8DX admin address**. The SMTP password does not appear while you type. The wizard makes the rest and loads the prebuilt images; the first installation then starts by itself. **You see:** `https://jouw-hostnaam`, all migrations from the catalogue, the two reference sets, then healthy services. **If it differs:** read the bounded error. An SMTP readiness error relates to the mail connection or provider settings; a certificate error to DNS/ports/TLS. After the repair, repeat the same installation, without a new folder/volume/keys. Run `sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance` again and choose **3** for status.

## 8. Check the public address, mail and your own administrator

**Where:** in the browser on your own PC. **Do:** open `https://<jouw-werkelijke-hostnaam>/health/ready` and then the home page; check that the browser shows a valid padlock without a warning. Choose **Sign in**, type the admin address you gave earlier, open the email in your **real inbox** and follow the link. **You see:** your own account after signing in. **If it differs:** check `/health/ready`, the DNS A record, 80/443, TLS and SMTP; a running container alone does not prove delivery. Only now, in the SSH window:

```sh
cd /opt/mk8dx/host
sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance
```

Choose **5**. The existing administration CLI uses the target address saved once via stdin and requires the verified sign-in. **You see:** `created`, or `unchanged` on a repeat; reload the website for the administration view. An arbitrary first registration does not become admin. Then test a Time Trial submission and [the clients](CLIENTS_EN.md).

## 9. Keep administering

**Where:** on the VPS in `/opt/mk8dx/host`, through the same SSH route. `sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance` offers **2 start**, **3 status**, **4 stop**, **6 backup**. With `--skip-countdown` before the folder the window leaves out the countdown ([options](ADMINISTRATION_EN.md#the-start-window-display-and-options)). Download a private backup off the VPS with WinSCP; a server failure must not also wipe all backups. Plan Ubuntu/Docker/MK8DX updates and keep an eye on free disk space. [Administration and restoring](ADMINISTRATION_EN.md) explains a separate restore installation and the update order. A new version of the ZIP replaces the software folder; `/var/lib/mk8dx/instance` and the named database volume stay in place. Never publish the private profile, sign-in links or backup as a web file.

**Automatic backup:** `setup` puts one marked line in the crontab of the account that runs MK8DX: every night at
03:15 a checked backup in `~/mk8dx-backups/automatic` (as root: `/root/mk8dx-backups/automatic`), 14 days and 4
weeks, at most 10 GB. `crontab -l` shows the line; **3 status** shows the age and result of the last run under
`automaticBackup`. Pull the newest one to your PC regularly with `backup-latest --print-path` and `scp`
([commands](../OPERATIONS.md#automatic-daily-backup-a1-a2-b1-a3-b2)). Off: `python3 tooling/install.py
backup-unschedule --state-dir /var/lib/mk8dx/instance`.

**Database accounts:** the website signs in to its database with its own account (`mk8dx_runtime`) that can only read and write data; database updates use the database's own account (`mk8dx_app`). Setup creates both; an older installation gets them at its next update (`upgrade`), and if the website does not start with the new account the update returns to the old one. `status` shows `"databaseAccounts": "separate"`. Details: [Operations](../OPERATIONS.md#database-accounts).

**Confirming dangerous actions:** changing rights, the installation settings, recalculating ratings, removing or reopening a night and the list of all accounts ask for a fresh link to your own address (**Confirm with a new email link**). Keep the SMTP settings working (`python3 tooling/install.py change-smtp --state-dir /var/lib/mk8dx/instance`). When mail fails, press **Send the link** anyway and run within 10 minutes `python3 tooling/install.py step-up-link --state-dir /var/lib/mk8dx/instance` in the SSH window; it prints a single-use link for that request ([details](../OPERATIONS.md#when-e-mail-fails-confirm-a-dangerous-action-from-the-server)).
