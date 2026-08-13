/**
 * The platform seam.
 *
 * Everything here is written as though three more apps will use it, which mostly
 * means one discipline: nothing in this file mentions recipes. `appKey` is how a
 * tenant identifies itself, and a second app adds a row rather than a column.
 *
 * The recipe app is tenant #1 and only its needs are implemented — but the shape
 * is the part that is expensive to change later, so the shape is general.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  email: string;
}

export interface Family {
  id: string;
  name: string;
  ownerAccountId: string;
  /**
   * Which units this household reads.
   *
   * A household setting, not a per-recipe or per-catalog one: somebody who types metric on Monday
   * and imperial on Thursday should still read one consistent list (decisions §28). It lives on
   * the platform side because `families` does, so app code reads it through the seam and cannot
   * write it — changing a household's settings is a platform operation.
   */
  measurementSystem: MeasurementSystem;
}

/** Kept in step with `packages/core`'s own union rather than imported, so the seam stays free of it. */
export type MeasurementSystem = "us" | "metric";

/**
 * A person in the household. Adults have `accountId`; children are rated but
 * never sign in, so theirs is null. Keeping these separate from accounts is what
 * lets a household rate a recipe for a six-year-old without provisioning them an
 * identity — and every app in the portfolio inherits the same definition.
 */
export interface FamilyMember {
  id: string;
  familyId: string;
  accountId: string | null;
  displayName: string;
  colour: string | null;
  isChild: boolean;
}

export interface Session {
  account: Account;
  family: Family;
  members: FamilyMember[];
}

export type Platform = "ios" | "android" | "web";

export interface Device {
  id: string;
  platform: Platform;
}

// ---------------------------------------------------------------------------
// Entitlement
// ---------------------------------------------------------------------------

/**
 * One named counter. `limit` and `used` rather than a bare remaining balance, so a
 * client can render "160 of 500" and so a reset is a change to one field.
 *
 * The numbers themselves are set when an entitlement is issued (the billing task).
 * Nothing here invents them — whether there is a free tier at all is still open in
 * docs/decisions.md.
 */
export interface QuotaCounter {
  limit: number;
  used: number;
  /** when `used` returns to zero; null for a non-renewing allowance */
  resetsAt: string | null;
  /**
   * Length of a period in days. Absent means a one-off allowance: it renews when
   * `resetsAt` passes and then never again.
   *
   * The rollover happens inside the same statement that spends — see
   * `platform_spend_quota`. A separate reset job would race the spend it is
   * resetting.
   */
  periodDays?: number;
}

/** Named counters, e.g. `{ imports: { limit: 500, used: 160, resetsAt: … } }`. */
export type Quota = Record<string, QuotaCounter>;

/** Deliberately one tier. Tier design is a product decision, not a schema one. */
export type Tier = "full";

/**
 * An entitlement, exactly as stored.
 *
 * `graceUntil` is a column rather than something this package computes. It used to
 * be computed here, on the reasoning that grace is issuance policy — but once the
 * database enforces read-only degradation through an RLS predicate, the predicate
 * and the token have to agree about when grace ends, and the only way to guarantee
 * that is for both to read the same value.
 *
 * `graceUntilFor` is still exported for whoever issues an entitlement to compute a
 * window with; it is just no longer consulted on the read path.
 */
export interface Entitlement {
  familyId: string;
  appKey: string;
  tier: Tier;
  quota: Quota;
  /** ISO 8601 */
  validUntil: string;
  /** ISO 8601. After this the household is read-only; it never locks. */
  graceUntil: string;
}

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

/**
 * What the app may do right now.
 *
 * There is deliberately no "locked" level. A family must not lose access to their
 * own recipes because a card expired mid-shop, so the worst state is read-only.
 * `canRead` exists as an explicit, always-true field rather than an absence, so
 * that adding a locking state later is a visible change to this type rather than
 * something that slips in behind a boolean.
 */
export type AccessLevel = "full" | "grace" | "read-only";

