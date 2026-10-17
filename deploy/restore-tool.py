#!/usr/bin/env python3
"""Extas ERP restore tool: the part of the one restore command that talks to
Google Drive and Cloudflare and opens the backup (deploy/bootstrap.sh runs it;
the restore guide explains every question and every error code).

It needs nothing from the old server and no ERP: Python 3 and its
"cryptography" package (Ubuntu: python3-cryptography). Secrets are only ever
asked as hidden input, or read from files; they never go on a command line,
into a log or on the screen.

  fetch    sign in to Google with a code on the phone, list the backups newest
           first, download the one picked (Enter: the newest), check every
           file, read the recovery key from Drive (or ask for it), open the
           backup. Writes into --work: restore/ (for deploy/restore.sh),
           code.bundle, settings.env, server.json, google.json, state.json.
  env      writes the server's settings (deploy/.env) from the backup; an
           existing deploy/.env is kept, and its ENCRYPTION_KEY is never
           replaced (the backup's key is added to ENCRYPTION_OLD_KEYS).
  dns      points the ERP's and the demo site's web addresses at this server
           in Cloudflare, with the token saved on the Backups screen.
  compare  compares every table's row count and every file's checksum with
           the backup's manifest, and says in plain words what came back.
  fact     prints one fact that is not secret (for bootstrap.sh).

Answers can come from a file instead of the keyboard (restore drills only):
RESTORE_ANSWERS=<file> with lines like "pick=newest" (the file must be
readable by its owner only). GOOGLE_OAUTH_BASE, GOOGLE_DRIVE_BASE,
CLOUDFLARE_API_BASE and PUBLIC_IP point it at stand-ins in the drills.
"""

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import shutil
import socket
import ssl
import struct
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

OAUTH = os.environ.get("GOOGLE_OAUTH_BASE", "https://oauth2.googleapis.com").rstrip("/")
DRIVE = os.environ.get("GOOGLE_DRIVE_BASE", "https://www.googleapis.com").rstrip("/")
CLOUDFLARE = os.environ.get("CLOUDFLARE_API_BASE", "https://api.cloudflare.com/client/v4").rstrip("/")
SCOPE = "https://www.googleapis.com/auth/drive.file"
FOLDER = "application/vnd.google-apps.folder"
DHAKA = timezone(timedelta(hours=6))
PIECE_BYTES = 1 << 20
TAG_BYTES = 16
MAGIC = b"EXTASBK1"
PK_MAGIC = b"EXTASPK1"
KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
#: Files restore.sh reads; everything else in a backup is for this tool or bootstrap.sh.
FOR_RESTORE = ("database.dump", "media.tar.gz")


