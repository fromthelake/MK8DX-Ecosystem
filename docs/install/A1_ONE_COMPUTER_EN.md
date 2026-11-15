# A1 — try MK8DX on one Windows computer

Follow this route if you only want to look around on your own PC. You need no domain, server or real outgoing
email. **Mailpit** is the local test inbox here: the sign-in mail does not go to a normal mailbox. Do not use
this route for other people on the internet. For phones and other PCs at home or at a club, use the
[A2 guide](A2_HOME_GUIDE_EN.md) instead.

## 1. Check the PC

**Where:** on your Windows computer. **Do:** check Windows 11 on x86-64, 8 GB of memory recommended and about
15 GB free disk space. **You see:** these details under **Settings → System → About** and in **This PC**.
**If it differs:** do not buy anything yet; use a suitable PC.

## 2. Install Docker Desktop

**Where:** in the browser. **Do:** open the [official Docker Desktop page for Windows](https://docs.docker.com/desktop/setup/install/windows-install/),
download Docker Desktop and run the installer. Choose the WSL 2 / Linux containers option and allow Windows to
install it. Restart the PC if the installer asks. Then start **Docker Desktop** from Start and wait.
**You see:** "Engine running" at the bottom left. **Check:** open **PowerShell** and run `docker compose version`;
it prints a version.

## 3. Install Python

**Where:** in the browser. **Do:** download Python 3.12 to 3.15 (3.15 is fine) for Windows from
[python.org](https://www.python.org/downloads/windows/). Run it, tick **Add python.exe to PATH** and choose
**Install Now**. Close PowerShell and open a new window. **You see:** `python --version` shows a version from 3.12 to 3.15.
**If it differs:** Windows may start the Microsoft Store alias; run the python.org installer again with the PATH
option and open a new PowerShell window.

## 4. Check and unpack the package

**Where:** in your **Downloads** folder. **Do:** download `mk8dx-host-local-<version>-amd64.zip` and
`SHA256SUMS.txt` from the newest release. In PowerShell in that folder run
`Get-FileHash .\mk8dx-host-local-<version>-amd64.zip -Algorithm SHA256` and compare the whole value with the
file's line in `SHA256SUMS.txt`. Then right-click the ZIP → **Extract All** and choose for example
`Documents\MK8DX-A1` (not inside the `Documents\MK8DX` folder of an A2 installation). **You see:** `Start-MK8DX.cmd`, `compose.yaml` and the folders `tooling`, `images` and
`docs`. **If it differs:** you are probably one folder too high, or you downloaded GitHub's *Source code (zip)*;
open the folder where `Start-MK8DX.cmd` really is.

## 5. Let MK8DX set itself up

**Where:** in the extracted folder. **Do:** double-click `Start-MK8DX.cmd`. A window opens with a short race intro
(the MK8DX logo and a 3-2-1-GO countdown with beeps; `Start-MK8DX.cmd -SkipCountdown` leaves it out, all options are in [ADMINISTRATION_EN.md](ADMINISTRATION_EN.md#the-start-window-display-and-options)) and checks Python and Docker (steps 1/4 to 3/4). The first time it loads the included programs, which
takes a few minutes; a clock keeps counting. Then it asks **Where will MK8DX run?**: type `A1` and press Enter.
Next it asks the email address that **you** will sign in with and become administrator with. **You see:** the first
setup starts by itself and ends with `OK  Done.`, then **Website:** (for example `http://127.0.0.1:18080`) and
**Sign-in mail arrives in the local test inbox:** (for example `http://127.0.0.1:18025`). The ports can differ: use the ones shown.
**If it differs:** the window says which step did not finish and why; fix it (for example start Docker Desktop)
and type **1** in the menu to finish the setup.

## 6. Sign in

**Where:** in the browser **on the same PC**. **Do:** type **8** in the menu (or open the Website address yourself),
click **Sign in** and enter exactly the address from step 5. Open the test inbox address in a second tab, open the
newest mail and click its sign-in link. A new account first gets three short screens: whether your times are
already on this website (choose **No** twice, then **Continue**), your racing name (**Create my Player**) and a few
optional choices (**Save and finish** or **Skip for now**). **You see:** the website shows that you are signed in; **Tracks** shows
the tracks with Nintendo Staff ghosts and world records. **If it differs:** check that you use the inbox and the
address of this installation and that the link is still valid.

## 7. Make yourself administrator

**Where:** in the same black window. **Do:** type **5** (*Make me administrator*) and press Enter, after step 6
worked. **You see:** `created` (or `unchanged` when you did it before) and `OK  Done.` Reload the website: the
administration appears for your account. **If it differs:** check that you signed in with exactly the saved
address in this installation.

## 8. Try it

**Where:** on the website. **Do:** open **Tracks**, choose a cup and a track, click **Post your time**, type the
six digits of your time and choose **Publish** and then **Confirm and publish**. Optionally open `/scanner/`, choose
**GALLERY** and pick a photo of a result screen. **You see:** your time on the track's leaderboard and on your home
page; the scanner shows the total time, the lap times and the kart combination it read.

## Coming back later

Start Docker Desktop, open the same folder and double-click `Start-MK8DX.cmd`. The menu stays open until you type
**0**:

| Type | Does |
| --- | --- |
| 1 | first setup, or finish an interrupted one |
| 2 | start MK8DX |
| 3 | check that everything works |
| 4 | stop MK8DX (keeps all data) |
| 5 | make the saved address administrator |
| 6 | make a backup in `Documents\MK8DX-backups` and check it right away |
| 7 | update to the package you started the window from (a checked backup first): extract a newer package next to the old one and start its `Start-MK8DX.cmd` |
| 8 | open the website |
| 0 | close the window |

**Updating to 0.2.3:** this version moves the database from MySQL 8.4 to 9.7 LTS. MySQL upgrades the data files
once, at the first start on the new version; only a backup can undo that. So in the new package folder type **7** (update)
first: it makes a checked backup and applies the database updates. From 0.2.4 on, **2** (start) refuses until the
update has run; with a 0.2.3 package, 2 would skip the backup. **3** (check) is harmless.

**Automatic backup:** MK8DX also makes a checked backup by itself every night (03:15, or as soon as the computer
is on again) in `Documents\MK8DX-backups\automatic`, keeping 14 days and 4 weeks. **3** (check) shows the age and
result of the last one under `automaticBackup`; `"enabled": true` means it is on. With the 0.2.6 package the first
setup could not switch it on (it says *Nightly automatic backup could not be switched on*) and an update does not
switch it on either: run the line below once from a newer package. Run it in PowerShell in the package folder; it also
copies every backup to another drive or a NAS (leave out `--copy-to ...` if you have none):
`python tooling/install.py backup-schedule --state-dir "$env:LOCALAPPDATA\MK8DX\Server" --copy-to 'D:\MK8DX-backups'`.
`backup-run` instead of `backup-schedule` makes one right away. Turn it off with `backup-unschedule`. Details: [Administration](ADMINISTRATION_EN.md#automatic-daily-backup).

**Database accounts:** the website signs in to its database with its own account (`mk8dx_runtime`) that can only read and write data; database updates use the database's own account (`mk8dx_app`). Setup creates both; an older installation gets them at its next update (**7**), and if the website does not start with the new account the update returns to the old one. **3** (check) shows `"databaseAccounts": "separate"`. Details: [Operations](../OPERATIONS.md#database-accounts).

Your data stays in `%LOCALAPPDATA%\MK8DX\Server` and in Docker; a newer package replaces only the program folder.
Never run `docker compose down -v` (only when removing, below). Restoring a backup on another computer: the chapter *Back up, restore, and update* in the
[user guide](MK8DX_User_Guide_EN.txt), or [ADMINISTRATION_EN.md](ADMINISTRATION_EN.md#restoring-without-wiping-the-current-installation).

## Removing MK8DX from this computer

This deletes the database, the accounts and the keys of this installation; make a backup first (**6**) if you may
want anything back. In PowerShell in the package folder:

1. `python tooling/install.py backup-unschedule --state-dir "$env:LOCALAPPDATA\MK8DX\Server"` (the nightly backup).
2. Double-click `Start-MK8DX.cmd` and type **4** (stop), then **0**.
3. `docker compose --env-file "$env:LOCALAPPDATA\MK8DX\Server\compose.env" -f compose.yaml -f compose.local.yaml -f compose.images.yaml down -v`
   removes the containers and the database.
4. `Remove-Item -LiteralPath "$env:LOCALAPPDATA\MK8DX\Server" -Recurse -Force` removes the keys and settings.
5. `python tooling/remove_images.py` removes the programs. It keeps every image another installation or program
   on this computer still uses (an A2 installation, for example) and says which.
6. Delete the package folder, and in `Documents\MK8DX-backups` the backups you no longer need.

**You see:** the website and the test inbox no longer answer, and `docker ps -a` shows no `mk8dx-os-…` containers
of this installation. Details: [Host a community server](../guides/HOSTING.md#remove-an-installation).
