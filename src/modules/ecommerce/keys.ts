import { randomBytes } from "node:crypto";

import { hashText } from "@/lib/crypto";

/*
 * An e-commerce integration's API key and webhook secret (CN-005). The key is
 * shown once when it is made: only its SHA-256 is kept (apiKeyRef), so nobody,
 * not even the ERP, can show it again. The webhook secret is needed again to
 * sign and check messages, so it is kept sealed with ENCRYPTION_KEY
 * (webhookSecretRef). Both are 32 random bytes.
 */

export const API_KEY_PREFIX = "extas_sk_";
export const WEBHOOK_SECRET_PREFIX = "extas_whsec_";

const random = () => randomBytes(32).toString("base64url");

export const newApiKey = () => `${API_KEY_PREFIX}${random()}`;
export const newWebhookSecret = () => `${WEBHOOK_SECRET_PREFIX}${random()}`;

/** What is stored for a key: its SHA-256, never the key. */
export const apiKeyRef = (key: string) => `sha256:${hashText(key)}`;

/** The start and end of a key, so people can tell keys apart (never enough to use it). */
export const apiKeyHint = (key: string) =>
  `${key.slice(0, API_KEY_PREFIX.length + 4)}…${key.slice(-4)}`;
