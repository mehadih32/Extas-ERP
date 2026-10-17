# Running Extas ERP on an Azure Ubuntu server

Everything runs on one Ubuntu 24.04 server, in Docker:

| Part        | What it does                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| **db**      | PostgreSQL 16, the database. Only the app can reach it; it is never open to the internet.                             |
| **migrate** | Brings the database up to date with the code each time the ERP is installed or updated, then stops.                   |
| **app**     | The ERP itself, with its clocks (backup, reminders, housekeeping) and background jobs (signed PDFs).                  |
| **caddy**   | HTTPS. Gets a free Let's Encrypt certificate for the ERP's web address, renews it, and sends `http://` to `https://`. |

The data lives in one folder on the server, `/srv/extras-erp` unless you choose another:

| Folder           | What is in it                                                                     |
| ---------------- | --------------------------------------------------------------------------------- |
| `postgres/`      | The database files                                                                |
| `uploads/`       | Uploaded and generated files: logos, bill scans, packing lists, printed documents |
| `backups/`       | The daily backups, one folder per day                                             |
| `safety-copies/` | Copies of the database taken just before each update and each restore             |
| `caddy/`         | The HTTPS certificate                                                             |
| `deploy-logs/`   | The logs of the automatic updates, the newest 30                                  |

The scripts in this folder do all the work. Each one explains itself at the top.

| Script                 | When to run it                                                         |
| ---------------------- | ---------------------------------------------------------------------- |
| `setup-server.sh`      | Once, on a new server: updates, Docker, firewall, security updates     |
| `configure.sh`         | Once: asks for the web address and the owner, makes the passwords      |
| `deploy.sh`            | To install, and again after every update                               |
| `create-owner.sh`      | Once, after the first install: the owner's account and the companies   |
| `setup-auto-deploy.sh` | Once, to let GitHub install each update by itself                      |
| `auto-deploy.sh`       | Run by GitHub after each merge: gets the newest code, then `deploy.sh` |
| `status.sh`            | Any time: is everything running, latest backups, free disk space       |
| `logs.sh`              | When something looks wrong                                             |
| `restore.sh`           | To put the ERP back to a backup                                        |
| `go-live.sh`           | After a restore left this server on standby, once it is the one to use |

Until the screens are built, the ERP answers its API only (for example `/api/health`); the
home page shows "not found".

## 1. Create the server on Azure

