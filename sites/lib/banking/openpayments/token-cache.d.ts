declare const cacheIdentity: unique symbol;
/** Opaque, process/isolate-local capability created by verified server wiring. */
export interface OpenPaymentsTokenCacheIdentity {readonly [cacheIdentity]: true;}
export function createOpenPaymentsTokenCacheIdentity(): OpenPaymentsTokenCacheIdentity;
/** Permanent invalidation. A rotated transport must obtain a fresh identity. */
export function invalidateOpenPaymentsTokenCacheIdentity(identity: OpenPaymentsTokenCacheIdentity): void;
