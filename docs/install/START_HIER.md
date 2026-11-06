# Start hier: een MK8DX-installatie kiezen

De volledige, gewone handleiding is [MK8DX_Handleiding_NL.txt](MK8DX_Handleiding_NL.txt) (ook als
[Word-bestand](MK8DX_Handleiding_NL.docx)); in het Engels [MK8DX_User_Guide_EN.txt](MK8DX_User_Guide_EN.txt).
Die neemt je stap voor stap mee. De pagina's in deze map zijn technische naslag per route.

## Welke route past bij jou?

| Route | Voor wie | Status | Naslag |
| --- | --- | --- | --- |
| **A1** — één Windows-computer met Docker | Rustig proberen op je eigen pc, zonder domein of echte e-mail | Ondersteund | [A1_EEN_COMPUTER.md](A1_EEN_COMPUTER.md) |
| **A3** — één Windows-computer zonder Docker (XAMPP en Node.js) | Als Docker niet kan of mag | Ondersteund | [Nederlandse handleiding, hoofdstuk 2](MK8DX_Handleiding_NL.txt); [English guide, chapter 2](MK8DX_User_Guide_EN.txt) |
| **A2** — je eigen vertrouwde netwerk | Andere apparaten thuis of op een toernooilocatie laten meedoen | Gedocumenteerd; nog niet end-to-end getest | [A2_EIGEN_NETWERK.md](A2_EIGEN_NETWERK.md) |
| **B1** — een eigen VPS met Docker | Een openbare website op je eigen domein | Gedocumenteerd; nog niet end-to-end getest | [B1_VPS.md](B1_VPS.md) |
| **B2** — webhosting met Node.js en MariaDB | Een openbare website zonder eigen server | Gedocumenteerd; nog niet end-to-end getest | [B2_WEBHOSTING.md](B2_WEBHOSTING.md) |

Daarna: [apps koppelen](CLIENTS.md), [instellingen](INSTELLINGEN.md), [beheer, updates en herstel](BEHEER.md)
en [zelf bouwen](ONTWIKKELEN.md).

Voor A1 en A3 gebruik je het **hostpakket** uit de release. Je hoeft geen broncode te
bewerken, geen Python-pakketten met `pip` te installeren en geen Docker-image
te bouwen. De handleiding legt de installatie van Docker Desktop (A1) of
XAMPP/Node.js (A3), de kleine Python-installer, het eerste beheeraccount en
latere backup/updates stap voor stap uit. Begin met de route die je kiest;
de hoofdstukken zijn geen opeenvolgende installatiestappen.

## Vereisten vóór aanschaf of installatie

- **A1 en A3:** Windows 11 op x86-64, aanbevolen 8 GB werkgeheugen en ongeveer 15 GB vrije ruimte (A1) of
  enkele GB (A3). Dit zijn ruime marges, geen gemeten ondergrenzen.
- **A2:** dezelfde Windows-host als A1, plus de apparaten in hetzelfde vertrouwde netwerk. Geen gastnetwerk en
  geen doorgezette routerpoort.
- **B1:** Ubuntu 24.04 LTS op x86-64, aanbevolen 2 processorkernen, 8 GB geheugen en 40 GB SSD, een eigen domein
  en een uitgaande mailbox (SMTP met TLS).
- **B2:** een hostingpakket met Node.js 24 (Passenger), MariaDB 11.4+ of MySQL 8.4+, SSH, een lege database met
  een beperkte gebruiker en een mailbox.
- **Apps:** Android 8.0 of nieuwer (arm64 aanbevolen); LiveTrial en de toernooitools op Windows x86-64.

## Welk bestand krijg je?

Download uit de nieuwste release op de GitHub Releases-pagina van het project het pakket voor je route,
samen met `SHA256SUMS.txt`:

| Route | Pakket |
| --- | --- |
| A1, A2, B1 | `mk8dx-host-local-…-amd64.zip` |
| A3 | `mk8dx-xampp-node-windows-….zip` |
| B2 | `mk8dx-mijnhost-node-….zip` |
| Android | `mk8dx-android-release-….apk` en `mk8dx-android-notices-….zip` |
| LiveTrial | `desktop-client-….zip` |
| Toernooitools | `tournament-tools-….zip` |

Controleer elk pakket vóór het uitpakken. In PowerShell, in de map met beide bestanden:

```powershell
Get-FileHash '.\<pakketnaam>.zip' -Algorithm SHA256
```

Vergelijk de volledige waarde met de regel voor dat bestand in `SHA256SUMS.txt`. Wijkt hij af, pak dan niets
uit en download opnieuw. GitHubs knop **Source code (zip)** is geen installatiepakket.
Eerdere publieke APK's waren met een debugsleutel ondertekend: bewaar nog niet verzonden resultaten en verwijder
die app één keer voordat je de release-APK installeert. Latere APK's met dezelfde releasesleutel kunnen ter
plekke worden bijgewerkt.
