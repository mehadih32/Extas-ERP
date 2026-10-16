-- v6.3: a PIN typed to the bot was kept as it was typed in the bot's log, in
-- the background job that handled it and (when it came after the PIN was no
-- longer waited for) in the chat. From now on it is checked when it arrives and
-- never kept, and this wipes the ones kept before.
--
-- v6.4: only a message of 4 to 8 digits that came within 10 minutes after the
-- bot asked for the PIN in that chat is taken as a PIN (an order number typed at
-- another time stays as it is). The first version of this wipe, applied by the
-- v6.3 update, took every message of 4 to 8 digits: scripts/check-update.ts
-- reports after each update how many of those did not follow a PIN request
-- (src/modules/ai/bot/pin-scrub.ts). Nothing else changes.
UPDATE "AiBotMessage" AS m
SET "text" = '[PIN]'
WHERE m."direction" = 'IN'
  AND m."text" ~ '^\s*[0-9]{4,8}\s*$'
  AND EXISTS (
    SELECT 1 FROM "AiBotMessage" AS ask
    WHERE ask."direction" = 'OUT'
      AND ask."linkId" = m."linkId"
      AND ask."chatId" = m."chatId"
      AND ask."text" LIKE 'Send your PIN to %'
      AND ask."createdAt" <= m."createdAt"
      AND ask."createdAt" > m."createdAt" - INTERVAL '10 minutes'
  );

UPDATE "BackgroundJob" AS j
SET "payload" = jsonb_set(j."payload", '{incoming,text}', '"[PIN]"')
WHERE j."kind" = 'ai.bot.incoming'
  AND j."payload" -> 'incoming' ->> 'text' ~ '^\s*[0-9]{4,8}\s*$'
  AND EXISTS (
    SELECT 1 FROM "AiBotMessage" AS m
    WHERE m."id" = j."payload" ->> 'messageId' AND m."text" = '[PIN]'
  );

UPDATE "AiChatMessage" AS c
SET "text" = '[PIN]'
WHERE c."role" = 'OWNER'
  AND c."channel" = 'BOT'
  AND c."text" ~ '^\s*[0-9]{4,8}\s*$'
  AND EXISTS (
    SELECT 1 FROM "AiBotMessage" AS ask
    WHERE ask."direction" = 'OUT'
      AND ask."companyId" = c."companyId"
      AND ask."text" LIKE 'Send your PIN to %'
      AND ask."createdAt" <= c."createdAt"
      AND ask."createdAt" > c."createdAt" - INTERVAL '10 minutes'
  );
