# B1 — je eigen openbare MK8DX-site op een VPS

Deze route is bedoeld voor een **zelfbeheerde Ubuntu 24.04 LTS x86-64 VPS** met ten minste de **geadviseerde** 2 vCPU, 8 GB RAM en 40 GB SSD. Een voorbeeld van een passend pakket is mijn.host **unmanaged VPS M**: de [actuele VPS-pagina](https://mijn.host/vps) noemt 2 cores, 8 GB RAM, 40 GB opslag en root/SSH, maar er is **geen MK8DX-installatie op dat exacte pakket getest**. De aanbieder beheert de fysieke machine; jij beheert Ubuntu, Docker, MK8DX, mail, backups en beveiligingsupdates. Controleer vóór betaling het besteloverzicht, IPv4, x86-64/Ubuntu 24.04, root of sudo, eigen poorten 80/443, permanente opslag, uitgaand SMTP 465 en eventuele aparte mailbox. Koop niets op basis van alleen de woorden “Node.js” of “SSH”. Zie [B2](B2_WEBHOSTING.md) voor gedeelde webhosting met Node.js (zoals mijn.host Starter).

In deze handleiding is `www.mijneigenwebsite.nl` een **voorbeeld**, geen bestaand doel. Vervang het door één eigen gekozen hostnaam. Het server-IP in voorbeelden `203.0.113.10` is documentatie-IP, geen echte server. De SSH-poort in voorbeelden `22` is ook alleen een vorm; neem de werkelijke VPS-poort uit je providergegevens. Gebruik geen webhosting-SSH-poort 26 als VPS-aanname.

## 1. Bewaar de vijf soorten gegevens afzonderlijk

**Waar:** in het providerportaal of de ontvangen welkomstmail. **Doe:** noteer op een private plek (niet in dit document): providerlogin, VPS IPv4, VPS-beheeraccount en SSH-poort, domein/DNS-beheer, en later de SMTP-mailboxgegevens. De MK8DX-adminmail is jouw eigen te verifiëren identiteit en kan een ander adres zijn. **Je ziet:** een VPS met Ubuntu 24.04 x86-64, voldoende capaciteit en een bereikbaar IPv4-adres. **Als het afwijkt:** vraag de provider schriftelijk welke optie ontbreekt; onderaan [B2](B2_WEBHOSTING.md) staat een bericht zonder wachtwoorden. Een providerlogin is geen databasewachtwoord en hoort niet in MK8DX.

## 2. Download, controleer en upload het hostpakket

**Waar eerst:** op je Windows-pc. **Doe:** neem het hostpakket `mk8dx-host-local-<versie>-amd64.zip` uit de nieuwste release met `SHA256SUMS.txt`; controleer de SHA-256 zoals op [Start hier](START_HIER.md#welk-bestand-krijg-je). Download [WinSCP van de officiële site](https://winscp.net/eng/download.php) en installeer de normale Windows-versie. **Waar daarna:** WinSCP → **New Site**. Kies **SFTP**; vul **Host name** = werkelijk VPS-IP, **Port number** = werkelijke VPS-SSH/SFTP-poort, **User name** = provideraccount op de VPS (bij deze concrete route `root`), en de door provider gegeven authenticatiemethode. De eerste verbinding toont een hostkeyfingerprint. Vergelijk die met de fingerprint die je via de **onafhankelijke providerconsole of providerondersteuning** hebt gekregen; accepteer hem niet alleen omdat WinSCP hem toont. [WinSCP-verbindingshulp](https://winscp.net/eng/docs/guide_connect). **Je ziet:** links je pc, rechts de servermap `/root/`. Sleep de gecontroleerde ZIP naar `/root/`. **Als het afwijkt:** controleer host/IP/poort, sleutel of wachtwoord; een wachtwoord kan onzichtbaar worden ingevoerd. Bij onbekende hostkey: stop en vraag de provider om verificatie. Upload geen secrets, databasebackup of complete ontwikkelaarsbron naar een publiek `public_html`.

Als de provider uitsluitend een SSH-sleutel accepteert: open **WinSCP → Tools → Run PuTTYgen**, kies **Generate**, beweeg de muis zoals gevraagd, zet een sterke passphrase en bewaar de private sleutel buiten de MK8DX-map. Voeg de **publieke** sleutel via het door de provider aangewezen VPS-sleutelveld toe. Vraag de provider om de exacte plek wanneer het portaal die niet toont. De private sleutel gaat nooit naar de server als webbestand.

## 3. Open de serverterminal en controleer de machine

**Waar:** op je Windows-pc, PowerShell (Start → typ `PowerShell`). Vul je echte waarden in, bijvoorbeeld:

```powershell
$serverIp = '203.0.113.10'
$sshPort = 22
ssh -p $sshPort "root@$serverIp"
```

**Doe:** vergelijk ook hier de getoonde hostkey met de providerconsole; typ daarna pas het serverwachtwoord of gebruik je sleutel. **Je ziet:** een shellprompt op Ubuntu, vaak `root@...#`. **Als het afwijkt:** kijk naar de echte VPS-poort/account in het portaal. Mijn.host webhostingdocumentatie noemt [SSH-poort 26](https://mijn.host/kb/webhosting/verbinden-met-ssh) en een apart [SFTP-artikel poort 22](https://mijn.host/kb/webhosting/verbinden-via-sftp-in-filezilla); dat zijn geen bewezen VPS-instellingen. Op de server voer je uit:

```sh
cat /etc/os-release
uname -m
free -h
df -h /
python3 --version
```

**Je ziet:** Ubuntu 24.04, `x86_64`, ongeveer de gekozen RAM/opslag en Python 3.12+. **Als het afwijkt:** stop vóór je images laadt; dit pakket is alleen als Linux `amd64` benoemd.

## 4. Installeer Docker Engine en Compose op Ubuntu

**Waar:** in hetzelfde SSH-venster, als root of met `sudo` voor de systeemopdrachten. Volg de [officiële Ubuntu apt-repositorymethode](https://docs.docker.com/engine/install/ubuntu/). Controleer eerst met `command -v docker` en `docker compose version` of Docker al correct aanwezig is; installeer geen tweede conflicterende variant. Voor een nieuwe Ubuntu 24.04 VPS voer je de volgende kleine groepen uit en controleer je telkens dat er geen fout staat:

```sh
apt update
apt install ca-certificates curl unzip
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
```

**Je ziet:** `/etc/apt/keyrings/docker.asc`. Voeg dan de officiële bron toe:

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

**Controle:** `systemctl is-active docker` moet `active` geven; `docker compose version` een versienummer. **Als het afwijkt:** lees de apt-fout en de officiële Dockerpagina; installeer niet lukraak `docker.io` ernaast. Docker waarschuwt dat gepubliceerde containerpoorten bepaalde hostfirewallregels kunnen passeren: controleer óók het provider-firewallpaneel en publiceer alleen 80/443 voor de Web-gateway. Houd de werkende SSH-poort bereikbaar; open geen MySQL-poort. Voer geen brede firewallreset uit.

## 5. Koppel het domein vóór de eerste HTTPS-start

**Waar:** in de browser bij de partij die jouw DNS-zone beheert. **Doe:** kies één hostnaam, hier `www.mijneigenwebsite.nl`. Maak of wijzig daarvoor een **A-record** met **Naam/Host** `www`, **Type** `A`, **Waarde/Doel** = werkelijk VPS IPv4, **TTL** = standaard of 300 seconden. Laat bestaande MX/SPF/DKIM-mailrecords staan. Verwijder een fout AAAA-record voor dezelfde host alleen nadat je vaststelt dat er geen werkend IPv6-doel voor deze site is; vraag bij twijfel je DNS-beheerder. **Je ziet:** in PowerShell op je pc geeft `Resolve-DnsName www.mijneigenwebsite.nl -Type A` na verspreiding jouw VPS IPv4. **Als het afwijkt:** controleer welke partij de gezaghebbende DNS-zone beheert en wacht de TTL af. De installer kan DNS niet automatisch wijzigen.

**Waar:** in het VPS-providerpaneel en eventueel op Ubuntu. **Doe:** laat inkomend TCP 80 en 443 naar de VPS toe, behoud de gecontroleerde SSH-poort, sluit MySQL 3306 naar buiten. **Je ziet:** de provider toont toegestane 80/443-regels en geen publieke databasepoort. **Als het afwijkt:** corrigeer eerst de provider-firewall; zonder bereikbare 80/443 kan Caddy geen normaal publiek certificaat krijgen. Caddy gebruikt de persistente Docker-volumes `caddy_data` en `caddy_config` [Caddy](https://caddyserver.com/docs/automatic-https).

## 6. Regel een echte uitgaande mailbox

**Waar:** bij je mailprovider. Voor een mijn.host-mailbox staat in de [publieke mailhulp](https://mijn.host/kb/email/e-mail-account-instellen-in-gmail) een SMTP-voorbeeld met host `mail.<jouwdomein>`, **poort 465 met SSL/TLS**, volledige mailbox als gebruikersnaam en het mailboxwachtwoord. Het [algemene artikel](https://mail.mijn.host/kb/email/standaard-email-poorten-voor-imap-pop-smtp) noemt ook 587; de huidige MK8DX-wizard ondersteunt voor deze route **465 met impliciete TLS**. Controleer de exacte hostnaam en afzenderautorisatie in jouw mailpakket, plus eventuele verzendlimiet en uitgaande VPS-poortblokkade. Maak geen verzonnen SPF/DKIM-record; volg de daadwerkelijke providerinstructies. **Je ziet:** een bestaande mailbox en de vijf SMTP-gegevens uit stap A2-2. **Als het afwijkt:** vraag de mailprovider of 465/TLS en geauthenticeerd verzenden vanaf jouw VPS zijn toegestaan. Een website die opent maar geen mail verstuurt is geen afgeronde publieke installatie.

## 7. Pak uit en start de wizard

**Waar:** in het SSH-venster op de VPS. **Doe:** controleer `pwd` en de geüploade ZIP, maak de pakketmap, pak uit en ga naar de map met `compose.yaml`:

```sh
pwd
ls -lh /root/mk8dx-host-local-<versie>-amd64.zip
mkdir -p /opt/mk8dx/host /var/lib/mk8dx
unzip -q /root/mk8dx-host-local-<versie>-amd64.zip -d /opt/mk8dx/host
cd /opt/mk8dx/host
ls Start-MK8DX.cmd compose.yaml tooling/start-mk8dx.sh images/docker-images-amd64.tar
```

**Je ziet:** alle vier bestandsnamen. **Als het afwijkt:** de ZIP is niet volledig of in een extra map uitgepakt. Houd `/var/lib/mk8dx` privé en buiten de uitwisselbare pakketmap. Nu:

```sh
sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance
```

Kies **B1**, vul alleen je exacte hostnaam zonder `https://` in, de SMTP-host/poort `465`/login/afzender, en je **eigen toekomstige MK8DX-adminadres**. Het SMTP-wachtwoord verschijnt niet tijdens typen. De wizard maakt de rest en laadt de voorgebouwde images. Kies **1**. **Je ziet:** `https://jouw-hostnaam`, alle migraties uit de catalogus, de twee referentiesets, daarna gezonde services. **Als het afwijkt:** lees de begrensde fout. Een SMTP-readinessfout hoort bij mailverbinding of providerinstellingen; een certificaatfout bij DNS/poorten/TLS. Herhaal na reparatie dezelfde installatie, zonder nieuwe map/volume/sleutels. Voer `sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance` opnieuw uit en kies **3** voor status.

## 8. Controleer publiek adres, mail en eigen administrator

**Waar:** op je eigen pc in de browser. **Doe:** open `https://<jouw-werkelijke-hostnaam>/health/ready` en daarna de homepage; kijk of de browser een geldig slotje toont zonder waarschuwing. Kies **Aanmelden**, typ het eerder opgegeven adminadres, open de e-mail in je **echte inbox** en volg de link. **Je ziet:** na aanmelding je eigen account. **Als het afwijkt:** controleer `/health/ready`, DNS-A-record, 80/443, TLS en SMTP; een draaiende container alleen bewijst geen bezorging. Nu pas, in het SSH-venster:

```sh
cd /opt/mk8dx/host
sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance
```

Kies **5**. De bestaande beheer-CLI gebruikt het eenmaal opgeslagen doeladres via stdin en vereist de geverifieerde aanmelding. **Je ziet:** `created` of bij herhaling `unchanged`; ververs de website voor de beheerweergave. Een willekeurige eerste registratie wordt geen admin. Test daarna een Time Trial-inzending en [de cliënten](CLIENTS.md).

## 9. Blijf beheren

**Waar:** op de VPS in `/opt/mk8dx/host`, via dezelfde SSH-route. `sh tooling/start-mk8dx.sh /var/lib/mk8dx/instance` biedt **2 start**, **3 status**, **4 stop**, **6 backup**. Download een private backup buiten de VPS via WinSCP; een serverstoring mag niet ook alle backups wissen. Plan Ubuntu-/Docker-/MK8DX-updates en bewaak vrije schijfruimte. [Beheer en herstel](BEHEER.md) legt een aparte herstelinstallatie en updatevolgorde uit. Een nieuwe versie van het ZIP vervangt de softwaremap; `/var/lib/mk8dx/instance` en het named databasevolume blijven staan. Publiceer het private profiel, aanmeldlinks en backup nooit als webbestand.
