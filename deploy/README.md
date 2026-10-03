# Running Extras ERP on an Azure Ubuntu server

Everything runs on one Ubuntu 24.04 server, in Docker:

| Part        | What it does                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------- |
| **db**      | PostgreSQL 16, the database. Only the app can reach it; it is never open to the internet.                             |
| **migrate** | Brings the database up to date with the code each time the ERP is installed or updated, then stops.                   |
| **app**     | The ERP itself, with its clocks: the daily backup, reminders and the nightly housekeeping.                            |
| **caddy**   | HTTPS. Gets a free Let's Encrypt certificate for the ERP's web address, renews it, and sends `http://` to `https://`. |

The data lives in one folder on the server, `/srv/extras-erp` unless you choose another:

| Folder           | What is in it                                                                     |
| ---------------- | --------------------------------------------------------------------------------- |
| `postgres/`      | The database files                                                                |
| `uploads/`       | Uploaded and generated files: logos, bill scans, packing lists, printed documents |
| `backups/`       | The daily backups, one folder per day                                             |
| `safety-copies/` | Copies of the database taken just before each update and each restore             |
| `caddy/`         | The HTTPS certificate                                                             |

The scripts in this folder do all the work. Each one explains itself at the top.

| Script            | When to run it                                                       |
| ----------------- | -------------------------------------------------------------------- |
| `setup-server.sh` | Once, on a new server: updates, Docker, firewall, security updates   |
| `configure.sh`    | Once: asks for the web address and the owner, makes the passwords    |
| `deploy.sh`       | To install, and again after every update                             |
| `create-owner.sh` | Once, after the first install: the owner's account and the companies |
| `status.sh`       | Any time: is everything running, latest backups, free disk space     |
| `logs.sh`         | When something looks wrong                                           |
| `restore.sh`      | To put the ERP back to a backup                                      |

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
The web ports (80 and 443) stay open to everyone.

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

**Every day at 02:00 Bangladesh time** the ERP backs up everything (every company) into
`/srv/extras-erp/backups/<date_time>/`:

- `database.dump`: the whole database
- `media.tar.gz`: the uploaded and generated files
- `manifest.json`: the size and checksum of each file

Backups are kept for **30 days**; the newest good one is always kept. A backup missed while
the server was off runs as soon as it is back, so the first one runs a minute after the
first install. The owner can change the time, how long backups are kept and whether files
are included in the backup settings, or start a backup by hand.

**Safety copies.** Before every update and every restore, the scripts also save a copy of
the database in `/srv/extras-erp/safety-copies/`. The newest 10 update copies are kept.

**Keep a copy away from the server.** A backup that only lives on the server is lost with
the server. Use at least one of these:

