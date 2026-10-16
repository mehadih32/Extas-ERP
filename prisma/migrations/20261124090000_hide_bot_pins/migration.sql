-- v6.3: a PIN typed to the bot was kept as it was typed in the bot's log, in
-- the background job that handled it and (when it came after the PIN was no
-- longer waited for) in the chat. From now on it is checked when it arrives and
-- never kept; this wipes the ones kept before. A message that is only 4 to 8
-- digits is taken as a PIN. Nothing else changes.
UPDATE "AiBotMessage"
SET "text" = '[PIN]'
WHERE "direction" = 'IN' AND "text" ~ '^\s*[0-9]{4,8}\s*$';

UPDATE "BackgroundJob"
SET "payload" = jsonb_set("payload", '{incoming,text}', '"[PIN]"')
WHERE "kind" = 'ai.bot.incoming'
  AND "payload" -> 'incoming' ->> 'text' ~ '^\s*[0-9]{4,8}\s*$';

UPDATE "AiChatMessage"
SET "text" = '[PIN]'
WHERE "role" = 'OWNER' AND "channel" = 'BOT' AND "text" ~ '^\s*[0-9]{4,8}\s*$';
