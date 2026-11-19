-- Sahay v2 schema. Ids are TEXT (prefix_ + random), times are ISO-8601 strings.
-- Every tenant-owned table carries business_id; src/db/repo.js filters on it in every query.

CREATE TABLE IF NOT EXISTS businesses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  owner_name  TEXT,
  city        TEXT,
  state       TEXT,
  language    TEXT NOT NULL DEFAULT 'hi-IN',
  created_at  TEXT NOT NULL
);

-- ACC: owner accounts (src/accounts/*). Not tenant-owned: an account owns businesses through
-- account_businesses. The phone is normalised to +91 and ten digits and is not verified
-- (no SMS); the PIN is stored only as scrypt$N$r$p$salt$hash.
CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  phone           TEXT NOT NULL UNIQUE CHECK (phone GLOB '+91[6-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  pin_hash        TEXT NOT NULL CHECK (pin_hash LIKE 'scrypt$%'),
  phone_verified  INTEGER NOT NULL DEFAULT 0 CHECK (phone_verified IN (0, 1)),
  created_at      TEXT NOT NULL
);

-- One owner account per business; an account may own several businesses.
CREATE TABLE IF NOT EXISTS account_businesses (
  account_id   TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner')),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (account_id, business_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS account_businesses_one_owner ON account_businesses(business_id) WHERE role = 'owner';

-- WebAuthn credentials (@simplewebauthn/server). credential_id is base64url; public_key is the COSE key.
-- counter only moves forward (src/accounts/store.js); a response whose counter did not grow is refused.
CREATE TABLE IF NOT EXISTS passkeys (
  id             TEXT PRIMARY KEY,
  account_id     TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  credential_id  TEXT NOT NULL UNIQUE,
  public_key     BLOB NOT NULL,
  counter        INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys(account_id);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('owner', 'negotiation')),
  channel     TEXT,
  agent_id    TEXT,
  status      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT
);
CREATE INDEX IF NOT EXISTS sessions_by_business ON sessions (business_id, started_at);

CREATE TABLE IF NOT EXISTS requirements (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id   TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  item         TEXT,
  quantity     REAL,
  unit         TEXT,
  target_price REAL,
  max_price    REAL,
  city         TEXT,
  delivery_by  TEXT,
  notes        TEXT,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS requirements_by_business ON requirements (business_id, created_at);

CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requirement_id TEXT REFERENCES requirements(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('sourcing', 'negotiation')),
  status         TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  progress       TEXT NOT NULL DEFAULT '[]',
  result         TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_by_business ON jobs (business_id, created_at);

CREATE TABLE IF NOT EXISTS vendors (
  id                TEXT PRIMARY KEY,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requirement_id    TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  source            TEXT NOT NULL CHECK (source IN ('indiamart', 'simulated', 'human')),
  kind              TEXT NOT NULL CHECK (kind IN ('listed', 'simulated', 'human')),
  name              TEXT NOT NULL,
  city              TEXT,
  phone             TEXT,
  item_title        TEXT,
  listed_price_text TEXT,
  listed_price      REAL,
  listed_unit       TEXT,
  rating            REAL,
  rating_count      INTEGER,
  source_url        TEXT,
  score             REAL,
  score_breakdown   TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vendors_by_requirement ON vendors (business_id, requirement_id);

CREATE TABLE IF NOT EXISTS negotiations (
  id             TEXT PRIMARY KEY,
  business_id    TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  vendor_id      TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  session_id     TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  counterpart    TEXT NOT NULL CHECK (counterpart IN ('simulated', 'human', 'phone')),
  status         TEXT NOT NULL,
  transcript     TEXT NOT NULL DEFAULT '[]',
  outcome        TEXT,
  created_at     TEXT NOT NULL,
  ended_at       TEXT
);
CREATE INDEX IF NOT EXISTS negotiations_by_requirement ON negotiations (business_id, requirement_id);

CREATE TABLE IF NOT EXISTS quotes (
  id              TEXT PRIMARY KEY,
  business_id     TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  requirement_id  TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  vendor_id       TEXT NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  negotiation_id  TEXT REFERENCES negotiations(id) ON DELETE SET NULL,
  unit_price      REAL NOT NULL,
  unit            TEXT,
  moq             REAL,
  lead_time_days  INTEGER,
  freight         REAL,
  payment_terms   TEXT,
  quoted_sentence TEXT,
  confidence      REAL,
  simulated       INTEGER NOT NULL CHECK (simulated IN (0, 1)),
  landed_cost     REAL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotes_by_requirement ON quotes (business_id, requirement_id);
-- One quote per negotiation: ending a negotiation twice must not duplicate its quote.
CREATE UNIQUE INDEX IF NOT EXISTS quotes_one_per_negotiation ON quotes (negotiation_id) WHERE negotiation_id IS NOT NULL;

-- Who a quote is from, at what price and whether it is simulated never change after it is recorded.
-- (negotiation_id may still become NULL through ON DELETE SET NULL.)
CREATE TRIGGER IF NOT EXISTS quotes_deal_is_fixed
BEFORE UPDATE OF simulated, vendor_id, unit_price, negotiation_id ON quotes
WHEN NEW.simulated IS NOT OLD.simulated
  OR NEW.vendor_id IS NOT OLD.vendor_id
  OR NEW.unit_price IS NOT OLD.unit_price
  OR (NEW.negotiation_id IS NOT OLD.negotiation_id AND NEW.negotiation_id IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'the vendor, price and simulated flag of a quote cannot be changed');
END;

CREATE TABLE IF NOT EXISTS approvals (
  id                 TEXT PRIMARY KEY,
  business_id        TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quote_id           TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  status             TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'consumed')),
  readback           TEXT NOT NULL,
  total_amount       REAL NOT NULL,
  requested_at       TEXT NOT NULL,
  decided_at         TEXT,
  decided_via        TEXT CHECK (decided_via IN ('voice', 'button') OR decided_via IS NULL),
  evidence_utterance TEXT
);
CREATE INDEX IF NOT EXISTS approvals_by_business ON approvals (business_id, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS approvals_one_pending ON approvals (quote_id) WHERE status = 'pending';

-- The approval gate, enforced below the application code.
CREATE TRIGGER IF NOT EXISTS approvals_start_pending
BEFORE INSERT ON approvals
WHEN NEW.status <> 'pending'
BEGIN
  SELECT RAISE(ABORT, 'an approval must start as pending');
END;

CREATE TRIGGER IF NOT EXISTS approvals_status_flow
BEFORE UPDATE OF status ON approvals
WHEN NOT (
  (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
  OR (OLD.status = 'approved' AND NEW.status IN ('consumed', 'rejected'))
)
BEGIN
  SELECT RAISE(ABORT, 'illegal approval status change');
END;

CREATE TRIGGER IF NOT EXISTS approvals_deal_is_fixed
BEFORE UPDATE OF business_id, quote_id, readback, total_amount ON approvals
BEGIN
  SELECT RAISE(ABORT, 'the deal on an approval cannot be changed');
END;

-- One deal waits for the owner at a time, so a spoken yes can only be about the deal just read out.
CREATE TRIGGER IF NOT EXISTS approvals_one_pending_per_business
BEFORE INSERT ON approvals
WHEN EXISTS (SELECT 1 FROM approvals a WHERE a.business_id = NEW.business_id AND a.status = 'pending')
BEGIN
  SELECT RAISE(ABORT, 'another approval of this business is still pending');
END;

-- Every time the server itself spoke an approval's read-back into a live call (agent /speak).
-- Append-only. A spoken yes is evidence only for a read-back recorded here
-- (security review r1 #2). A separate table, not columns on approvals: an existing
-- database file gets it from CREATE TABLE IF NOT EXISTS without a migration.
CREATE TABLE IF NOT EXISTS approval_readbacks (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  approval_id TEXT NOT NULL REFERENCES approvals(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  spoken_text TEXT NOT NULL,
  spoken_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS approval_readbacks_by_approval ON approval_readbacks (business_id, approval_id, spoken_at);

CREATE TRIGGER IF NOT EXISTS approval_readbacks_need_pending
BEFORE INSERT ON approval_readbacks
WHEN NOT EXISTS (
  SELECT 1 FROM approvals a WHERE a.id = NEW.approval_id AND a.business_id = NEW.business_id AND a.status = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'a read-back is recorded only for a pending approval of the same business');
END;

CREATE TRIGGER IF NOT EXISTS approval_readbacks_are_fixed
BEFORE UPDATE ON approval_readbacks
BEGIN
  SELECT RAISE(ABORT, 'a recorded read-back cannot be changed');
END;

-- A voice approval needs a read-back the server spoke for that approval.
CREATE TRIGGER IF NOT EXISTS approvals_voice_needs_spoken_readback
BEFORE UPDATE OF status ON approvals
WHEN NEW.status = 'approved' AND NEW.decided_via = 'voice'
  AND NOT EXISTS (SELECT 1 FROM approval_readbacks r WHERE r.approval_id = NEW.id AND r.business_id = NEW.business_id)
BEGIN
  SELECT RAISE(ABORT, 'a voice approval needs a read-back spoken by the server');
END;

CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  business_id      TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quote_id         TEXT NOT NULL REFERENCES quotes(id),
  approval_id      TEXT NOT NULL UNIQUE REFERENCES approvals(id),
  po_number        TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL,
  amount           REAL NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'INR',
  pdf_path         TEXT,
  payment_link_id  TEXT,
  payment_link_url TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_by_business ON orders (business_id, created_at);
-- A quote is ordered at most once.
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_per_quote ON orders (quote_id);

CREATE TRIGGER IF NOT EXISTS orders_need_consumed_approval
BEFORE INSERT ON orders
WHEN NOT EXISTS (
  SELECT 1 FROM approvals a
  WHERE a.id = NEW.approval_id
    AND a.business_id = NEW.business_id
    AND a.quote_id = NEW.quote_id
    AND a.status = 'consumed'
    AND a.total_amount = NEW.amount
)
BEGIN
  SELECT RAISE(ABORT, 'an order needs a consumed approval for the same business, quote and amount');
END;

CREATE TRIGGER IF NOT EXISTS orders_deal_is_fixed
BEFORE UPDATE OF business_id, quote_id, approval_id, po_number, amount, currency ON orders
BEGIN
  SELECT RAISE(ABORT, 'the deal on an order cannot be changed');
END;

-- The pay page of an order (Razorpay Orders API + Standard Checkout, test mode). One per order.
-- `token_hash` is SHA-256 of the 128-bit token in the page URL (PUBLIC_URL/pay/<token>); the
-- token is the only thing a payer holds, it names this business and order, and it expires.
-- A separate table, not columns on orders: an existing database file gets it from
-- CREATE TABLE IF NOT EXISTS without a migration.
CREATE TABLE IF NOT EXISTS payment_checkouts (
  id                  TEXT PRIMARY KEY,
  business_id         TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id            TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  razorpay_order_id   TEXT NOT NULL,
  token_hash          TEXT NOT NULL UNIQUE,
  expires_at          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  paid_at             TEXT,
  razorpay_payment_id TEXT
);

CREATE TRIGGER IF NOT EXISTS payment_checkouts_need_own_order
BEFORE INSERT ON payment_checkouts
WHEN NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = NEW.order_id AND o.business_id = NEW.business_id)
BEGIN
  SELECT RAISE(ABORT, 'a checkout is for an order of the same business');
END;

CREATE TRIGGER IF NOT EXISTS payment_checkouts_order_is_fixed
BEFORE UPDATE OF business_id, order_id, razorpay_order_id ON payment_checkouts
BEGIN
  SELECT RAISE(ABORT, 'the order behind a checkout cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS payment_checkouts_paid_once
BEFORE UPDATE OF paid_at, razorpay_payment_id ON payment_checkouts
WHEN OLD.paid_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a paid checkout cannot be changed');
END;

CREATE TABLE IF NOT EXISTS followups (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id    TEXT REFERENCES orders(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  due_at      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('scheduled', 'fired', 'cancelled')),
  message     TEXT,
  fired_at    TEXT
);
CREATE INDEX IF NOT EXISTS followups_due ON followups (status, due_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  session_id  TEXT,
  ts          TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('owner', 'agent', 'system', 'vendor')),
  type        TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_by_business ON audit_log (business_id, id);

CREATE TABLE IF NOT EXISTS telegram_links (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  chat_id     TEXT NOT NULL,
  linked_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS link_codes (
  code        TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL
);

-- "My Sahay": how the owner wants their agent to behave (docs/superpowers/specs/2026-11-19-sahay-frontend-design.md).
-- The language lives on businesses; a profile row holds only what has no other home. No row means the defaults.
CREATE TABLE IF NOT EXISTS agent_profiles (
  business_id   TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  voice_speed   TEXT NOT NULL CHECK (voice_speed IN ('slow', 'normal')),
  bargain_style TEXT NOT NULL CHECK (bargain_style IN ('gentle', 'balanced', 'tough')),
  updated_at    TEXT NOT NULL
);

-- Rules the owner taught or Sahay suggested. Structured kinds only, and each can only narrow what
-- Sahay does; no rule can place an order, accept a rate or stand in for the owner's yes.
-- `scope_key` names what a rule is about ("max_price:rice", "vendor:lakshmi traders"): one active rule per scope.
CREATE TABLE IF NOT EXISTS agent_rules (
  id           TEXT PRIMARY KEY,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('max_price', 'prefer_vendor', 'avoid_vendor', 'usual_quantity', 'reply_language', 'bargain_style')),
  scope_key    TEXT NOT NULL,
  params       TEXT NOT NULL,
  sentence_hi  TEXT NOT NULL,
  sentence_kn  TEXT NOT NULL,
  sentence_en  TEXT NOT NULL,
  why_hi       TEXT,
  why_kn       TEXT,
  why_en       TEXT,
  status       TEXT NOT NULL CHECK (status IN ('suggested', 'active', 'off')),
  source       TEXT NOT NULL CHECK (source IN ('owner_said', 'learned')),
  decided_via  TEXT CHECK (decided_via IN ('voice', 'button') OR decided_via IS NULL),
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
CREATE INDEX IF NOT EXISTS agent_rules_by_business ON agent_rules (business_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS agent_rules_one_active ON agent_rules (business_id, scope_key) WHERE status = 'active';

CREATE TRIGGER IF NOT EXISTS agent_rules_start_suggested
BEFORE INSERT ON agent_rules
WHEN NEW.status <> 'suggested'
BEGIN
  SELECT RAISE(ABORT, 'a rule must start as suggested');
END;

CREATE TRIGGER IF NOT EXISTS agent_rules_status_flow
BEFORE UPDATE OF status ON agent_rules
WHEN NOT (
  (OLD.status = 'suggested' AND NEW.status IN ('active', 'off'))
  OR (OLD.status = 'active' AND NEW.status = 'off')
)
BEGIN
  SELECT RAISE(ABORT, 'illegal rule status change');
END;

CREATE TRIGGER IF NOT EXISTS agent_rules_are_fixed
BEFORE UPDATE OF business_id, kind, scope_key, params, sentence_hi, sentence_kn, sentence_en, source ON agent_rules
BEGIN
  SELECT RAISE(ABORT, 'what a rule says cannot be changed; propose a new one');
END;

-- Every time the server itself spoke a rule into a live call: a suggested rule's sentence (a spoken yes
-- can keep only a rule the server read out, approvals.answerAfterSpoken), or an active usual_quantity
-- rule's offer (the quantity is filled only on a spoken yes to it).
CREATE TABLE IF NOT EXISTS rule_readbacks (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  rule_id     TEXT NOT NULL REFERENCES agent_rules(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  spoken_text TEXT NOT NULL,
  spoken_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rule_readbacks_by_rule ON rule_readbacks (business_id, rule_id, spoken_at);

CREATE TRIGGER IF NOT EXISTS rule_readbacks_need_suggested
BEFORE INSERT ON rule_readbacks
WHEN NOT EXISTS (
  SELECT 1 FROM agent_rules r WHERE r.id = NEW.rule_id AND r.business_id = NEW.business_id
    AND (r.status = 'suggested' OR (r.status = 'active' AND r.kind = 'usual_quantity'))
)
BEGIN
  SELECT RAISE(ABORT, 'a rule read-back is recorded only for a suggested rule (or an active usual quantity) of the same business');
END;

CREATE TRIGGER IF NOT EXISTS rule_readbacks_are_fixed
BEFORE UPDATE ON rule_readbacks
BEGIN
  SELECT RAISE(ABORT, 'a recorded rule read-back cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS agent_rules_voice_needs_spoken_readback
BEFORE UPDATE OF status ON agent_rules
WHEN NEW.status = 'active' AND NEW.decided_via = 'voice'
  AND NOT EXISTS (SELECT 1 FROM rule_readbacks r WHERE r.rule_id = NEW.id AND r.business_id = NEW.business_id)
BEGIN
  SELECT RAISE(ABORT, 'a rule kept by voice needs its sentence spoken by the server');
END;

-- What Sahay remembers about how this business buys. Derived in code from orders (src/agent/memories.js),
-- never from vendor text or a model. One row per (kind, key).
CREATE TABLE IF NOT EXISTS agent_memories (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('usual_item', 'liked_vendor', 'last_price')),
  key         TEXT NOT NULL,
  data        TEXT NOT NULL,
  sentence_hi TEXT NOT NULL,
  sentence_kn TEXT NOT NULL,
  sentence_en TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (business_id, kind, key)
);

-- ============================================================================================
-- STK: stock (src/stock/*). Items, an append-only stock ledger and low-stock reorder proposals.
-- ============================================================================================

-- What the business buys or sells. `name_key` is the item's words folded the same way across
-- scripts (src/stock/items.js nameKey: "rice", "चावल" and "ಅಕ್ಕಿ" share one key), so one item is
-- never stored twice under two spellings. Quantities of an item are in its `unit` (a units.js code).
CREATE TABLE IF NOT EXISTS items (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_native   TEXT,
  name_key      TEXT NOT NULL,
  unit          TEXT NOT NULL,
  hsn           TEXT CHECK (hsn IS NULL OR (length(hsn) BETWEEN 4 AND 8 AND hsn NOT GLOB '*[^0-9]*')),
  gst_rate      REAL CHECK (gst_rate IS NULL OR (gst_rate >= 0 AND gst_rate <= 40)),
  sale_price    REAL CHECK (sale_price IS NULL OR sale_price >= 0),
  reorder_level REAL CHECK (reorder_level IS NULL OR reorder_level >= 0),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (business_id, name),
  UNIQUE (business_id, name_key)
);

-- The stock ledger. Append-only: on hand = SUM(qty), in the item's unit (+ in, - out).
CREATE TABLE IF NOT EXISTS stock_moves (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  qty         REAL NOT NULL CHECK (qty <> 0),
  reason      TEXT NOT NULL CHECK (reason IN ('opening', 'purchase', 'sale', 'adjust')),
  ref_id      TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS stock_moves_by_item ON stock_moves (business_id, item_id, created_at);
-- A delivered purchase order comes into stock once per item.
CREATE UNIQUE INDEX IF NOT EXISTS stock_moves_purchase_once ON stock_moves (business_id, item_id, ref_id) WHERE reason = 'purchase';

CREATE TRIGGER IF NOT EXISTS stock_moves_same_business
BEFORE INSERT ON stock_moves
WHEN NOT EXISTS (SELECT 1 FROM items i WHERE i.id = NEW.item_id AND i.business_id = NEW.business_id)
BEGIN
  SELECT RAISE(ABORT, 'a stock move needs an item of the same business');
END;

CREATE TRIGGER IF NOT EXISTS stock_moves_are_fixed
BEFORE UPDATE ON stock_moves
BEGIN
  SELECT RAISE(ABORT, 'a stock move cannot be changed; record an adjustment');
END;

-- Sahay noticed an item at or below its reorder level and asks the owner whether to buy more.
-- Nothing is bought here: on the owner's yes a requirement is saved and a vendor search starts
-- (the usual buying flow, with its own approval gate before any order). One open proposal per item.
-- `last_move_rowid` is the item's newest stock_moves rowid when it was proposed: the item is
-- proposed again only after its stock has been back above the level since then.
CREATE TABLE IF NOT EXISTS reorder_proposals (
  id                 TEXT PRIMARY KEY,
  business_id        TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  item_id            TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  on_hand            REAL NOT NULL,
  level              REAL NOT NULL,
  quantity           REAL CHECK (quantity IS NULL OR quantity > 0),
  unit               TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'declined', 'closed')),
  requirement_id     TEXT REFERENCES requirements(id) ON DELETE SET NULL,
  decided_via        TEXT CHECK (decided_via IN ('voice', 'button') OR decided_via IS NULL),
  evidence_utterance TEXT,
  last_move_rowid    INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  decided_at         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS reorder_proposals_one_open ON reorder_proposals (business_id, item_id) WHERE status = 'open';

CREATE TRIGGER IF NOT EXISTS reorder_proposals_same_business
BEFORE INSERT ON reorder_proposals
WHEN NEW.status <> 'open' OR NOT EXISTS (SELECT 1 FROM items i WHERE i.id = NEW.item_id AND i.business_id = NEW.business_id)
BEGIN
  SELECT RAISE(ABORT, 'a reorder proposal starts open, for an item of the same business');
END;

CREATE TRIGGER IF NOT EXISTS reorder_proposals_status_flow
BEFORE UPDATE OF status ON reorder_proposals
WHEN NOT (OLD.status = 'open' AND NEW.status IN ('accepted', 'declined', 'closed'))
BEGIN
  SELECT RAISE(ABORT, 'a reorder proposal is decided once');
END;

-- Every time the server itself spoke a proposal's question into a live call. A spoken yes is
-- evidence only for a question recorded here (approvals.answerAfterSpoken).
CREATE TABLE IF NOT EXISTS reorder_readbacks (
  id          TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  proposal_id TEXT NOT NULL REFERENCES reorder_proposals(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL,
  spoken_text TEXT NOT NULL,
  spoken_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reorder_readbacks_by_proposal ON reorder_readbacks (business_id, proposal_id, spoken_at);

CREATE TRIGGER IF NOT EXISTS reorder_readbacks_are_fixed
BEFORE UPDATE ON reorder_readbacks
BEGIN
  SELECT RAISE(ABORT, 'a recorded reorder question cannot be changed');
END;
-- ===================================== end STK ==============================================
