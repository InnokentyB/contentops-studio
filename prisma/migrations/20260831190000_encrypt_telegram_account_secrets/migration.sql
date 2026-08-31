ALTER TABLE "planner"."telegram_accounts"
ADD CONSTRAINT "telegram_accounts_api_hash_encrypted"
CHECK ("api_hash" LIKE 'enc:v1:%') NOT VALID;

ALTER TABLE "planner"."telegram_accounts"
ADD CONSTRAINT "telegram_accounts_session_encrypted"
CHECK ("session_string" LIKE 'enc:v1:%') NOT VALID;

COMMENT ON COLUMN "planner"."telegram_accounts"."api_hash"
IS 'AES-256-GCM ciphertext encrypted with CHANNEL_SECRETS_KEY';

COMMENT ON COLUMN "planner"."telegram_accounts"."session_string"
IS 'AES-256-GCM ciphertext encrypted with CHANNEL_SECRETS_KEY';
