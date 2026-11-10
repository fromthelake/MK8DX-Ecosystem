# A2 offline LAN — orientation for a prepared QA installation

The public offline A2 installer and full phone qualification are still in
progress. These steps explain an **existing QA installation prepared by its
administrator**. They are not a claim that the public A2 route is ready. The
older private-hostname/SMTP profile is documented separately in
[A2 — delen op je eigen vertrouwde netwerk](A2_EIGEN_NETWERK.md).

| Device | Address | Purpose |
| --- | --- | --- |
| Host PC only | `http://127.0.0.1:19090/` | Private host administration: setup QR, CA fingerprint, accounts and invitations. |
| Phone or second PC on the same trusted LAN | `http://<LAN-IP>/setup` | Public certificate and setup instructions before HTTPS works. |
| Phone or second PC after installing trust | `https://<LAN-IP>/` | Website, scanner and published times. |
| LiveTrial PC only | `http://127.0.0.1:8776/` | Local LiveTrial dashboard. Sent times appear on the website. |

`127.0.0.1` always means **the device you are using**. The phone cannot open the
PC's private host administration page. Use the LAN IP displayed on the host
screen. The LAN IP varies by installation.
Keep devices on the same trusted network, without guest Wi-Fi or router port
forwarding.

## Connect a phone or second PC

1. **On the host PC**, unlock host administration with this installation's
   separate, five-minute **administrator code**. The long SHA-256 certificate
   fingerprint is not that code. Supplying the code through the public installer
   is still an open acceptance item.
2. On the other device, open `http://<LAN-IP>/setup`. Compare its **Root
   certificate SHA-256** character by character with the value on the unlocked
   host screen. HTTP cannot establish the setup page's identity on its own;
   stop if they differ.
3. Download the public `.crt` for Android/Windows, or `.mobileconfig` for
   iPhone/iPad. On Android, use the security setting to **install a CA
   certificate**; menu names vary by manufacturer. On Windows, choose **Current
   User → Trusted Root Certification Authorities**, not *Intermediate
   Certification Authorities*. On iOS, enable full trust after installing the
   profile. Remove this trust when you no longer use the installation.
4. Open `https://<LAN-IP>/` in the browser. Never bypass a certificate warning;
   recheck the installation, IP address and fingerprint if one appears.

## Sign in to a local account

1. On the **PC host screen**, the administrator creates a separate player
   account for each person. An account is not automatically linked to a Player
   or their times.
2. The administrator selects that account and issues a **one-use invitation
   QR**. This is separate from the setup QR. It expires after 15 minutes and
   must only be shared with its intended player.
3. Open the invitation on a device that already trusts the CA, confirm sign-in,
   and check the account name. An expired or used invitation requires a new one.
   The ordinary **Sign in** button in the current QA build still shows the
   online email flow; use the invitation for this offline test.
4. Link a Player only through the existing explicit claim flow. An invitation
   or matching display name never does that automatically.

## LiveTrial on a second Windows PC

Tested on a QA installation with LiveTrial 3.37.0 (2026-11-10). Without an
email server, sign-in only works through the approval page.

1. Make the PC trust the installation first (steps 2–3 of *Connect a phone or
   second PC*; on Windows: **Current User → Trusted Root Certification
   Authorities**, which asks for one Windows confirmation). Check that
   `https://<LAN-IP>/` opens in the browser without a warning.
2. Make sure your account has a **Player** on the website. Without one,
   LiveTrial's sign-in ends with a message to set up your Player on the
   community website first.
3. Open LiveTrial, click the gear (**Settings**) and enter `https://<LAN-IP>`
   under **Community website address**. LiveTrial then restarts; if it does
   not, quit it and open it again. Accounts and waiting runs for another
   server stay with that server.
4. Click **Sign in** and choose **Open the approval page**. In the browser,
   sign in with your invitation if you have not yet, check that the site shows
   the same code, and approve the device. LiveTrial then lists your Player as
   a signed-in account.
5. Send saved runs with **Send now** (or turn on **Send new runs
   automatically** in Settings). The time then appears on the installation's
   website.

When you stop using this PC with the installation, remove the certificate
from *Trusted Root Certification Authorities* again.

## Pair the Android app

Tested on a QA installation with a test build of the app (2026-11-10); no
released app contains this pairing yet. The app does not need the
certificate trusted in Android's settings.

1. In the app open **Settings → Change server → Home or club installation
   (scan QR)** and allow the camera.
2. Scan the setup QR on the host screen (the same QR that opens the setup page
   in an ordinary camera). If scanning fails, paste the setup link from the
   host screen.
3. Compare the address and the **Root public key SHA-256 (SPKI)** with the
   host screen and choose **Connect**, then confirm the server change. The app
   then trusts this installation, and only for that address.
4. Choose **Sign in to synchronize**. The browser opens the approval page;
   approve the device with your account (the browser must be signed in, for
   example through your invitation).
5. Times you post in the app appear on the installation's website.

**Settings → Change server → Forget this installation** removes the pairing.

The website defaults to **System** appearance on a new device. A phone set to
Light therefore shows the light site even if the PC shows Dark. After sign-in,
choose **Account → Settings → Appearance → Dark** if you prefer the dark look.
That choice is saved with the account; **System** continues to follow each
device's own setting.
