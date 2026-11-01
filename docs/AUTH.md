# Sign-in: WorkOS AuthKit (replacing Cloudflare Access)

Nexus supports two sign-ins, chosen by `AUTH_PROVIDER` (a plain variable in `wrangler.jsonc`): `access` (Cloudflare Access, the default), `both` (accepts either, for
verifying WorkOS while Access still works) and `workos` (WorkOS AuthKit only). Nothing changes until it is set. The approach is ported from the Framework client portal
(`frameworkyyc/Framework`, `worker/portal/`): PKCE authorization-code flow, server-side code exchange, access token verified against WorkOS's signing keys (issuer, client
and session id pinned), invitations through the WorkOS API.

## How it works
* `GET /api/auth/login` → WorkOS AuthKit (passwordless: an emailed code). `GET /api/auth/callback` verifies state, exchanges the code, verifies the token and the verified email,
  then requires a Nexus membership that is not revoked. `POST /api/auth/logout` ends the Nexus session and returns the WorkOS logout address.
* **Invitation-only**: WorkOS sign-up is off, and a verified WorkOS user with no Nexus membership gets no session. Admins invite in Setup → Team members; WorkOS emails the invitation.
* **Sessions**: `auth_sessions` (migration 0027). The cookie `__Host-nx_session` holds a random token; only its HMAC is stored. 12 h idle, 14 days absolute.
* **Authorization is unchanged and server-side**: every request resolves role, status and projects from `user_roles` / `user_projects`. Revoking a member refuses their next request.
  A member is bound to the WorkOS user id that first signed in, so a reused email cannot take over a membership.

## Before switching on (manual)
1. **WorkOS**: use a separate WorkOS project/environment for Nexus, or at least a separate AuthKit application. An invitation email links to the environment's default application's
   sign-in URL, so in a shared environment it would point at the Framework portal. In the Nexus environment: AuthKit on, **Magic Auth (email code) on, password off, sign-up off**.
2. **Redirect URI** `https://<host>/api/auth/callback`; **Sign-in endpoint (initiate login URL)** `https://<host>/api/auth/login`; **Sign-out redirect** `https://<host>`.
   Staging host: `staging.nexus.frameworktools.ca`. Production host: `nexus.frameworktools.ca`.
3. **Secrets** per environment (never in the repo): `WORKOS_API_KEY` (that environment's API key) and `SESSION_PEPPER` (32+ random characters):
   `npx wrangler preview secret put WORKOS_API_KEY --name staging` (and `SESSION_PEPPER`). Production gets its own pair, set only at the production release.
4. **Variables** in `wrangler.jsonc` `previews.vars`: `WORKOS_CLIENT_ID` (public), `APP_BASE_URL` (the origin above). Then set `AUTH_PROVIDER` to `both`, sign in, check Team members,
   roles and projects, revoke and restore; only then set `workos` and remove the Access application from the hostname. Rollback: set `access` again.
5. **First administrator**: the existing admin membership stays. Use Resend invitation on it (or `INITIAL_ADMIN_EMAIL`) so WorkOS can create their sign-in.