- **Azure Backup** of the whole server (step 1).
- **Google Drive**, built into the ERP. Each daily backup is also uploaded to a folder in the
  owner's Google Drive, and old ones are removed there too. To set it up:
  1. In the [Google Cloud console](https://console.cloud.google.com), create a project,
     enable the **Google Drive API**, and set up the **OAuth consent screen**.
  2. Under **Credentials**, create an **OAuth client ID** of type **Web application**, with
     the authorised redirect URI `https://erp.yourcompany.com/api/backups/google/callback`.
  3. Put its client ID and secret in `GOOGLE_DRIVE_CLIENT_ID` and
     `GOOGLE_DRIVE_CLIENT_SECRET` in `deploy/.env` (`sudo nano deploy/.env`), then run
     `sudo ./deploy/deploy.sh`.
  4. The owner connects their Google account once, from the backup settings. That button
     arrives with the screens.
- **Your own computer**: copy a day's backup over SSH, from your computer:
  ```bash
  scp -i path/to/your-key.pem -r erpadmin@SERVER_IP:/srv/extras-erp/backups/2026-10-04_020000 .
  ```

## Restoring a backup

```bash
sudo ./deploy/restore.sh /srv/extras-erp/backups/2026-10-04_020000
```

It checks the backup's files against their checksums, asks you to type `RESTORE`, saves a
safety copy of the database as it is now, then puts back the database and the uploaded
files and starts the ERP again. The database is restored in one step: if anything goes
wrong, it is left exactly as it was. The files that were there before are kept next to the
new ones (`uploads.before-restore-…`).

To undo a restore, restore the safety copy it names at the end:

```bash
sudo ./deploy/restore.sh /srv/extras-erp/safety-copies/before-restore-2026-10-05_101500
```

To restore a backup from Google Drive or your computer, first copy its folder into
`/srv/extras-erp/backups/` on the server, then run `restore.sh` on it.

## Moving to a new server

If the server is lost, or to move to a bigger one:

1. Do steps 1 to 5 on the new server, and point the web address at its IP (step 2).
2. If you kept the old `deploy/.env`, copy its `ENCRYPTION_KEY` line into the new
   `deploy/.env` (`sudo nano deploy/.env`). Otherwise the owner connects Google Drive again
   after the move.
3. Run `sudo ./deploy/deploy.sh` (step 6). Skip step 7: the backup brings the accounts back.
4. Copy the latest backup folder into `/srv/extras-erp/backups/` and restore it, as above.

## Updating to a new version

```bash
cd /opt/extras-erp
sudo git pull
sudo ./deploy/deploy.sh
```

`deploy.sh` saves a safety copy of the database, builds the new version while the old one
keeps running, brings the database up to date and restarts the ERP. The ERP pauses for
less than a minute.

If an update goes wrong, go back to the version before it: find it with
`sudo git log --oneline -5`, then run `sudo git checkout <its code>` and
`sudo ./deploy/deploy.sh`. If the update changed the database, also restore the
`before-update-…` safety copy taken just before it. `sudo git checkout main` returns to the
latest version.

## Everyday commands

| Command                                                | What it does                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `sudo ./deploy/status.sh`                              | Is everything running, the health check, latest backups, disk   |
| `sudo ./deploy/logs.sh` or `sudo ./deploy/logs.sh app` | Follow the logs (Ctrl+C to stop). Also `db`, `caddy`, `migrate` |
| `sudo ./deploy/deploy.sh --no-pull`                    | Restart after changing a setting, without downloading updates   |
| `sudo reboot`                                          | Restart the server; the ERP starts again by itself              |

## Changing a setting

Edit `deploy/.env` with `sudo nano deploy/.env`, save, then run
`sudo ./deploy/deploy.sh --no-pull`. `deploy/.env.example` explains each setting. Some are
set once:

- `POSTGRES_PASSWORD`, `APP_DB_USER` and `APP_DB_PASSWORD` are stored inside the database
  when it is first created; changing them in the file does not change them there.
- `ENCRYPTION_KEY`: changing it means connecting Google Drive again.
- `DATA_DIR`: move the folder to the new place first (with the ERP stopped).
- A new web address (`APP_DOMAIN`) needs its DNS record first (step 2) and, for Google
  Drive, a new redirect URI.

## When something goes wrong

- **The address does not open, or the browser warns about the certificate.** Check that
  `ping erp.yourcompany.com` shows the server's IP and that ports 80 and 443 are open in
  Azure (**Networking**). Then look at `sudo ./deploy/logs.sh caddy`. Caddy keeps trying,
  and the certificate arrives within a few minutes of the address being right.
- **`deploy.sh` stops with an error.** It shows the logs that say why. If the error is
  about the network or a download (for example `Exit handler never called`), run it again:
  what was already downloaded is kept.
- **The app does not start.** `sudo ./deploy/logs.sh app` shows why.
- **The disk is filling up.** `sudo ./deploy/status.sh` shows the free space. Old safety
  copies in `/srv/extras-erp/safety-copies/` can be deleted, the backups can be kept for
  fewer days, or the disk can be enlarged in Azure.

## Security

- Only ports 22 (SSH, from your office only), 80 and 443 are open, both in Azure and in
  the server's own firewall. The database is never open to the internet.
- The ERP uses its own database account, which can reach only the ERP's own data.
- `deploy/.env` holds the passwords and keys. Only the administrator can read it. Never
  put it in the repository or send it by email or chat.
- Ubuntu installs security updates every day by itself.
