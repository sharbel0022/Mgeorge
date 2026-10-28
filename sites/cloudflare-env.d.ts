declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BANK_DATA_ENCRYPTION_KEY?: string;
    ENABLE_BANKING_APPLICATION_ID?: string;
    ENABLE_BANKING_PRIVATE_KEY?: string;
    ENABLE_BANKING_ENVIRONMENT?: 'SANDBOX' | 'PRODUCTION';
    ENABLE_BANKING_KEY_ROTATED?: string;
  }
}
