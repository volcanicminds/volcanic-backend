/*
 * min 3 max 33, one special character (. _ -) only in the middle
 * username can have uppercase or lowercase chars
 */
// NOTE: no `g` flag — with it, `.test()` is stateful (advances lastIndex) and
// returns alternating true/false across calls on the same input.
export const username = /(?=^.{3,33}$)^[a-z][a-z0-9]*[._-]?[a-z0-9]+$/i
// NOTE (S10): separators here are already required (`\.`), so this variant is
// linear and not ReDoS-prone. Guard length with MAX_EMAIL_LENGTH if you use it.
export const emailAlt =
  /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

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
export const zipCode = /(^\d{5}$)|(^\d{5}-\d{4}$)/
export const taxCodePersona =
  /^[a-zA-Z]{6}[0-9]{2}[abcdehlmprstABCDEHLMPRST]{1}[0-9]{2}([a-zA-Z]{1}[0-9]{3})[a-zA-Z]{1}$/

/*
 * taxCode can have 2 letter (IT,DE,..) and 11 digits
 */
export const taxCodeCompany = /^([A-Z]{2}|)[0-9]{11}$/
export const iban = /^[a-zA-Z]{2}[0-9]{2}[a-zA-Z0-9]{4}[0-9]{7}([a-zA-Z0-9]?){0,16}$/
export const mobilePhone = /^((00|\+)39)?3[0-9]{8,9}$/
export const landLinePhone = /^(((00|\+)39))?[\s]?(0{1}[1-9]{1,3})[\s]?(\d{4,6})$/
export const tollFreePhone = /^((00|\+)39)?(800|803|167)\d{3,6}$/