class Stop(Exception):
    """A stop with a code the restore guide explains."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def fail(code, message):
    raise Stop(code, message)


def say(text):
    print(f"\n==> {text}", flush=True)


def note(text):
    print(f"    {text}", flush=True)


def warn(code, message):
    print(f"\nNote {code}: {message}\n(Look up {code} in the restore guide's list of errors.)", flush=True)


# --- Answers: the keyboard, or the drill's answers file ------------------------------

_answers = None


def answers():
    global _answers
    if _answers is None:
        _answers = {}
        path = os.environ.get("RESTORE_ANSWERS")
        if path:
            info = os.stat(path)
            if info.st_mode & 0o077:
                fail("R25", "the answers file can be read by others; it must be readable by its owner only (chmod 600).")
            with open(path, encoding="utf-8") as f:
                for line in f:
                    if "=" in line and not line.lstrip().startswith("#"):
                        name, value = line.rstrip("\n").split("=", 1)
                        _answers[name.strip()] = value
    return _answers


def _clean(text):
    # A paste in some terminals comes wrapped in "bracketed paste" marks.
    return text.replace("\x1b[200~", "").replace("\x1b[201~", "").replace("﻿", "")


def ask(name, prompt, hidden=False):
    """One answer: from the answers file when it has it, else typed (hidden for secrets)."""
    given = answers().get(name)
    if given is not None:
        return _clean(given)
    try:
        os.close(os.open("/dev/tty", os.O_RDWR | os.O_NOCTTY))
    except OSError:
        fail("R25", f"there is no keyboard to answer \"{prompt.strip()}\". Run the command in PuTTY as the guide shows.")
    try:
        if hidden:
            # getpass asks on the terminal itself, with the typing hidden.
            value = getpass.getpass(prompt)
        else:
            # A terminal cannot seek, so it is opened once to write and once to read.
            with open("/dev/tty", "w", encoding="utf-8") as screen:
                screen.write(prompt)
                screen.flush()
            with open("/dev/tty", encoding="utf-8", errors="replace") as keyboard:
                value = keyboard.readline()
            if not value:
                raise EOFError
    except EOFError:
        fail("R25", "the keyboard closed before an answer came.")
    return _clean(value.rstrip("\r\n"))


# --- HTTP --------------------------------------------------------------------------

_context = ssl.create_default_context()


def http(method, url, data=None, headers=None, timeout=60):
    """(status, headers, body bytes); network failures become R27 after 3 tries."""
    body = None
    headers = dict(headers or {})
    if isinstance(data, dict):
        body = urllib.parse.urlencode(data).encode()
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
    elif isinstance(data, (bytes, str)):
        body = data.encode() if isinstance(data, str) else data
        headers.setdefault("Content-Type", "application/json")
    last = None
    for attempt in range(3):
        request = urllib.request.Request(url, data=body, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout, context=_context) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            return error.code, dict(error.headers or {}), error.read()
        except (urllib.error.URLError, socket.timeout, ConnectionError, ssl.SSLError) as error:
            last = error
            time.sleep(2 + attempt * 3)
    host = urllib.parse.urlparse(url).hostname
    fail("R27", f"this server could not reach {host} ({getattr(last, 'reason', last)}). Check that the VM has internet access, then paste the command again.")


def as_json(raw):
    try:
        return json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        return {}


# --- Google sign-in with a code on the phone, and Drive -------------------------------


class Google:
    def __init__(self, client_id, client_secret):
        self.client_id = client_id
        self.client_secret = client_secret
        self.access = None
        self.refresh = None

    def sign_in(self):
        status, _, raw = http("POST", f"{OAUTH}/device/code", {"client_id": self.client_id, "scope": SCOPE})
        body = as_json(raw)
        if status != 200 or "device_code" not in body:
            fail("R08", "Google did not accept the Google client ID ("
                 + str(body.get("error_description") or body.get("error") or status)
                 + "). Copy it again from \"Your restore details\" in the guide; it ends in .apps.googleusercontent.com.")
        url = body.get("verification_url") or body.get("verification_uri") or "https://www.google.com/device"
        interval = int(body.get("interval") or 5)
        deadline = time.time() + int(body.get("expires_in") or 1800)
        say("Sign in to Google on your phone")
        note(f"1. On your phone, open: {url}")
        note(f"2. Type this code:  {body['user_code']}")
        note("3. Choose the Google account that keeps the backups, then tap Continue and Allow.")
        note("Waiting for your phone...")
        while time.time() < deadline:
            time.sleep(interval)
            status, _, raw = http("POST", f"{OAUTH}/token", {
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "device_code": body["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            })
            got = as_json(raw)
            if status == 200 and got.get("access_token"):
                self.access = got["access_token"]
                self.refresh = got.get("refresh_token")
                return
            error = got.get("error")
            if error == "authorization_pending":
                continue
            if error == "slow_down":
                interval += 5
                continue
            if error == "access_denied":
                fail("R09", "Google says the sign-in was not allowed on the phone. Paste the command again and tap Allow.")
            if error == "expired_token":
                break
            if error in ("invalid_client", "unauthorized_client"):
                fail("R08", "Google did not accept the Google client secret. Copy it again from \"Your restore details\" in the guide.")
            fail("R09", f"Google sign-in failed ({error or status}). Paste the command again.")
        fail("R09", "the code was not entered on the phone in time. Paste the command again; you get a new code.")

    def _refresh(self):
        if not self.refresh:
            return False
        status, _, raw = http("POST", f"{OAUTH}/token", {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh,
            "grant_type": "refresh_token",
        })
        body = as_json(raw)
        if status == 200 and body.get("access_token"):
            self.access = body["access_token"]
            return True
        return False

    def call(self, url, what):
        for _ in range(2):
            status, _, raw = http("GET", url, headers={"Authorization": f"Bearer {self.access}"})
            if status == 401 and self._refresh():
                continue
            if status != 200:
                message = as_json(raw).get("error", {})
                message = message.get("message") if isinstance(message, dict) else message
                fail("R11", f"{what} failed in Google Drive ({message or status}). Paste the command again.")
            return as_json(raw)
        fail("R09", "Google ended the sign-in. Paste the command again.")

    def search(self, q):
        out = []
        token = None
        while True:
            params = {
                "q": q,
                "fields": "nextPageToken,files(id,name,mimeType,parents,appProperties,createdTime,size)",
                "pageSize": "1000",
                "orderBy": "createdTime",
            }
            if token:
                params["pageToken"] = token
            body = self.call(f"{DRIVE}/drive/v3/files?{urllib.parse.urlencode(params)}", "Listing the backups")
            out += body.get("files", [])
            token = body.get("nextPageToken")
            if not token:
                return out

    def download(self, file_id, to, expect_bytes=None, limit=None):
        """Downloads into `to`; returns its SHA-256. Resumes from where a cut connection stopped."""
        url = f"{DRIVE}/drive/v3/files/{urllib.parse.quote(file_id)}?alt=media"
        digest = hashlib.sha256()
        done = 0
        with open(to, "wb") as out:
            os.fchmod(out.fileno(), 0o600)
            for attempt in range(6):
                headers = {"Authorization": f"Bearer {self.access}"}
                if done:
                    headers["Range"] = f"bytes={done}-"
                request = urllib.request.Request(url, headers=headers)
                try:
                    with urllib.request.urlopen(request, timeout=120, context=_context) as response:
                        if done and response.status != 206:
                            # The server sent it all again: start over.
                            out.seek(0)
                            out.truncate()
                            digest = hashlib.sha256()
                            done = 0
                        while True:
                            chunk = response.read(PIECE_BYTES)
                            if not chunk:
                                break
                            out.write(chunk)
                            digest.update(chunk)
                            done += len(chunk)
                            if limit and done > limit:
                                fail("R11", "a file in the backup is larger than it should be.")
                    if expect_bytes is None or done >= expect_bytes:
                        return digest.hexdigest(), done
                except urllib.error.HTTPError as error:
                    if error.code == 401 and self._refresh():
                        continue
                    if error.code in (403, 404):
                        fail("R11", f"Google Drive refused the download ({error.code}). Paste the command again.")
                except (urllib.error.URLError, socket.timeout, ConnectionError, ssl.SSLError, OSError) as error:
                    if isinstance(error, OSError) and getattr(error, "errno", None) == 28:
                        fail("R22", "the disk is full. Make the VM again with a bigger disk (64 GB or more).")
                time.sleep(3 + attempt * 5)
            fail("R11", "the download kept stopping. Check the VM's internet connection and paste the command again.")


# --- Opening a locked backup (the formats of src/modules/backups/crypt.ts and keys.ts) --


def _crypto():
    try:
        from cryptography.exceptions import InvalidTag
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    except ImportError:
        fail("R05", "the Python cryptography package is missing (apt-get install python3-cryptography).")
    return {
        "InvalidTag": InvalidTag, "hashes": hashes, "serialization": serialization,
        "X25519PrivateKey": X25519PrivateKey, "X25519PublicKey": X25519PublicKey,
        "AESGCM": AESGCM, "HKDF": HKDF,
    }


def hkdf(ikm, salt, info, length=32):
    c = _crypto()
    return c["HKDF"](algorithm=c["hashes"].SHA256(), length=length, salt=salt, info=info).derive(ikm)


def b64url(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class KeyError_(Exception):
    pass


def normalize_key(typed):
    return unicodedata.normalize("NFC", typed).strip().strip("﻿").strip()


def pair_id_of(public_raw):
    return hashlib.sha256(b"extas-erp backup key pair" + public_raw).hexdigest()[:8].upper()


def parse_key_file(text):
    try:
        file = json.loads(text)
        locked = file["lockedPrivateKey"]
        ok = (file.get("kind") == "backup-keys" and file.get("version") == 1
              and locked.get("kdf") == "scrypt"
              and pair_id_of(b64url(file["publicKey"])) == file["pairId"])
    except (ValueError, KeyError, TypeError):
        ok = False
    if not ok:
        raise KeyError_("the keys file is damaged")
    return file


def open_key_file(file, recovery_key):
    """The private key (raw 32 bytes); KeyError_ when the recovery key is not the right one."""
    c = _crypto()
    locked = file["lockedPrivateKey"]
    if locked["N"] > 1 << 20 or locked["r"] > 16 or locked["p"] > 4:
        raise KeyError_("the keys file asks for too much work")
    key = hashlib.scrypt(normalize_key(recovery_key).encode("utf-8"), salt=b64url(locked["salt"]),
                         n=locked["N"], r=locked["r"], p=locked["p"], maxmem=320 * 1024 * 1024, dklen=32)
    bound = f"extas-erp backup keys v1|{file['pairId']}|{file['publicKey']}".encode("utf-8")
    try:
        d = c["AESGCM"](key).decrypt(b64url(locked["iv"]), b64url(locked["data"]) + b64url(locked["tag"]), bound)
    except c["InvalidTag"]:
        raise KeyError_("not this key")
    private = c["X25519PrivateKey"].from_private_bytes(d)
    public = private.public_key().public_bytes(c["serialization"].Encoding.Raw, c["serialization"].PublicFormat.Raw)
    if public != b64url(file["publicKey"]):
        raise KeyError_("the keys file is damaged")
    return d


def parse_key_card(typed):
    """v6.3's key card (56 letters and digits) into its 32 bytes; KeyError_ on a typo."""
    text = re.sub(r"[\s-]+", "", typed.upper()).replace("O", "0").replace("I", "1").replace("L", "1")
    if len(text) != 56 or any(ch not in KEY_ALPHABET for ch in text):
        raise KeyError_("a key card has 56 letters and digits in 14 groups of 4")
    value = 0
    for ch in text[:52]:
        value = (value << 5) | KEY_ALPHABET.index(ch)
    key = (value >> 4).to_bytes(32, "big")

    def b32(data, chars):
        bits = int.from_bytes(data, "big")
        total = len(data) * 8
        pad = (5 - total % 5) % 5
        bits <<= pad
        n = (total + pad) // 5
        out = "".join(KEY_ALPHABET[(bits >> (5 * (n - 1 - i))) & 31] for i in range(n))
        return out[:chars]

    check = b32(hashlib.sha256(b"extas-erp recovery key" + key).digest(), 4)
    if b32(key, 52) != text[:52] or check != text[52:]:
        raise KeyError_("this key card has a typo")
    return key


