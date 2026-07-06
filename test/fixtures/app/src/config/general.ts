'use strict'

// The cache master switch is opt-in (off by default in the framework). This
// fixture app turns it on so the per-route cache E2E specs exercise the real
// hooks; ttl/maxEntries fall back to the framework defaults (3600s / 1000).
export default {
  name: 'general',
  options: {
    cache: { enabled: true }
  }
}
