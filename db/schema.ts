import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey().notNull(),
  snapshotKey: text('snapshot_key').notNull(),
  savedAt: integer('saved_at').notNull(),
  nodeCount: integer('node_count').notNull(),
});

export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => accounts.id),
  title: text('title').notNull(),
  snapshotKey: text('snapshot_key').notNull(),
  updatedAt: integer('updated_at').notNull(),
  nodeCount: integer('node_count').notNull(),
}, table => [index('idx_workflows_user_updated').on(table.userId, table.updatedAt)]);

export const aiRequests = sqliteTable('ai_requests', {
  id: text('id').primaryKey().notNull(),
  userId: text('user_id').notNull(),
  day: text('day').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull().default('legacy'),
  status: text('status').notNull().default('legacy'),
  httpStatus: integer('http_status'),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: integer('created_at').notNull().default(0),
  estimatedCostCents: integer('estimated_cost_cents').notNull().default(0),
  chargedCredits: integer('charged_credits').notNull().default(0),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cachedTokens: integer('cached_tokens'),
  reasoningTokens: integer('reasoning_tokens'),
  totalTokens: integer('total_tokens'),
  costUsdMicros: integer('cost_usd_micros'),
  costStatus: text('cost_status').notNull().default('missing_usage'),
  usageSnapshot: text('usage_snapshot'),
  priceSnapshot: text('price_snapshot'),
  providerResponseId: text('provider_response_id'),
}, table => [index('idx_ai_requests_day_user').on(table.day, table.userId),
  index('idx_ai_requests_user_created').on(table.userId, table.createdAt),
  index('idx_ai_requests_created').on(table.createdAt)]);

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey().notNull(),
  email: text('email').notNull(),
  username: text('username'),
  displayName: text('display_name').notNull(),
  provider: text('provider').notNull(),
  plan: text('plan').notNull().default('free'),
  credits: integer('credits').notNull().default(0),
  status: text('status').notNull().default('active'),
  dailyLimit: integer('daily_limit'),
  createdAt: integer('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => accounts.id),
  expiresAt: integer('expires_at').notNull(),
});

export const usernameCredentials = sqliteTable('username_credentials', {
  username: text('username').primaryKey().notNull(),
  userId: text('user_id').notNull().unique().references(() => accounts.id),
  passwordHash: text('password_hash').notNull(),
});

export const libraryAssets = sqliteTable('library_assets', {
  id: text('id').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => accounts.id),
  hash: text('hash').notNull(),
  name: text('name').notNull(),
  category: text('category').notNull().default('产品实拍'),
  favorite: integer('favorite').notNull().default(0),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('idx_library_user_created').on(table.userId, table.createdAt)]);

export const emailCredentials = sqliteTable('email_credentials', {
  email: text('email').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => accounts.id),
  passwordHash: text('password_hash').notNull(),
});

export const authLimits = sqliteTable('auth_limits', {
  key: text('key').primaryKey().notNull(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const oauthStates = sqliteTable('oauth_states', {
  stateHash: text('state_hash').primaryKey().notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const creditLedger = sqliteTable('credit_ledger', {
  id: text('id').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => accounts.id),
  amount: integer('amount').notNull(),
  reason: text('reason').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('idx_credit_ledger_user_created').on(table.userId, table.createdAt)]);

export const siteSettings = sqliteTable('site_settings', {
  key: text('key').primaryKey().notNull(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const adminAudit = sqliteTable('admin_audit', {
  id: text('id').primaryKey().notNull(),
  actorId: text('actor_id').notNull(),
  action: text('action').notNull(),
  targetId: text('target_id').notNull(),
  details: text('details').notNull(),
  createdAt: integer('created_at').notNull(),
}, table => [index('idx_admin_audit_created').on(table.createdAt)]);

// 仅未来经支付回调核验的实收订单计入营收；当前没有创建/标记已支付的入口。
export const paymentOrders = sqliteTable('payment_orders', {
  id: text('id').primaryKey().notNull(),
  userId: text('user_id').notNull().references(() => accounts.id),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('CNY'),
  status: text('status').notNull().default('pending'),
  kind: text('kind').notNull(),
  createdAt: integer('created_at').notNull(),
  paidAt: integer('paid_at'),
});