def legacy_backup_key(card_bytes):
    return hkdf(card_bytes, b"extas-erp backups", b"backup key v1")


def legacy_key_id(key):
    return hkdf(key, b"extas-erp backups", b"key id", 4).hex().upper()


def unlock_file(source, target, legacy=None, private=None):
    """Opens a locked file into `target`; returns the plain file's SHA-256. KeyError_ on a wrong key or damage."""
    c = _crypto()
    digest = hashlib.sha256()
    with open(source, "rb") as src, open(target, "wb") as out:
        os.fchmod(out.fileno(), 0o600)
        head = src.read(len(MAGIC))
        if head == PK_MAGIC:
            pair = src.read(8).decode("ascii", "replace")
            eph = src.read(32)
            if private is None or pair not in private:
                raise KeyError_(f"locked with another key pair ({pair})")
            me = c["X25519PrivateKey"].from_private_bytes(private[pair])
            shared = me.exchange(c["X25519PublicKey"].from_public_bytes(eph))
            mine = me.public_key().public_bytes(c["serialization"].Encoding.Raw, c["serialization"].PublicFormat.Raw)
            key = hkdf(shared, eph + mine, b"extas-erp public-key file v1")
            head = src.read(len(MAGIC))
        elif head == MAGIC:
            if legacy is None:
                raise KeyError_("locked with the old (v6.3) key card")
            key = legacy
        else:
            raise KeyError_("not a locked Extas ERP backup file")
        if head != MAGIC:
            raise KeyError_("the file is damaged")
        salt = src.read(16)
        aes = c["AESGCM"](hkdf(key, salt, b"backup file v1"))
        index = 0
        finished = False
        while True:
            size_bytes = src.read(4)
            if not size_bytes:
                break
            if finished or len(size_bytes) < 4:
                raise KeyError_("the file is damaged")
            (length,) = struct.unpack(">I", size_bytes)
            if length > PIECE_BYTES:
                raise KeyError_("the file is damaged")
            body = src.read(length + TAG_BYTES)
            if len(body) < length + TAG_BYTES:
                raise KeyError_("the file is cut short")
            nonce = b"\0\0\0\0" + struct.pack(">Q", index)
            plain = None
            for last in (0, 1):
                try:
                    plain = aes.decrypt(nonce, body, bytes([last]))
                    finished = bool(last)
                    break
                except c["InvalidTag"]:
                    continue
            if plain is None:
                raise KeyError_("not this key" if index == 0 else "the file is damaged")
            out.write(plain)
            digest.update(plain)
            index += 1
        if not finished:
            raise KeyError_("the file is cut short")
    return digest.hexdigest()


