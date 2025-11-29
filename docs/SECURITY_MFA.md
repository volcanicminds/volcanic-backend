# Security: Multi-Factor Authentication (MFA)

`@volcanicminds/backend` includes a robust, native implementation of Multi-Factor Authentication (TOTP based), designed to secure access without requiring external identity providers.

## Configuration

MFA behavior is controlled globally via environment variables (`MFA_POLICY`) or the configuration file `src/config/general.ts`.

```typescript
// src/config/general.ts
export default {
  name: 'general',
  enable: true,
  options: {
    // ...
    mfa_policy: process.env.MFA_POLICY || 'OPTIONAL'
  }
}
```

### Policies

- **`OPTIONAL`** (Default): Users can choose to enable or disable MFA from their profile settings.
- **`MANDATORY`**: MFA is enforced for all users.
  - If a user logs in and MFA is not configured, they are forced to set it up immediately.
  - Users cannot disable MFA once enabled.
- **`ONE_WAY`**: Users are not forced to enable it, but once they do, they cannot disable it themselves. Only an administrator can reset it.

## The "Gatekeeper" Architecture

The framework uses a **Two-Stage Login** process to ensure security. When MFA is required (due to policy or user preference), the login endpoint does _not_ return a valid access token immediately.

### 1. Login Attempt

**POST** `/auth/login`
If credentials are valid but MFA is pending:

- **Status**: `202 Accepted`
- **Body**:
  ```json
  {
    "mfaRequired": true,
    "mfaSetupRequired": false,
    "tempToken": "eyJhbGci..."
  }
  ```
- **Temp Token**: This JWT has a special role `pre-auth-mfa`. It has a short lifespan (e.g., 5 minutes) and extremely limited privileges.

### 2. The Guard Middleware

The global `onRequest` hook inspects the JWT. If the role is `pre-auth-mfa`, it blocks access to **all** endpoints except the MFA whitelist:

- `/auth/mfa/setup`
- `/auth/mfa/enable`
- `/auth/mfa/verify`
- `/auth/logout`

Trying to access `/users` or `/orders` with a temp token results in a `403 Forbidden`.

### 3. Verification

**POST** `/auth/mfa/verify`

- **Headers**: `Authorization: Bearer <tempToken>`
- **Body**: `{ "token": "123456" }` (The TOTP code)

If valid, the server returns `200 OK` with the **Final Access Token** and Refresh Token. The user is now fully logged in.

## Setup Flow

If `mfaSetupRequired` is true:

1.  Call **POST** `/auth/mfa/setup` (using `tempToken`).
    - Returns: `secret`, `qrCode` (Data URL), `uri`.
2.  Frontend displays QR Code.
3.  User scans QR and enters a code.
4.  Call **POST** `/auth/mfa/enable` (using `tempToken`).
    - Body: `{ "secret": "...", "token": "..." }`
    - Returns: **Final Access Token** (User is logged in immediately).

## Admin & Recovery

### Admin Reset

An administrator can disable MFA for a specific user (e.g., lost device) via API:
**POST** `/users/:id/mfa/reset` (Requires Admin privileges).

### Emergency Admin Lockout

If the administrator themselves loses access to their MFA device, the framework provides a filesystem/environment-based "Backdoor" designed for emergency recovery.

1.  **Set Environment Variables**:
    Set these in your server environment (e.g., `docker-compose.yml` or `.env`):

    ```bash
    MFA_ADMIN_FORCED_RESET_EMAIL=admin@example.com
    MFA_ADMIN_FORCED_RESET_UNTIL=2025-12-31T15:00:00.000Z
    ```

    - `EMAIL`: The email of the admin user to reset.
    - `UNTIL`: A timestamp in the near future (must be within 10 minutes of server startup for security).

2.  **Restart Server**:
    On startup (`index.ts`), the framework checks these variables. If valid, it **forcibly disables MFA** for that user.

3.  **Login & Cleanup**:
    The admin can now log in with just the password. **Important:** Remove these variables immediately after recovery to seal the security hole.
