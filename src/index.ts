// Single browser bundle for the April Gate site.
// Verify is public/read-only; register is operator/wallet-signed.
export { verifyShipment, verifyByNonce } from "./verifier";
export type { Verdict, VerdictStatus, VerifyOptions } from "./verifier";
export { registerDevice } from "./register/register";
export type { RegisterResult } from "./register/register";