# --- fetch ---------------------------------------------------------------------------


def label(file, name):
    return (file.get("appProperties") or {}).get(name)


def size_text(n):
    if n is None:
        return "size not known"
    for unit in ("bytes", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "bytes" else f"{n:.1f} {unit}"
        n /= 1024.0


def when_text(iso):
    try:
        at = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(DHAKA)
    except ValueError:
        return iso
    return at.strftime("%A %d %B %Y, %H:%M") + " (Bangladesh time)"


def safe_name(name):
    if not re.fullmatch(r"[\w.-]+", name or "") or name.startswith("."):
        fail("R11", "the backup has an unexpected name.")
    return name


def client_from_answers():
    say("Google client (from \"Your restore details\" in the restore guide)")
    note("Paste each one with a right-click and press Enter. Nothing shows while you paste: that is normal.")
    client_id = re.sub(r"\s+", "", ask("google_client_id", "Google client ID (from \"Your restore details\"; paste with a right-click, it stays hidden): ", hidden=True))
    if not client_id.endswith(".apps.googleusercontent.com"):
        fail("R08", "that is not a Google client ID: it ends in .apps.googleusercontent.com. Copy it again from \"Your restore details\".")
    note(f"Got the client ID ({len(client_id)} characters, ending in ...{client_id[-30:]}).")
    secret = re.sub(r"\s+", "", ask("google_client_secret", "Google client secret (from \"Your restore details\"; paste with a right-click, it stays hidden): ", hidden=True))
    if len(secret) < 10:
        fail("R08", "that Google client secret is too short. Copy it again from \"Your restore details\".")
    note(f"Got the client secret ({len(secret)} characters).")
    return client_id, secret


def pick_backup(found):
    say("Backups in Google Drive, newest first")
    shown = found[:20]
    for i, item in enumerate(shown, 1):
        extra = "   (newest)" if i == 1 else ""
        if not item["checked"]:
            extra += "   (not checked in Drive)"
        note(f"{i:>2}) {when_text(item['createdAt'])}   {size_text(item['bytes'])}{extra}")
    if len(found) > len(shown):
        note(f"... and {len(found) - len(shown)} older ones.")
    for _ in range(5):
        answer = ask("pick", "Which backup? Press Enter for the newest, or type its number: ").strip().lower()
        if answer in ("", "newest", "1"):
            return shown[0]
        if answer.isdigit() and 1 <= int(answer) <= len(shown):
            return shown[int(answer) - 1]
        matches = [b for b in found if b["name"] == answer]
        if matches:
            return matches[0]
        note(f"Type a number from 1 to {len(shown)}, or press Enter.")
        if "pick" in answers():
            break
    fail("R10", "no backup was picked.")


def free_bytes(path):
    usage = shutil.disk_usage(path)
    return usage.free


def cmd_fetch(args):
    work = os.path.abspath(args.work)
    os.makedirs(work, mode=0o700, exist_ok=True)
    os.chmod(work, 0o700)
    client_id, secret = client_from_answers()
    google = Google(client_id, secret)
    google.sign_in()
    say("Signed in to Google. Looking for the backups")

    roots = google.search("appProperties has { key='extas' and value='backups' } and trashed = false"
                          f" and mimeType = '{FOLDER}'")
    found = []
    for root in roots:
        for folder in google.search(f"'{root['id']}' in parents and trashed = false and mimeType = '{FOLDER}'"):
            if label(folder, "extas") != "backup" or label(folder, "kind") == "SAFETY_COPY":
                continue
            found.append({
                "id": folder["id"],
                "root": root["id"],
                "name": folder["name"],
                "createdAt": label(folder, "createdAt") or folder.get("createdTime", ""),
                "bytes": int(label(folder, "bytes")) if (label(folder, "bytes") or "").isdigit() else None,
                "checked": label(folder, "checked") == "yes",
                "format": int(label(folder, "format") or 2),
            })
    if not found:
        fail("R10", "there are no Extas ERP backups in this Google account's Drive. Sign in with the Google account the ERP backed up to, with the same Google client.")
    found.sort(key=lambda b: (b["createdAt"], b["name"]), reverse=True)
    picked = pick_backup(found)
    name = safe_name(picked["name"])
    if not picked["checked"]:
        warn("W09", "this backup was not checked in Google Drive after it was saved; every file is checked again now.")
    say(f"Downloading the backup of {when_text(picked['createdAt'])}")

    files = {f["name"]: f for f in google.search(f"'{picked['id']}' in parents and trashed = false")}
    if "manifest.json" not in files:
        fail("R11", "this backup has no manifest.json in Drive; pick another backup.")
    folder = os.path.join(work, "download")
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder, mode=0o700)
    google.download(files["manifest.json"]["id"], os.path.join(folder, "manifest.json"), limit=50 * 1024 * 1024)
    with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    entries = manifest.get("files", [])
    need = sum(int(e.get("bytes", 0)) for e in entries)
    plain = sum(int((e.get("plain") or e).get("bytes", 0)) for e in entries)
    if free_bytes(work) < need + plain + 2 * 1024 ** 3:
        fail("R22", f"the disk has too little free space for this backup ({size_text(need + plain)} needed, and room for the ERP). Make the VM again with a bigger disk (64 GB or more).")
    for entry in entries:
        entry_name = safe_name(entry["name"])
        if entry_name not in files:
            fail("R11", f"{entry_name} is missing from this backup in Drive; pick another backup.")
        note(f"{entry_name} ({size_text(entry.get('bytes'))})")
        digest, size = google.download(files[entry_name]["id"], os.path.join(folder, entry_name), entry.get("bytes"))
        if size != entry.get("bytes") or digest != entry.get("sha256"):
            fail("R11", f"{entry_name} did not download whole, or Google's copy is damaged; paste the command again, or pick another backup.")
    note("Every file matches its checksum.")

    fmt = int(manifest.get("format") or 1)
    locked = [e for e in entries if e.get("plain")]
    opener = {}
    if locked and fmt == 3:
        opener["private"] = open_with_recovery_key(google, picked, manifest, folder)
    elif locked:
        opener["legacy"] = open_with_key_card(manifest)

    say("Opening the backup")
    opened = {}
    for entry in entries:
        source = os.path.join(folder, entry["name"])
        if not entry.get("plain"):
            opened[entry["name"]] = source
            continue
        target_name = safe_name(entry["plain"]["name"])
        target = os.path.join(folder, target_name)
        try:
            digest = unlock_file(source, target, **opener)
        except KeyError_ as error:
            fail("R12" if fmt == 3 else "R13", f"{target_name} did not open ({error}).")
        os.remove(source)
        if digest != entry["plain"]["sha256"]:
            fail("R11", f"{target_name} does not match its checksum after opening; pick another backup.")
        opened[target_name] = target
    if "database.dump" not in opened:
        fail("R11", "this backup has no database; pick another backup.")

    # restore/ is what deploy/restore.sh reads (its manifest in format 1).
    restore = os.path.join(work, "restore")
    shutil.rmtree(restore, ignore_errors=True)
    os.makedirs(restore, mode=0o700)
    keep = []
    for entry in entries:
        plain_entry = entry.get("plain") or entry
        if plain_entry["name"] in FOR_RESTORE and plain_entry["name"] in opened:
            os.replace(opened[plain_entry["name"]], os.path.join(restore, plain_entry["name"]))
            keep.append({"name": plain_entry["name"], "bytes": plain_entry["bytes"], "sha256": plain_entry["sha256"]})
    restore_manifest = {"app": "Extas ERP", "format": 1, "createdAt": manifest.get("createdAt"), "files": keep}
    for key in ("tables", "uploads"):
        if key in manifest:
            restore_manifest[key] = manifest[key]
    write_private(os.path.join(restore, "manifest.json"), json.dumps(restore_manifest, indent=2))
    for name_ in ("code.bundle", "settings.env", "server.json"):
        if name_ in opened:
            os.replace(opened[name_], os.path.join(work, name_))
    server = read_json(os.path.join(work, "server.json")) or {}
    write_private(os.path.join(work, "google.json"), json.dumps({"clientId": client_id, "clientSecret": secret}))
    cloudflare = server.get("cloudflare") or {}
    state = {
        "name": name,
        "createdAt": manifest.get("createdAt"),
        "format": fmt,
        "keyId": manifest.get("keyId"),
        "commit": manifest.get("commit"),
        "version": manifest.get("version"),
        "records": manifest.get("records"),
        "tables": len(manifest.get("tables") or {}),
        "files": len(manifest.get("uploads") or []),
        "missing": manifest.get("missing") or [],
        "hasCode": "code.bundle" in opened,
        "hasSettings": "settings.env" in opened,
        "appDomain": server.get("appDomain") or host_of(server.get("appUrl")),
        "ownerEmail": server.get("ownerEmail"),
        "cloudflareZone": cloudflare.get("zone"),
        "hasCloudflareToken": bool(cloudflare.get("token")),
    }
    write_private(os.path.join(work, "state.json"), json.dumps(state, indent=2))
    shutil.rmtree(folder, ignore_errors=True)
    if state["records"] is not None:
        say(f"The backup is open: {state['records']:,} records and {state['files']:,} files in it")
    else:
        say("The backup is open")
    for line in state["missing"]:
        note(f"Not in this backup: {line}")
    return 0


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_private(path, text):
    temporary = f"{path}.new"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def host_of(url):
    try:
        return urllib.parse.urlparse(url).hostname if url else None
    except ValueError:
        return None


