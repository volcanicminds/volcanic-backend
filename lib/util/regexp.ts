// The patterns the framework itself validates with (T-10.29). Only these: the exports map of
// the package exposes `.` and `./db`, so nothing in this file is reachable by a consumer, and a
// pattern the framework does not use is a pattern nobody runs. The username, alternative email,
// Italian tax-code, IBAN and phone patterns that stood here were exactly that, and they were
// also rules of one country's domain inside a framework that has none.
//
// NOTE: no `g` flag on any of them — with it, `.test()` is stateful (advances lastIndex) and
// returns alternating true/false across calls on the same input.

/*
 * email can have multiple words
 * email can use . - or + for smart labeling
 * TLD has no upper length limit (e.g. .test, .info, .email)
 * NOTE (S10 — ReDoS): the separators inside the repeating groups are REQUIRED
 * (`[.+-]`/`[.-]`, not `[.+-]?`/`[.-]?`). With an optional separator the pattern
 * degenerates to `\w+(\w+)*`, which partitions a run of word-chars in
 * exponentially many ways → catastrophic backtracking on a long non-matching
 * input (e.g. many word-chars with no `@`). Making the separator required gives
 * a single partition → linear time. Always validate via `isEmail()` so the
 * length guard runs first.
 */
export const email = /^\w+([.+-]\w+)*@\w+([.-]\w+)*(\.\w{2,})+$/

// RFC 5321: an email address (forward path) is at most 254 characters.
export const MAX_EMAIL_LENGTH = 254

/*
 * Canonical email validator: bounds the input length BEFORE the regex match
 * (defense in depth) and then applies the (linear) `email` pattern. Prefer this
 * over calling `email.test()` directly.
 */
export const isEmail = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_EMAIL_LENGTH && email.test(value)

/*
 * password must contain at least: 1 lowercase, 1 uppercase, 1 digit, 1 special char
 * password is at least 8 characters with no space
 * NOTE: the `-` inside the special-char class is escaped (`\-`). Without the
 * escape, `()-_` is parsed as the range )..._ (0x29-0x5F), which makes letters
 * and digits satisfy the "1 special char" requirement (i.e. it is NOT enforced).
 */
export const password =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%&*()\-_=+[\]{}|;:'",.<>?^])[A-Za-z\d!@#$%&*()\-_=+[\]{}|;:'",.<>?^]{8,}$/
