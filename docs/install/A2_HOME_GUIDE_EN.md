# MK8DX at home or at your club — manual

MK8DX runs on one Windows computer in your own network. Everyone on the same Wi-Fi or wired network can join with a personal sign-in card. No internet and no cloud account are needed.

## Installing

1. Install Docker Desktop (free) and start it. Wait until it shows "Engine running".
2. Unpack the MK8DX package and double-click **Start-MK8DX-LAN.cmd**.
3. The setup opens in your browser. Click **Next** each time; everything is already set sensibly.
4. During **Install**, Windows asks once for permission to open your home network for MK8DX. Click **Yes**.
5. Enter your name for the administrator account.
6. Optionally add family, friends or club members right away (or skip this).
7. Let everyone scan their own sign-in card.

## Signing in on a phone, tablet or PC

- **First time on a device:** scan the **Prepare a device** card. That page shows how the device will trust this installation. Check that the fingerprint matches the one in MK8DX beheer.
- **Sign in:** scan your **personal card** and tap **Accept invitation**. A card works once and for 15 minutes; ask for a new one when needed.
- **Another device:** make a new card for yourself in MK8DX beheer and scan it with the other device.
- **Sign out:** from the account menu at the top right of the website.

## Administration (people and cards)

Double-click **MK8DX beheer** on the desktop of the computer that runs MK8DX. You land directly in the overview:

- **Add people:** type names, one per line, and click **Add**.
- **Make a card:** choose **Make card** next to a person and let them scan it. **Print cards** prints every card shown.
- **Card lost or handed to the wrong person?** Choose **Revoke card**; it stops working at once. **New card** also revokes that person's previous card.

Everyone then chooses or claims their own Player on the website. Names are never linked automatically.

## Everyday use

- MK8DX starts by itself whenever Docker Desktop runs. With the default choice **Start MK8DX with Windows**, Docker Desktop starts when you sign in.
- The computer running MK8DX must be on and connected whenever someone wants to play.
- **The Android app and LiveTrial on a second PC** connect with the same cards; see `docs/install/A2_OFFLINE_LAN_EN.md` in the package.

## Backups and a new computer

- With the default choice **Make a backup every night**, MK8DX writes an encrypted backup to **Documents\MK8DX-backups** every night at 03:00. The newest 7 are kept. Copy that folder to a USB stick or another drive now and then.
- A backup opens only with the **recovery code** the setup showed once. Without it a backup is useless, also for you. Keep it on paper.
- **Restoring on a new computer:** install Docker Desktop, copy the backup folder to **Documents\MK8DX-backups** (or keep the USB stick plugged in), unpack the MK8DX package and double-click **Start-MK8DX-LAN.cmd**. On the welcome screen choose **Restore a backup**, choose the backup, enter the recovery code and click **Restore**. Everyone, all times, tournaments and settings come back.
- Phones and PCs keep trusting the installation. If the new computer has a different address, everyone scans the **Prepare a device** card once and signs in again; pair apps again.

## Settings and advanced

- **Another network address:** in the setup, at *Network*, click **Advanced**. Preferably give the computer a reservation in your router so its address does not change. Did the computer get another address anyway (new router, other network)? Open **MK8DX beheer**: it notices and offers **Move**. Phones and PCs keep trusting MK8DX; they scan the **Prepare a device** card once and sign in again.
- **Updates and other installation routes** (one computer, your own server, web hosting): see the complete guide `docs/install/MK8DX_User_Guide_EN.txt` in the package.
- **For IT specialists:** everything is also available from the command line with `tooling/install.py` (for example `status`, `check`, `backup`, `maintain-ca`).

## Troubleshooting

- **"Docker Desktop is not running":** start Docker Desktop and click **Try again**.
- **A phone cannot open the site:** check that the phone is on the same network (not mobile data) and that the MK8DX computer is on.
- **A card no longer works:** cards are one-use and valid for 15 minutes; make a new one in MK8DX beheer.
- **"This recovery code does not open the backup":** check the code (upper or lower case and dashes do not matter) and choose the right backup.
