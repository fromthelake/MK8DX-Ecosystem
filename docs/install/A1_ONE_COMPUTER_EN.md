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

**Where:** in the browser. **Do:** download Python 3.12 or newer (3.15 is fine) for Windows from
[python.org](https://www.python.org/downloads/windows/). Run it, tick **Add python.exe to PATH** and choose
**Install Now**. Close PowerShell and open a new window. **You see:** `python --version` shows 3.12 or higher.
**If it differs:** Windows may start the Microsoft Store alias; run the python.org installer again with the PATH
option and open a new PowerShell window.

## 4. Check and unpack the package

**Where:** in your **Downloads** folder. **Do:** download `mk8dx-host-local-<version>-amd64.zip` and
`SHA256SUMS.txt` from the newest release. In PowerShell in that folder run
`Get-FileHash .\mk8dx-host-local-<version>-amd64.zip -Algorithm SHA256` and compare the whole value with the
file's line in `SHA256SUMS.txt`. Then right-click the ZIP → **Extract All** and choose for example
`Documents\MK8DX\host`. **You see:** `Start-MK8DX.cmd`, `compose.yaml` and the folders `tooling`, `images` and
`docs`. **If it differs:** you are probably one folder too high, or you downloaded GitHub's *Source code (zip)*;
open the folder where `Start-MK8DX.cmd` really is.

## 5. Let MK8DX set itself up

**Where:** in the extracted folder. **Do:** double-click `Start-MK8DX.cmd`. A black window opens, shows the MK8DX
banner and checks Python and Docker (steps 1/4 to 3/4). The first time it loads the included programs, which
takes a few minutes; a clock keeps counting. Then it asks **Where will MK8DX run?**: type `A1` and press Enter.
Next it asks the email address that **you** will sign in with and become administrator with. **You see:** the first
setup starts by itself and ends with `OK  Done.`, the **Web origin** (for example `http://127.0.0.1:18080`) and the
**Local mail inbox** (for example `http://127.0.0.1:18025`). The ports can differ: use the ones shown.
**If it differs:** the window says which step did not finish and why; fix it (for example start Docker Desktop)
and type **1** in the menu to finish the setup.

## 6. Sign in

**Where:** in the browser **on the same PC**. **Do:** type **8** in the menu (or open the Web origin yourself),
click **Sign in** and enter exactly the address from step 5. Open the Local mail inbox in a second tab, open the
newest mail and click its sign-in link. **You see:** the website shows that you are signed in; **Tracks** shows
the tracks with Nintendo Staff ghosts and world records. **If it differs:** check that you use the inbox and the
address of this installation and that the link is still valid.

## 7. Make yourself administrator

**Where:** in the same black window. **Do:** type **5** (*Make me administrator*) and press Enter, after step 6
worked. **You see:** `created` (or `unchanged` when you did it before) and `OK  Done.` Reload the website: the
administration appears for your account. **If it differs:** check that you signed in with exactly the saved
address in this installation.

## 8. Try it

**Where:** on the website. **Do:** open **Tracks**, choose a track and use **Submit a Time Trial**. Optionally open
`/scanner/` and upload a photo of a result screen. **You see:** your submission in your account. A submission and
public approval are separate steps.

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
| 7 | update to the package you started the window from (a checked backup first) |
| 8 | open the website |
| 0 | close the window |

Your data stays in `%LOCALAPPDATA%\MK8DX\Server` and in Docker; a newer package replaces only the program folder.
Never run `docker compose down -v`. Restoring a backup on another computer: [Operations](../OPERATIONS.md).