In the [Azure portal](https://portal.azure.com), open **Virtual machines → Create → Azure
virtual machine** and fill in:

- **Basics**
  - Resource group: a new one, for example `extras-erp`.
  - Region: one close to Bangladesh, such as **Central India** or **Southeast Asia**.
  - Image: **Ubuntu Server 24.04 LTS - x64 Gen2**.
  - Size: **Standard_B2ms** (2 vCPUs, 8 GB memory) is recommended. **Standard_B2s** (4 GB)
    is the smallest that works.
  - Authentication type: **SSH public key**. Username: `erpadmin`. Let Azure generate a new
    key pair and download the `.pem` file when asked. Keep it safe: it is the key to the
    server.
  - Inbound ports: allow **SSH (22)**, **HTTP (80)** and **HTTPS (443)**.
- **Disks**: OS disk size **64 GB**, type **Premium SSD** (Standard SSD also works).
- **Management**: leave **Auto-shutdown** off. Turning on **Backup** is recommended: Azure
  then keeps a daily copy of the whole server, a second safety net next to the ERP's own
  backups (it costs a little extra).

Create the server and open it when it is ready. Note its **Public IP address**, and check
under **Networking** that the IP is **Static**. In the same place, edit the SSH (22) rule
and set its **Source** to **My IP address**, so only your office can sign in to the server.
(Automatic updates need it open to everyone; see
[Updating by itself after each merge](#updating-by-itself-after-each-merge).) The web ports
(80 and 443) stay open to everyone.

## 2. Point the web address at the server

Choose the ERP's address, for example `erp.yourcompany.com`. Where your domain's DNS is
managed, add an **A record**: name `erp`, value the server's public IP. If the DNS is on
Cloudflare, set the record to **DNS only** (grey cloud).

The certificate can only be issued once the address reaches the server. Check it from your
computer with `ping erp.yourcompany.com`: it should show the server's IP. This can take from
a few minutes to an hour.

## 3. Sign in to the server and get the code

From a terminal on your computer (Windows Terminal, PowerShell or macOS Terminal):

```bash
ssh -i path/to/your-key.pem erpadmin@SERVER_IP
```

Then, on the server, download the code into `/opt/extras-erp`:

```bash
sudo git clone https://github.com/mehadih32/Extas-ERP.git /opt/extras-erp
cd /opt/extras-erp
```

If the repository is private, give the server its own read-only key instead:

```bash
sudo ssh-keygen -t ed25519 -N "" -f /root/.ssh/extras-erp-deploy
sudo cat /root/.ssh/extras-erp-deploy.pub
```

Add the line it prints on GitHub under the repository's **Settings → Deploy keys → Add deploy
key** (leave "Allow write access" off), then clone with it (answer `yes` if asked about
GitHub's fingerprint):

```bash
sudo git clone -c core.sshCommand="ssh -i /root/.ssh/extras-erp-deploy" \
  git@github.com:mehadih32/Extas-ERP.git /opt/extras-erp
cd /opt/extras-erp
```

Every command from here on is run in `/opt/extras-erp`.

## 4. Prepare the server

```bash
sudo ./deploy/setup-server.sh
```

It installs the system updates and Docker, turns on automatic security updates (with a
restart at 04:30 Bangladesh time when an update needs one), lets only SSH, HTTP and HTTPS
through the firewall, and adds a swap file. It is safe to run again.

## 5. Enter the settings

```bash
sudo ./deploy/configure.sh
```

It asks for the web address, an email for certificate notices, the owner's email and name,
the company names and the data folder (press Enter to accept a suggestion in brackets). It
makes strong passwords and keys itself and saves everything in `deploy/.env`, which only
the administrator can read.

**Keep a copy of `deploy/.env`** in a password manager: show it with `sudo cat deploy/.env`.
It is not part of the backups, and its `ENCRYPTION_KEY` keeps the Google Drive connection
working if the ERP ever moves to a new server.

## 6. Install and start the ERP

```bash
sudo ./deploy/deploy.sh
```

The first run takes about 5 to 15 minutes: it downloads and builds everything, creates the
database, gets the HTTPS certificate and starts the ERP. When it finishes, open
`https://erp.yourcompany.com/api/health` in a browser. It should show `"status":"ok"`.

## 7. Create the owner's account

```bash
sudo ./deploy/create-owner.sh
```

It creates the platform owner's account and the companies. Each company starts with its
built-in roles, chart of accounts, warehouse, sizes, expense and cost heads and HR rules.
It prints the owner's **temporary password** once: save it. The owner is asked to change
it at the first sign-in. Running it again only adds what is missing.

## Backups

**Twice a day, at 02:00 and 14:00 Bangladesh time,** the ERP backs up everything, every
company. The owner sets the schedule on the Backups screen (**Settings → Backups**): every
N hours, every N days, or on chosen weekdays, at chosen times. Each backup is complete, so
a restore needs nothing else (no old server, no GitHub sign-in):

- `database.dump`: the whole database
- `media.tar.gz`: every uploaded and generated file
- `code.bundle`: the code at the exact version that made the backup (a git bundle)
- `settings.env`: this server's `deploy/.env`, every secret in it (locked, below)
- `server.json`: the facts a new server needs (its `ENCRYPTION_KEY`, the web address, the
  Google client and the Cloudflare token)
- `manifest.json`: the row count of every table and the size and checksum of every file
- `backup-keys.json` and the restore guide PDFs (Bangla and English)

`deploy.sh` leaves the code bundle, the version, `deploy/.env` (locked) and that version's
`bootstrap.sh` and `restore-tool.py` in `/srv/extras-erp/backups/.host` at every update, for
the backups to take. The ERP also keeps the last two, as `restore.sh` and `restore-tool.py`,
beside the guide in the Drive backup folder: a restore then needs nothing from GitHub (the
guide's R06 says how). The plain
settings never leave the server: `scripts/lock-settings.ts` locks them in the tools image,
with no network, for the owner's public key.

**Locking: the owner's own recovery key.** The owner sets a recovery key on the Backups
screen with the PIN: any word or sentence they like (it is never made up for them), typed
twice, and they can change it there. The ERP makes a key pair from it: the server keeps
only the public key, which locks every backup; the private key is locked with the recovery
key (`backup-keys.json`). The recovery key itself is never stored on the server. With
**Keep my recovery key in Google Drive** on (the default), `restore-key.json` and the
restore guide in the Drive backup folder hold it, so a restore fills it in by itself; keep
2-Step Verification on for that Google account.

**Where the backups are kept.** Each backup is sent to a folder of its own inside "Extas ERP
Backups" in the owner's Google Drive (scope `drive.file` only) and checked there byte for
byte. The newest 4 stay on the server too (the owner picks 3 to 7); Drive keeps them for
the days the owner sets (90 by default, or for ever), never the newest. A backup that did
not reach Drive is sent again within the hour. The owner gets an alert in the ERP's inbox
and on Telegram when a backup fails, does not reach Drive or is late.

Until the owner has connected Google Drive and set the recovery key, backups stay on the
server, unlocked, and the Backups screen says so. To set it up (the Help Center has the
same steps in Bengali, under Settings):

1. **Google Cloud, once**: in the [Google Cloud console](https://console.cloud.google.com)
   make a project, enable the **Google Drive API**, set up the **OAuth consent screen**
   (External) with the one scope `drive.file`, and press **Publish app** so it is **In
   production**: while it is in "Testing", Google ends the connection after 7 days. Then
   under **Credentials** make an **OAuth client ID** of the type **TVs and Limited Input
   devices**. Paste its ID and secret on the Backups screen ("Save the Google client").
2. **Connect Google Drive** on the Backups screen: it shows a code to enter at
   google.com/device on a phone. No web address needs to be registered with Google.
3. **Set the recovery key** with the PIN.
4. **Cloudflare (optional)**: a token that can only edit DNS for the domain, saved once on
   the Backups screen, so a restore points the web address at the new server by itself and
   gets HTTPS with Cloudflare's proxy on (the DNS challenge).

**Safety copies.** Before every update and every restore, the scripts save a copy of the
database in `/srv/extras-erp/safety-copies/`, for the automatic rollback. It stays on the
server for 24 hours (a cron job clears older ones) and is also locked and sent to Drive.

**The monthly restore drill.** Once a month (day 1 at 04:00 by default) the ERP downloads
the newest backup from Drive, opens it with the recovery key kept in Drive and restores it
into a temporary database of its own (`extas_restore_test_…`, never the live or the demo
database), compares every table's row count and every file's checksum with the backup's
manifest, checks every journal entry is balanced, and drops it. The result goes to the
owner's inbox and Telegram. Without the key in Drive it checks the checksums only, unless
the owner types the key in **Run drill now**.

## Restoring a backup

**From the Backups screen** (the usual way): pick a backup in the "Backups in Google Drive"
list, press **Restore**, give the PIN and type `RESTORE`. The ERP downloads it, checks every
file, opens it with the recovery key and hands it to the server. On the server,
`deploy/restore-request.sh` (started by a systemd path unit that `deploy.sh` installs) runs
`restore.sh`: a safety copy of the database first, then the restore, then every screen is
opened to check it. When the ERP does not start on the restored data, it goes back to the
safety copy by itself. The owner gets the result in the inbox.

**By hand**, for a backup folder on the server (unlocked):

```bash
sudo ./deploy/restore.sh /srv/extras-erp/backups/2026-10-04_020000
```

It checks the backup's files against their checksums, asks you to type `RESTORE`, saves a
safety copy of the database as it is now, then puts back the database and the uploaded
files and starts the ERP again. The database is restored in one step: if anything goes
wrong, it is left exactly as it was. The files that were there before are kept next to the
new ones (`uploads.before-restore-…`). Add `--check` to open every screen afterwards.

To undo a restore, restore the safety copy it names at the end:

```bash
sudo ./deploy/restore.sh /srv/extras-erp/safety-copies/before-restore-2026-10-05_101500
```

## Moving to a new server

If the server is lost, or to move to a bigger one, one command brings the whole ERP back
on a fresh Ubuntu 24.04 server from a backup in Google Drive. The **restore guide** says
every step for a beginner, from making the Azure VM to checking the ERP, with every error
code (R01…, W01…) and what to do: it is in the Drive backup folder (with "Your restore
details": the Google client, and the recovery key while it is kept in Drive), inside every
backup, on the Backups screen ("Download the restore guide") and in the Help Center. It is
made again every month and whenever anything in it changes.

The command is pinned to the running version and checks the script before running it:

```bash
c=<commit> &&
curl -fsSL https://raw.githubusercontent.com/mehadih32/Extas-ERP/$c/deploy/bootstrap.sh -o restore.sh &&
echo "<sha256> restore.sh" | sha256sum -c &&
sudo bash restore.sh $c
```

The Backups screen and the guide show it with the real commit and checksum. The script
(`deploy/bootstrap.sh`) holds no secret and needs no GitHub sign-in; the repository must
stay public for `raw.githubusercontent.com` to serve it. It:

1. checks the server (Ubuntu 22.04 or newer, 4 GB memory, 20 GB free disk) and looks for an
   Extas ERP already on it: a restore over a running ERP goes on only when its web address
   is typed, and its own `ENCRYPTION_KEY` is never replaced (the backup's goes in
   `ENCRYPTION_OLD_KEYS`);
2. downloads `deploy/restore-tool.py` from the same commit and checks its SHA-256;
3. asks for the Google client (hidden input), shows a Google sign-in code to enter on a
   phone, lists the backups newest first (Enter: the newest), downloads the one picked and
   checks every file; reads the recovery key from Drive, or asks for it (hidden);
4. puts the code from the backup in `/opt/extras-erp` and writes `deploy/.env` from the
   backup's settings;
5. points the web address (and the demo site's) at this server in Cloudflare with the saved
   token, only when the web address is typed (Enter leaves it), and says so first when the
   ERP still answers from the old server; or says which A record to change. Until the web
   address points here, the restored ERP waits **on standby** (`/srv/extras-erp/backups/.standby`):
   it opens, but runs no clock (no backups, reminders, jobs or Bug Guard schedule), so two
   ERPs never run at once. A practice restore is therefore safe. `sudo ./deploy/go-live.sh`
   (the web address typed again) ends the standby once this server is the one to use;
6. installs Docker and the rest (`setup-server.sh`), installs the ERP (`deploy.sh`; HTTPS by
   Cloudflare's DNS challenge when a token is saved, otherwise the usual HTTP challenge),
   restores the database and the files (`restore.sh --check`) and starts the demo site;
7. runs the checks (the full check, then Bug Guard on every company with
   `bug-guard.sh`), compares every table and file with the backup's manifest and says "All N
   records and M files are back", or exactly what is missing.

Secrets never go on a command line, on the screen or in the log
(`/var/log/extas-erp-restore.log`), and the opened backup is deleted when the command ends.
After it, run `sudo ./deploy/setup-auto-deploy.sh` on the new server for updates after each
merge. The restore drill on GitHub (`.github/workflows/restore-drill.yml`) runs this command,
as the guide prints it, on a fresh virtual machine for every change to the backups or the
deploy scripts, and reports how long it took. A smaller Azure server takes longer to build,
so allow 20 to 30 minutes there.

To see whether a server already has Extas ERP, without changing anything:
`bash restore.sh --find`.

## HTTPS behind Cloudflare

With Cloudflare's proxy on (the orange cloud), Let's Encrypt cannot check the server over
port 80. When `CLOUDFLARE_API_TOKEN` is in `deploy/.env` (the restore puts there the token
saved on the Backups screen), `deploy.sh` builds Caddy with Cloudflare's DNS module
(`deploy/caddy`, from exact versions: Caddy 2.11.7 and the module v0.2.4; built again every
30 days for base-image fixes, and at once when `deploy/caddy` changes) and writes `tls/cloudflare.caddy` in the data folder,
so certificates come through Cloudflare's DNS check instead. It checks the result first
(`caddy validate`); if the module cannot be built or the check fails, it says "Note W06" and
plain Caddy runs as before. Without a token nothing changes: plain `caddy:2-alpine` and the
usual check over port 80.

The token needs only **Zone → DNS → Edit** for the one domain (the Backups screen and the
Help Center show the steps). It is sealed in the database and, inside every backup, locked
with the owner's recovery key.

Behind the proxy every visitor reaches the server from a Cloudflare address. The Caddyfile
(`servers` block) trusts only Cloudflare's published ranges (https://www.cloudflare.com/ips)
to name the visitor (`CF-Connecting-IP`), and hands the app that one address, so sign-ins,
the audit log and Bug Guard's blocks see the real visitor. Anyone not coming through
Cloudflare is known by their own address, whatever headers they send. If Cloudflare ever
changes its list, update the `trusted_proxies` line.

## Updating to a new version

```bash
cd /opt/extras-erp
sudo git pull
sudo ./deploy/deploy.sh
```

`deploy.sh` builds the new version while the old one keeps running, saves a safety copy of
the database, brings the database up to date, restarts the ERP and then opens every screen
(and prints the booking PDFs) the way the owner would, to check the new version. The ERP
pauses for less than a minute. When the update changes the database, the ERP closes to its
users for a few minutes instead, from just before the safety copy until the check has
passed, so nothing typed in that time can be lost.

**A failed update goes back by itself.** When the new version cannot be built, or the
safety copy of the database cannot be saved (a full disk, for example), nothing changes:
the version that ran before keeps running, and the new one never starts. When the
database is not running, the update is not installed at all, because no safety copy can be
saved. With less than 5 GB free, `deploy.sh` first clears every old build step
(`docker builder prune -a`) and unused images, then measures the free space again; under
3 GB even then, it stops before changing anything. When it does not start, or a screen or a PDF does not work in the check,
`deploy.sh` goes back to the version that ran before it (kept as the `extras-erp-app:previous`
and `extras-erp-tools:previous` images), and to the `before-update-…` safety copy of the
database when the update had changed the database. If putting the database back fails,
the earlier version still starts on the database as it is, so the ERP is never left down,
and the run says to restore the safety copy by hand. It then stops with the reason, so the
**Deploy** run on GitHub shows a red cross and lines saying "Went back". The full log on the
server says what failed.

To go back by hand to an older version, find it with
`sudo git log --oneline -5`, then run `sudo git checkout <its code>` and
`sudo ./deploy/deploy.sh`. If the update changed the database, also restore the
`before-update-…` safety copy taken just before it. `sudo git checkout main` returns to the
latest version. With automatic updates on, the next merge also returns to it; to stay on the
earlier version for a while, turn them off first (below).

## Updating by itself after each merge

Once this is set up, GitHub installs each new version by itself: after every merge into
`main`, it signs in to the server and runs `deploy/auto-deploy.sh`, which gets the code
and runs `deploy.sh`. GitHub sends the exact commit its Checks passed on, and the server
installs that commit, never a newer one that has not been checked (if the server already
has newer code, nothing is installed and the run says so). Before it touches the server, the **Deploy** workflow runs the
**Checks** on the merged code (types, lint, formatting, every test with a throwaway
database, and the production build); when one fails, the server is not touched and the
run shows a red cross at **Checks**. The same Checks run on every pull request. The
**Deploy** workflow in the repository's **Actions** tab shows each update and its steps. The full log stays on the server, in
`/srv/extras-erp/deploy-logs/`, because anyone can read the Actions logs while the
repository is public.

Set it up once:

1. **On the server**, get the newest code and make GitHub's key:

   ```bash
   cd /opt/extras-erp
   sudo git pull
   sudo ./deploy/setup-auto-deploy.sh
   ```

   The key can only run the update: it cannot open a shell, copy files or reach anything
   else on the server. The script prints what GitHub needs, then deletes the private half of
   the key from the server.

2. **On GitHub**, open the repository's **Settings → Secrets and variables → Actions**, and
   add each of these with **New repository secret**:

   | Name              | Value                                                                                |
   | ----------------- | ------------------------------------------------------------------------------------ |
   | `SERVER_IP`       | The server's public IP address, the one you sign in to it with                       |
   | `USERNAME`        | The account the script printed, for example `erpadmin`                               |
   | `SSH_PRIVATE_KEY` | The whole key it printed, from the `-----BEGIN` line to the `-----END` line included |
   | `SSH_HOST_KEY`    | The line it printed that starts with `ssh-ed25519`                                   |

3. **In Azure**, open the server's **Networking**, edit the **SSH (22)** rule and set its
   **Source** to **Any**. GitHub's machines have a different address each time, so a rule
   for your office alone keeps them out. The server accepts keys only, never passwords (the
   script checks this before it makes the key).

4. **Try it**: in the repository's **Actions** tab, open **Deploy** and press **Run
   workflow**. It takes as long as `deploy.sh` by hand. A green tick means the server runs
   the newest version.

From then on:

- Each merge into `main` is installed by itself. A merge made during an update is installed
  right after it.
- A failed update shows a red cross in the **Actions** tab, and GitHub emails whoever made
  the merge. To read why on the server, list the logs with
  `sudo ls /srv/extras-erp/deploy-logs/`, then open the newest with `sudo less`.
- Updating by hand still works. An update or a restore started while another is running
  stops with a message instead.
- To turn automatic updates off, open **Actions → Deploy**, then **⋯ → Disable workflow**.
  To also take the key away from the server:
  `sed -i '/ extras-erp-auto-deploy$/d' ~/.ssh/authorized_keys` and
  `sudo rm /etc/sudoers.d/extras-erp-auto-deploy`.
- Running `sudo ./deploy/setup-auto-deploy.sh` again makes a new key and stops the old one.
  Put the new `SSH_PRIVATE_KEY` on GitHub afterwards.

## The demo site

A separate copy of the ERP for trying things out, at `demo.yourcompany.com`: the ERP's
address with `demo` in place of its first part (`DEMO_DOMAIN` in `deploy/.env` sets another
one). It has its own database, files and passwords, and it cannot reach the live database.
The first time it starts it gets the owner and the companies, and the first company gets the
**Five Style Polo** batch: 6,000 polo shirts in five styles, from the purchase orders to the
final CM settlement and its journal entries. A yellow **Demo site** bar runs across the top
of every page.

To turn it on:

1. Where your domain's DNS is managed, add an **A record**: name `demo`, value the same public
   IP as the ERP's own record (step 2). If the DNS is on Cloudflare, set it to **DNS only**
   (grey cloud).
2. `deploy/demo.conf` says `DEMO_SITE=on`. The next update (each merge into main, or
   `sudo ./deploy/deploy.sh`) adds the demo's own passwords and key to `deploy/.env`, starts it
   once the ERP itself is up, and gets its HTTPS certificate.
3. Open the address and sign in with the owner's email and password from the live ERP. Each
   update copies that one password hash (nothing else) from the live database.

Each update's log says whether the demo has its HTTPS certificate. Caddy can only get it once
the `demo` record points at this server, so after a new record the address shows "This site
can't provide a secure connection" for a while. Caddy keeps trying by itself, waiting longer
after each failed try, and the next update makes it try again at once. While there is still
no certificate, the log says what Let's Encrypt answered.

The ERP never waits for the demo site: if the demo does not start, the update still finishes
and says so. It needs about 1 GB more memory. Its data is in `/srv/extras-erp/demo` and is
not backed up.

To turn it off on this server, add `DEMO_SITE=off` to `deploy/.env` and run
`sudo ./deploy/deploy.sh --no-pull`; its data stays. To start it again from a fresh copy, turn
it off, delete `/srv/extras-erp/demo`, take the line out of `deploy/.env`, and run
`sudo ./deploy/deploy.sh --no-pull` again. `sudo ./deploy/logs.sh demo-app` shows its log.

## The Android app

Field staff who check in and then travel need the Android app: it keeps sharing their
location while they are checked in, with the phone in a pocket, the screen off or the app
closed (a browser only shares it while the page is open). The app is the same Extas ERP,
opened from your server, so screens update with the server and the app rarely needs a new
version. GitHub builds it; nothing is installed on the server.

1. **Tell GitHub your ERP's address.** Open the repository's **Settings → Secrets and
   variables → Actions → Variables** and add **New repository variable**: name
   `EXTAS_APP_URL`, value your ERP's address, for example `https://erp.yourcompany.com`.

2. **Build it.** In the **Actions** tab, open **Android app** and press **Run workflow**.
   When it has a green tick, open the run and download `extas-erp-android-…` under
   **Artifacts**. Inside is `app-debug.apk`.

3. **Install it.** Send the APK to staff (WhatsApp, Google Drive). On the phone, open it,
   allow installing from this source, and install. They sign in with their usual email and
   password. The first check-in asks for location and notifications: **Allow** both, and
   **Allow** Extas ERP to run in the background. The Bengali guide "ফোনে Extas ERP অ্যাপ
   বসাবেন যেভাবে" in the Help Center walks staff through it.

4. **For updates that install over the old app**, sign the app with your company's own key.
   Make the key once on any computer with Java (keep the file and passwords safe; a lost key
   means everyone uninstalls and installs again):

   ```bash
   keytool -genkeypair -v -keystore extas-erp.jks -alias extas -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 extas-erp.jks > extas-erp.jks.txt
   ```

   Then add these **repository secrets**: `ANDROID_KEYSTORE_BASE64` (the text in
   `extas-erp.jks.txt`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`extas`) and
   `ANDROID_KEY_PASSWORD`. From then on each build also makes `app-release.apk`; give staff
   that one. Each build has a higher version number, so it installs over the previous one.

The workflow also runs on every change to `mobile/`, to check the app still builds. If the
address changes, change `EXTAS_APP_URL`, build again and send the new APK.

## Everyday commands

| Command                                                | What it does                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `sudo ./deploy/status.sh`                              | Is everything running, the health check, latest backups, disk   |
| `sudo ./deploy/logs.sh` or `sudo ./deploy/logs.sh app` | Follow the logs (Ctrl+C to stop). Also `db`, `caddy`, `migrate` |
| `sudo ./deploy/deploy.sh --no-pull`                    | Restart after changing a setting, without downloading updates   |
| `sudo reboot`                                          | Restart the server; the ERP starts again by itself              |

## Outside services (SMS, push, payouts, maps)

The ERP works without these. Each is switched on by adding its settings to `deploy/.env` and
restarting (`sudo ./deploy/deploy.sh --no-pull`); HR sees where each stands under
**HR & payroll > Holidays & rules > Outside services**. "log" is a test mode: nothing leaves
the server, and each message shows in `sudo ./deploy/logs.sh app`.

- **SMS** (one-time codes when staff agree to the terms). `SMS_PROVIDER=http` works with any
  SMS gateway that has a web address to send through. Put the gateway's address in
  `SMS_HTTP_URL` with these words where the gateway expects each value: `{to}`
  (8801711000000), `{to_local}` (01711000000), `{text}`, `{sender}` (`SMS_SENDER_ID`) and
  `{key}` (`SMS_API_KEY`). For a gateway that wants a POST, also set `SMS_HTTP_METHOD=POST`
  and the body in `SMS_HTTP_BODY` (JSON such as `{"to":"{to}","message":"{text}"}`, or
  `to={to}&message={text}`). If the gateway answers "OK" even when it fails, put the text a
  real success contains in `SMS_HTTP_SUCCESS`. Until SMS is on, staff sign with a drawn
  signature instead.
- **Push notifications** (`PUSH_PROVIDER`): `log` for now; phone notifications come with the
  employee dashboard. Until then the in-app inbox carries every message.
- **bKash / Nagad payouts** (`PAYOUT_PROVIDER`): `log` for now. The wallet's own connection is
  added when the company has its payout account; until then Accounts pays and records
  salaries as today.
- **Google Maps** (`GOOGLE_MAPS_API_KEY`): a key from Google Cloud console, limited to the
  ERP's address (**Application restrictions > Websites**), for road distances on travel
  claims. The staff map does not need it: it draws on OpenStreetMap.

## Changing a setting

Edit `deploy/.env` with `sudo nano deploy/.env`, save, then run
`sudo ./deploy/deploy.sh --no-pull`. `deploy/.env.example` explains each setting. Some are
set once:

- `POSTGRES_PASSWORD`, `APP_DB_USER` and `APP_DB_PASSWORD` are stored inside the database
  when it is first created; changing them in the file does not change them there.
- `ENCRYPTION_KEY`: changing it means connecting Google Drive again.
- `DATA_DIR`: move the folder to the new place first (with the ERP stopped).
- A new web address (`APP_DOMAIN`) needs its DNS record first (step 2).

## When something goes wrong

- **The address does not open, or the browser warns about the certificate.** Check that
  `ping erp.yourcompany.com` shows the server's IP and that ports 80 and 443 are open in
  Azure (**Networking**). Then look at `sudo ./deploy/logs.sh caddy`. Caddy keeps trying,
  and the certificate arrives within a few minutes of the address being right.
- **`deploy.sh` stops with an error.** It shows the logs that say why. If the error is
  about the network or a download (for example `Exit handler never called`), run it again:
  what was already downloaded is kept.
- **The app does not start.** `sudo ./deploy/logs.sh app` shows why. After an update,
  `deploy.sh` has already gone back to the version before it (see "Updating to a new
  version"); the log in `/srv/extras-erp/deploy-logs` says what failed.
- **Someone sees "An error occurred. Error Code: ERR-…".** Ask them for the code, then look
  it up in the app's log, with the part after `ERR-`:
  `sudo docker logs extras-erp-app-1 2>&1 | grep -B 15 -A 15 7F3K9Q2M`. The lines around it
  say what failed.
- **The disk is filling up.** `sudo ./deploy/status.sh` shows the free space. Old safety
  copies in `/srv/extras-erp/safety-copies/` can be deleted, the backups can be kept for
  fewer days, or the disk can be enlarged in Azure.

## Security

- Only ports 22 (SSH, keys only; from your office only unless automatic updates are on), 80
  and 443 are open, both in Azure and in the server's own firewall. The database is never open to the internet.
- The ERP uses its own database account, which can reach only the ERP's own data.
- `deploy/.env` holds the passwords and keys. Only the administrator can read it. Never
  put it in the repository or send it by email or chat.
- Ubuntu installs security updates every day by itself.
