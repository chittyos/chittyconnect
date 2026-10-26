-- Migration: credential delivery leases and delivery-row marker (#380/#381)
-- Purpose:
--   1. credential_delivery_leases: one row per delivery target
--      ('<script>/<secret_name>'). A delivery takes the lease with a single
--      atomic upsert before minting a token, so two concurrent deliveries to
--      the same worker secret cannot interleave and revoke each other's token.
--      expires_at is epoch milliseconds; an expired lease may be taken over.
--   2. credential_provisions.delivery_state: written ONLY by the deliver_to
--      path ('pending' -> 'delivered' | 'failed' | 'unknown'). The rotation
--      lookup requires it to be non-NULL, so rows written by the ordinary
--      (non-delivery) provisioning path can never be selected for revocation.

CREATE TABLE IF NOT EXISTS credential_delivery_leases (
  target TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

ALTER TABLE credential_provisions ADD COLUMN delivery_state TEXT;