def key_files(google, picked, folder):
    """Every keys file that could open the backup: its own, then the one beside the backups."""
    out = []
    own = os.path.join(folder, "backup-keys.json")
    if os.path.exists(own):
        with open(own, encoding="utf-8") as f:
            out.append(f.read())
    for file in google.search(f"'{picked['root']}' in parents and trashed = false"):
        if label(file, "extas") == "keys":
            path = os.path.join(folder, ".root-keys.json")
            google.download(file["id"], path, limit=1024 * 1024)
            with open(path, encoding="utf-8") as f:
                out.append(f.read())
            os.remove(path)
    files = []
    for text in out:
        try:
            files.append(parse_key_file(text))
        except KeyError_:
            continue
    return files


def kept_recovery_key(google, picked, pair_id, folder):
    """The recovery key from restore-key.json in Drive, when the owner keeps it there (G5)."""
    for file in reversed(google.search(f"'{picked['root']}' in parents and trashed = false")):
        if label(file, "extas") != "restore-key":
            continue
        path = os.path.join(folder, ".restore-key.json")
        google.download(file["id"], path, limit=64 * 1024)
        data = read_json(path)
        os.remove(path)
        if data and data.get("kind") == "restore-key" and data.get("pairId") == pair_id and isinstance(data.get("recoveryKey"), str):
            return data["recoveryKey"]
    return None