export interface Access {
  level: AccessLevel;
  canRead: true;
  canWrite: boolean;
  /** true in grace: keep working, and nag */
  shouldRenew: boolean;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

/**
 * What travels on the device. You cannot call a licence server from a supermarket
 * basement, so entitlement decisions have to be answerable offline.
 *
 * `quota` here is for display only. The balance a device carries is a snapshot;
 * spending is always a server call, because two devices offline at once would
 * otherwise both believe they had the last import.
 */
export interface TokenPayload {
  /** token format version, so a format change is not a silent misparse */
  v: 1;
  familyId: string;
  accountId: string;
  members: Array<Pick<FamilyMember, "id" | "displayName" | "isChild">>;
  entitlements: Record<string, { tier: Tier; quota: Quota }>;
  issuedAt: string;
  validUntil: string;
  graceUntil: string;
}

export interface SignedToken {
  token: string;
  payload: TokenPayload;
}

/**
 * Signing lives behind a port so the main entry point pulls in no crypto and stays
 * bundleable for React Native. `src/crypto.ts` is the Ed25519 implementation and is
 * server-only.
 */
export interface TokenSigner {
  sign(payload: TokenPayload): Promise<string> | string;
}

export interface TokenVerifier {
  /** Returns the payload, or null for anything that fails to verify. Never throws. */
  verify(token: string): Promise<TokenPayload | null> | TokenPayload | null;
}

/**
 * The ports above tolerate async because a signer backed by a KMS or an HSM would
 * need it. The Ed25519 implementation is genuinely synchronous, and says so — a
 * caller holding the concrete type should not have to await something that never
 * suspends.
 */
export interface SyncTokenSigner extends TokenSigner {
  sign(payload: TokenPayload): string;
}

export interface SyncTokenVerifier extends TokenVerifier {
  verify(token: string): TokenPayload | null;
}

// ---------------------------------------------------------------------------
// Storage port
// ---------------------------------------------------------------------------

/**
 * The only interface that knows platform tables exist.
 *
 * Swapping storage — or extracting a real platform service for app #2 — means
 * writing one of these, not touching a caller. The Supabase implementation is
 * `src/supabase-store.ts`; the tests use an in-memory one, which is the cheapest
 * proof that the abstraction actually holds.
 */
export interface PlatformStore {
  findAccount(accountId: string): Promise<Account | null>;
  /** The account's own household if it owns one, otherwise its earliest membership. */
  findFamilyForAccount(accountId: string): Promise<Family | null>;
  listMembers(familyId: string): Promise<FamilyMember[]>;
  findEntitlement(familyId: string, appKey: string): Promise<Entitlement | null>;
  /**
   * Atomically add `amount` to a counter, refusing if it would exceed the limit.
   *
   * Atomicity is the whole point: read-then-write would let two devices importing
   * at the same moment both spend the last unit. Returns the counter as it stands
   * after a successful spend, or null when the spend was refused.
   */
  spendQuota(input: SpendQuotaInput): Promise<QuotaCounter | null>;
  registerDevice(input: RegisterDeviceInput): Promise<Device>;
  /**
   * Give a newly signed-up person an account, a household and a place in it.
   *
   * The first thing outside test fixtures to write platform tables. It lives on the
   * port rather than in the web app for the reason the whole seam exists: these are
   * the three tables app code may not touch, and `check-platform-tables.mjs` fails
   * the build on a direct query.
   *
   * **Idempotent**, because sign-up is a place people double-click and refresh. An
   * account that already has a household gets that household back, untouched, with
   * `created: false` — never a second one.
   *
   * Issues **no entitlement**, deliberately. A household with none cannot write
   * (decisions §9: absence is not an unmetered allowance), so a freshly provisioned
   * household can read and not write until entitlement issuance exists. Inventing a
   * trial here would be deciding the free-tier question that `docs/decisions.md`
   * lists as open.
   */
  provisionHousehold(input: ProvisionHouseholdInput): Promise<ProvisionedHousehold>;
  /**
   * Write a household's entitlement.
   *
   * The capability, not a policy. **Nothing here decides who gets one, what tier, or what
   * the numbers are** — a caller states all of it. That separation is the point: real
   * issuance is a billing webhook, and it is blocked on Apple's outside-purchase rules
   * (`docs/decisions.md`, Unresolved), so the only thing that should exist before that
   * decision is the mechanism.
   *
   * Idempotent by `(family_id, app_key)`, which the schema already makes unique — a
   * replayed webhook is an update, not a duplicate.
   */
  issueEntitlement(input: IssueEntitlementInput): Promise<Entitlement>;
}

export interface IssueEntitlementInput {
  familyId: string;
  appKey: string;
  tier: Tier;
  quota: Quota;
  validUntil: string;
  graceUntil: string;
}

export interface ProvisionHouseholdInput {
  /** the authenticated account; the same uuid as `auth.users.id` */
  accountId: string;
  email: string;
  householdName: string;
  /** what the adult is called inside the household, not their login */
  displayName: string;
}

export interface ProvisionedHousehold {
  account: Account;
  family: Family;
  member: FamilyMember;
  /** false when the account already had a household and nothing was created */
  created: boolean;
}

export interface SpendQuotaInput {
  familyId: string;
  appKey: string;
  /** counter name, e.g. "imports" */
  quota: string;
  amount: number;
}

export interface RegisterDeviceInput {
  accountId: string;
  platform: Platform;
  /** reuse an existing registration rather than adding a row per sign-in */
  deviceId?: string;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export type QuotaOutcome =
  | { status: "allowed"; counter: QuotaCounter }
  | { status: "exceeded"; counter: QuotaCounter }
  | { status: "no-entitlement" };

export interface EntitlementResult {
  entitlement: Entitlement;
  access: Access;
  /** present when a signer is configured; this is what the device carries */
  token?: SignedToken;
}

export interface PlatformClient {
  getSession(): Promise<Session>;
  getEntitlement(appKey: string): Promise<EntitlementResult | null>;
  /** Server-authoritative. `quota` defaults to "imports". */
  consumeQuota(appKey: string, amount: number, quota?: string): Promise<QuotaOutcome>;
  registerDevice(platform: Platform, deviceId?: string): Promise<Device>;
}

/** Injected so tests and the grace-window logic never depend on the wall clock. */
export type Clock = () => Date;

export interface PlatformClientOptions {
  store: PlatformStore;
  /** the signed-in account; the caller has already authenticated it */
  accountId: string;
  signer?: TokenSigner;
  clock?: Clock;
}
