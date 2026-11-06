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

The website defaults to **System** appearance on a new device. A phone set to
Light therefore shows the light site even if the PC shows Dark. After sign-in,
choose **Account → Settings → Appearance → Dark** if you prefer the dark look.
That choice is saved with the account; **System** continues to follow each
device's own setting.