def open_with_recovery_key(google, picked, manifest, folder):
    pair_id = manifest.get("keyId")
    candidates = [f for f in key_files(google, picked, folder) if f["pairId"] == pair_id]
    if not candidates:
        fail("R14", f"the keys file for this backup (key {pair_id}) is missing; pick a newer backup.")
    kept = kept_recovery_key(google, picked, pair_id, folder)
    if kept:
        say("Your recovery key is kept in Google Drive: it is filled in by itself")
        for file in candidates:
            try:
                return {pair_id: open_key_file(file, kept)}
            except KeyError_:
                continue
        note("The recovery key in Drive does not open this backup (it was changed later); type it instead.")
    say("Your recovery key")
    note("The key you set on the Backups screen. Type it and press Enter; nothing shows as you type.")
    for attempt in range(3):
        typed = ask("recovery_key", "Recovery key (it stays hidden as you type): ", hidden=True)
        for file in candidates:
            try:
                return {pair_id: open_key_file(file, typed)}
            except KeyError_:
                continue
        if "recovery_key" in answers():
            break
        note("That is not the key these backups were locked with." + (" Try again." if attempt < 2 else ""))
    fail("R12", "the recovery key does not open this backup. Check capital letters, spaces and punctuation, then paste the command again.")


def open_with_key_card(manifest):
    say("This backup is from v6.3: it opens with the old key card")
    note("Type the 56 letters and digits from the old key card (spaces and dashes are fine).")
    for attempt in range(3):
        typed = ask("old_key_card", "Old key card (56 letters and digits, from v6.3; it stays hidden as you type): ", hidden=True)
        try:
            key = legacy_backup_key(parse_key_card(typed))
        except KeyError_ as error:
            note(f"That key card does not read right: {error}.")
            if "old_key_card" in answers():
                break
            continue
        if not manifest.get("keyId") or legacy_key_id(key) == manifest["keyId"]:
            return key
        note(f"That key card is for other backups (this one needs key {manifest['keyId']}).")
        if "old_key_card" in answers():
            break
    fail("R13", "the old key card does not open this backup. Check each group of 4 against the card, then paste the command again.")


# --- env -----------------------------------------------------------------------------


def read_env(path):
    lines = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
    return lines


def env_value(lines, name):
    value = None
    for line in lines:
        if line.startswith(f"{name}="):
            value = line[len(name) + 1:]
    return value


def set_env(lines, name, value):
    found = False
    out = []
    for line in lines:
        if line.startswith(f"{name}="):
            if not found:
                out.append(f"{name}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        out.append(f"{name}={value}")
    return out


def cmd_env(args):
    work = os.path.abspath(args.work)
    target = os.path.abspath(args.env)
    server = read_json(os.path.join(work, "server.json")) or {}
    google = read_json(os.path.join(work, "google.json")) or {}
    settings = os.path.join(work, "settings.env")
    lines = read_env(target)
    if not lines:
        if not os.path.exists(settings):
            return 5  # bootstrap.sh writes new settings with configure.sh, then runs this again.
        lines = read_env(settings)
        note("The server's settings come from the backup (deploy/.env as it was).")
    backup_settings = read_env(settings)
    backup_key = server.get("encryptionKey") or env_value(backup_settings, "ENCRYPTION_KEY")
    backup_old = list(server.get("encryptionOldKeys") or [])
    backup_old += [k for k in (env_value(backup_settings, "ENCRYPTION_OLD_KEYS") or "").split(",") if k]
    current = env_value(lines, "ENCRYPTION_KEY")
    if not current and backup_key:
        lines = set_env(lines, "ENCRYPTION_KEY", backup_key)
        current = backup_key
    # This server's own key is never replaced (A6): the backup's keys go beside it,
    # where they only open what they sealed.
    old = [k for k in (env_value(lines, "ENCRYPTION_OLD_KEYS") or "").split(",") if k]
    added = [k for k in dict.fromkeys(([backup_key] if backup_key else []) + backup_old)
             if k and k != current and k not in old]
    if added:
        lines = set_env(lines, "ENCRYPTION_OLD_KEYS", ",".join(old + added))
        note("This server's own ENCRYPTION_KEY stays; the backup's key is added beside it.")
    if not env_value(lines, "GOOGLE_DRIVE_CLIENT_ID") and google.get("clientId"):
        lines = set_env(lines, "GOOGLE_DRIVE_CLIENT_ID", google["clientId"])
        lines = set_env(lines, "GOOGLE_DRIVE_CLIENT_SECRET", google.get("clientSecret", ""))
    token = (server.get("cloudflare") or {}).get("token")
    if token and not env_value(lines, "CLOUDFLARE_API_TOKEN"):
        lines = set_env(lines, "CLOUDFLARE_API_TOKEN", token)
    if server.get("ownerEmail") and not env_value(lines, "SEED_ADMIN_EMAIL"):
        lines = set_env(lines, "SEED_ADMIN_EMAIL", server["ownerEmail"])
    os.makedirs(os.path.dirname(target), exist_ok=True)
    write_private(target, "\n".join(lines) + "\n")
    return 0


# --- dns -----------------------------------------------------------------------------


def demo_domain(env_lines, demo_conf, app_domain):
    """The demo site's web address, as deploy/lib.sh works it out (empty while it is off)."""
    on = env_value(env_lines, "DEMO_SITE")
    if not on and os.path.exists(demo_conf):
        on = env_value(read_env(demo_conf), "DEMO_SITE")
    if on != "on":
        return None
    domain = (env_value(env_lines, "DEMO_DOMAIN") or "").lower()
    if not domain:
        if not app_domain or app_domain == "localhost":
            return None
        parts = app_domain.split(".")
        domain = "demo." + (".".join(parts[1:]) if len(parts) >= 3 else app_domain)
    if domain == app_domain or not re.fullmatch(r"([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}", domain):
        return None
    return domain


def public_ip():
    given = os.environ.get("PUBLIC_IP")
    if given:
        return given
    for url in ("https://1.1.1.1/cdn-cgi/trace", "https://api.ipify.org"):
        try:
            with urllib.request.urlopen(url, timeout=15, context=_context) as response:
                text = response.read().decode("ascii", "replace")
        except (urllib.error.URLError, socket.timeout, OSError):
            continue
        match = re.search(r"(?:^ip=)?(\d{1,3}(?:\.\d{1,3}){3})\s*$", text.strip(), re.M)
        if match:
            return match.group(1)
    return None


def cloudflare(token, method, path, body=None):
    status, _, raw = http(method, f"{CLOUDFLARE}{path}", json.dumps(body) if body is not None else None,
                          {"Authorization": f"Bearer {token}"})
    data = as_json(raw)
    if status >= 300 or not data.get("success", False):
        errors = "; ".join(e.get("message", "") for e in data.get("errors", []) if isinstance(e, dict))
        raise RuntimeError(errors or f"HTTP {status}")
    return data.get("result")


def set_state(work, **facts):
    """Adds facts to state.json (bootstrap.sh reads them with `fact`)."""
    path = os.path.join(work, "state.json")
    state = read_json(path) or {}
    state.update(facts)
    write_private(path, json.dumps(state, indent=2))


def site_answers(name):
    """Whether the ERP at this web address answers now (from wherever it points)."""
    base = os.environ.get("EXTAS_SITE_BASE") or f"https://{name}"  # drills and tests only
    try:
        with urllib.request.urlopen(f"{base}/api/health", timeout=10, context=_context) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, socket.timeout, OSError, ValueError):
        return False


def cmd_dns(args):
    work = os.path.abspath(args.work)
    deploy = os.path.abspath(args.deploy)
    env_lines = read_env(os.path.join(deploy, ".env"))
    server = read_json(os.path.join(work, "server.json")) or {}
    app = (env_value(env_lines, "APP_DOMAIN") or "").lower()
    names = [n for n in [app, demo_domain(env_lines, os.path.join(deploy, "demo.conf"), app)] if n]
    # dnsMoved: the web address points here now. Until it does, the restored ERP
    # waits on standby (G2): bootstrap.sh reads this fact.
    if not names or app == "localhost":
        set_state(work, dnsMoved=True)
        return 0
    set_state(work, dnsMoved=False)
    ip = public_ip()
    cf = server.get("cloudflare") or {}
    token = cf.get("token") or env_value(env_lines, "CLOUDFLARE_API_TOKEN")
    zone = (cf.get("zone") or "").lower()
    if not token or not zone:
        warn("W01", f"the Cloudflare token was not saved on the Backups screen, so the web address was not changed. In your domain's DNS, point {' and '.join(names)} (A record) to this server: {ip or 'its public IP address in Azure'}.")
        return 0
    if not ip:
        warn("W02", "this server's public IP address could not be found, so Cloudflare was not changed. Point the A records to the Public IP address shown in Azure.")
        return 0
    try:
        zone_id = cf.get("zoneId")
        if not zone_id:
            zones = cloudflare(token, "GET", f"/zones?{urllib.parse.urlencode({'name': zone})}") or []
            zone_id = zones[0]["id"] if zones else None
        if not zone_id:
            raise RuntimeError(f"the token cannot reach the domain {zone}")
        now = {}
        for name in names:
            query = urllib.parse.urlencode({"type": "A", "name": name})
            records = cloudflare(token, "GET", f"/zones/{zone_id}/dns_records?{query}") or []
            now[name] = records[0].get("content") if records else None
    except RuntimeError as error:
        warn("W02", f"Cloudflare did not take the change ({error}). Point {' and '.join(names)} (A record) to {ip} yourself.")
        return 0
    if all(now.get(name) == ip for name in names):
        for name in names:
            note(f"{name} already points to this server.")
        set_state(work, dnsMoved=True)
        return 0
    say("Your web address in Cloudflare")
    for name in names:
        note(f"{name}  ->  {ip} (this server)")
    old = now.get(app)
    if old and old != ip and site_answers(app):
        # Two ERPs at once would both send reminders and make backups (G2).
        say(f"The ERP at {app} still answers from another server ({old})")
        note("If the web address comes here while that one runs, two ERPs would send reminders")
        note("and make backups at the same time. Move it only when the old server is off or")
        note("will not be used again. For a practice run, press Enter: this copy then waits on standby.")
    answer = plain_name(ask("dns", f"To point {' and '.join(names)} to this server ({ip}), type {app}; or press Enter to leave it as it is: "))
    if answer != app:
        warn("W01", f"the web address was not changed. Point {' and '.join(names)} (A record) to {ip} yourself when this server is the one to use.")
        return 0
    app_here = False
    try:
        for name in names:
            if not (name == zone or name.endswith("." + zone)):
                warn("W02", f"{name} is not inside {zone}, so it was not changed: point it to {ip} yourself.")
                continue
            query = urllib.parse.urlencode({"type": "A", "name": name})
            records = cloudflare(token, "GET", f"/zones/{zone_id}/dns_records?{query}") or []
            if records:
                record = records[0]
                if record.get("content") == ip:
                    note(f"{name} already points to this server.")
                else:
                    cloudflare(token, "PATCH", f"/zones/{zone_id}/dns_records/{record['id']}", {"content": ip})
                    note(f"{name} now points to this server (it pointed to {record.get('content')}).")
            else:
                cloudflare(token, "POST", f"/zones/{zone_id}/dns_records",
                           {"type": "A", "name": name, "content": ip, "ttl": 1, "proxied": False})
                note(f"{name} now points to this server (a new A record).")
            others = cloudflare(token, "GET", f"/zones/{zone_id}/dns_records?{urllib.parse.urlencode({'type': 'AAAA', 'name': name})}") or []
            if others:
                warn("W08", f"{name} also has an AAAA (IPv6) record that may point to the old server: delete it in Cloudflare (DNS, Records).")
            app_here = app_here or name == app
    except RuntimeError as error:
        warn("W02", f"Cloudflare did not take the change ({error}). Point {' and '.join(names)} (A record) to {ip} yourself.")
    set_state(work, dnsMoved=app_here)
    return 0


def plain_name(text):
    """A web address as typed in a browser: lower case, without https:// or a path."""
    text = re.sub(r"^\s*https?://", "", (text or "").strip(), flags=re.I)
    return text.split("/")[0].strip().lower()


# --- compare -------------------------------------------------------------------------


def walk_files(root):
    out = {}
    if not os.path.isdir(root):
        return out
    for folder, dirs, files in os.walk(root, followlinks=False):
        dirs.sort()
        for name in files:
            full = os.path.join(folder, name)
            if not os.path.isfile(full) or os.path.islink(full):
                continue
            digest = hashlib.sha256()
            with open(full, "rb") as f:
                for chunk in iter(lambda: f.read(PIECE_BYTES), b""):
                    digest.update(chunk)
            out[os.path.relpath(full, root).replace(os.sep, "/")] = digest.hexdigest()
    return out


def cmd_compare(args):
    work = os.path.abspath(args.work)
    manifest = read_json(args.manifest or os.path.join(work, "restore", "manifest.json")) or {}
    tables = manifest.get("tables")
    uploads = manifest.get("uploads")
    counts = read_json(args.counts) if args.counts else None
    problems = []
    if tables is not None and counts is not None:
        for table, n in sorted(tables.items()):
            back = counts.get(table)
            if back is None:
                problems.append(f"Table {table} is missing ({n} records).")
            elif int(back) != int(n):
                problems.append(f"Table {table} has {back} of {n} records.")
    if uploads is not None:
        restored = walk_files(args.uploads)
        for item in uploads:
            got = restored.get(item["path"])
            if got is None:
                problems.append(f"File {item['path']} is missing.")
            elif got != item["sha256"]:
                problems.append(f"File {item['path']} is not the same.")
    records = sum(int(n) for n in (tables or {}).values())
    files = len(uploads or [])
    result = {"ok": not problems, "records": records, "files": files, "problems": problems,
              "compared": {"records": tables is not None and counts is not None, "files": uploads is not None}}
    if args.result:
        write_private(args.result, json.dumps(result, indent=2))
    say("Comparing with the backup's list of every table and file")
    if tables is None or uploads is None:
        note("This backup has no list of its tables and files (it is from before v6.4): the counts could not be compared.")
    if counts is None and tables is not None:
        note("The records were not counted after the restore, so they could not be compared.")
    if not problems:
        if tables is not None and counts is not None and uploads is not None:
            print(f"\nAll {records:,} records and {files:,} files are back.", flush=True)
        return 0
    print(f"\nNot everything is back ({len(problems)} problem{'s' if len(problems) != 1 else ''}):", flush=True)
    for line in problems[:50]:
        note(line)
    if len(problems) > 50:
        note(f"... and {len(problems) - 50} more.")
    fail("R20", "some records or files did not come back (listed above). The ERP runs; pick another backup and paste the command again, or ask for help with this list.")


# --- fact ----------------------------------------------------------------------------

#: Facts bootstrap.sh may read; none of them is a secret.
FACTS = ("name", "createdAt", "format", "commit", "version", "records", "files", "hasCode",
         "hasSettings", "appDomain", "ownerEmail", "cloudflareZone", "hasCloudflareToken",
         "dnsMoved")


def cmd_fact(args):
    state = read_json(os.path.join(os.path.abspath(args.work), "state.json")) or {}
    if args.name not in FACTS:
        fail("R11", f"unknown fact {args.name}")
    value = state.get(args.name)
    if isinstance(value, bool):
        value = "yes" if value else ""
    print("" if value is None else value)
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Extas ERP restore tool (see deploy/bootstrap.sh)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("fetch")
    p.add_argument("--work", required=True)
    p = sub.add_parser("env")
    p.add_argument("--work", required=True)
    p.add_argument("--env", required=True)
    p = sub.add_parser("dns")
    p.add_argument("--work", required=True)
    p.add_argument("--deploy", required=True)
    p = sub.add_parser("compare")
    p.add_argument("--work", required=True)
    p.add_argument("--counts")
    p.add_argument("--uploads", required=True)
    p.add_argument("--manifest")
    p.add_argument("--result")
    p = sub.add_parser("fact")
    p.add_argument("--work", required=True)
    p.add_argument("name")
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        return {"fetch": cmd_fetch, "env": cmd_env, "dns": cmd_dns, "compare": cmd_compare, "fact": cmd_fact}[args.command](args)
    except Stop as stop:
        print(f"\nError {stop.code}: {stop.message}\n(Look up {stop.code} in the restore guide's list of errors.)", file=sys.stderr, flush=True)
        return 3
    except KeyboardInterrupt:
        print("\nStopped (Ctrl+C). Nothing more was done; paste the command again to start over.", file=sys.stderr)
        return 3
    except Exception as error:  # noqa: BLE001 - a plain message instead of a trace
        print(f"\nError R28: the restore tool stopped unexpectedly ({type(error).__name__}: {str(error)[:200]})."
              "\n(Look up R28 in the restore guide's list of errors.)", file=sys.stderr, flush=True)
        return 3


if __name__ == "__main__":
    sys.exit(main())
