# Settings Full-Page View & Auth Gate

**Date:** 2026-03-18
**Status:** Approved

## Overview

Transform Zeus from a developer-configured tool (env vars) into a user-configurable application with a full-page settings view and an authentication gate for remote connections.

Two main deliverables:
1. **Full-Page Settings View** — replaces the existing settings modal with a dedicated view for all app configuration
2. **Auth Gate** — login screen for remote (tunnel) connections; local connections bypass auth

## Auth Gate

### Detection

- **Local connections** (`localhost`, `127.0.0.1`, `::1`, `::ffff:127.0.0.1`): no auth required, full access immediately
- **Remote connections** (ngrok domain, any other host): must authenticate before accessing Zeus

**Renderer-side detection** (`isRemoteConnection()` in `ws.ts`): checks `location.hostname` against `localhost`, `127.0.0.1`, `::1`. This is a **UX-only check** to decide whether to show the auth gate UI. It is NOT a security boundary — security is enforced server-side via `req.socket.remoteAddress`. The Electron BrowserWindow always loads from `127.0.0.1` and will never see the auth gate.

### Auth Flow

1. App boots, renderer checks if remote via `isRemoteConnection()`
2. If local → connect WebSocket immediately, no auth gate
3. If remote → check `localStorage` for saved auth token
4. If token exists → append to WebSocket URL as `?token=<value>`, attempt connection
5. If no token → render full-screen `AuthGate` component
6. User enters token in password-style input, clicks "Connect"
7. Token appended to WebSocket URL, connection attempted
8. Server validates via existing connection handler behavior:
   - **Success** → WebSocket stays open, server sends `{ type: 'auth_success' }` on status channel, renderer saves token to `localStorage`, main app renders
   - **Failure** → server closes WebSocket with code `4401` ("Unauthorized"). Renderer detects close code `4401` in the `onclose` handler → shows "Invalid token" error on auth screen, clears input. Does NOT trigger auto-reconnect for `4401` closes.
9. On subsequent visits, saved token is used automatically; if server rejects (4401), renderer clears `localStorage` token and shows auth screen

### Server-Side Enforcement

Existing behavior in `websocket.ts` is preserved and extended:

1. **Connection handler** (already exists): checks `req.socket.remoteAddress` for local addresses → auto-authenticates. Remote connections: validates `?token=` → authenticates or closes with `4401`.
2. **New: `auth_success` message** — after authenticating a remote client, server sends `{ type: 'auth_success' }` on the status channel so the renderer knows to proceed.
3. **Message-level guard** — the existing `authenticatedClients` WeakSet is already populated. Add a check at the top of `handleMessage()`: if `!authenticatedClients.has(ws)`, silently drop the message and return. This is a defense-in-depth measure; the connection handler should already prevent unauthenticated sockets from existing, but the guard protects against race conditions.

### Rate Limiting

To prevent brute-force token guessing over the tunnel:
- Track failed connection attempts per IP (in-memory `Map<string, { count: number; lastAttempt: number }>`)
- After 5 failed attempts from an IP, reject connections from that IP for 60 seconds (close with code `4429`, "Too Many Requests")
- Reset counter after a successful auth or after the cooldown expires

### New Status Channel Messages

```typescript
| { type: 'auth_success' }
```

No `auth_failed` message — failure is communicated via WebSocket close code `4401`.

## Full-Page Settings View

### Navigation

- `ViewMode` extended: `'terminal' | 'claude' | 'diff' | 'settings'`
- `⌘,` toggles between settings view and previous view (stored as `previousViewMode` in store)
- `previousViewMode` defaults to `'terminal'`; updated whenever the user navigates to a non-settings view
- When on settings view, clicking a session in the sidebar switches to that session's view and updates `previousViewMode`
- Settings page has a back arrow (top-left) to return to previous view
- Existing `SettingsModal` component is retired

### Layout

Left sidebar with category icons (vertical nav), right side with scrollable form content. Same responsive pattern as existing UI — on mobile, categories shown as horizontal tab bar at top.

### Categories & Fields

#### General
- **Power Lock** — toggle, prevent system sleep (existing)
- **WebSocket Status** — read-only badge (existing)
- **Default Shell** — dropdown populated from `availableShells` (server detects which of zsh/bash/fish exist on the host)

#### Server
- **Server Port** — number input, default `8888` (prod) / `8889` (dev)
- **Auth Token** — text input with show/hide toggle + "Regenerate" button (triggers server-side generation)
- **Auto-start on launch** — toggle (start WS server automatically, default `true`)

#### Tunnel
- **Enable Tunnel** — master toggle
- **Auto-start tunnel on launch** — toggle (only when tunnel is enabled)
- **Ngrok Auth Token** — password input with show/hide
- **Ngrok Domain** — text input, optional (for static free domain)
- **Tunnel Status** — read-only badge (Active/Off)
- **Tunnel URL** — read-only, click to copy (shown when active)

#### Appearance
- Existing `ThemePicker` component, moved from modal

#### Performance
- Existing `PerformanceTab` component, moved from modal

#### Shortcuts
- Existing keyboard shortcuts reference list, moved from modal

### Restart Required Banner

When any **Server** or **Tunnel** field is modified:
- A sticky banner appears at the top: "Restart required to apply changes"
- A "Save & Restart" button triggers: settings save via WS → main process performs graceful shutdown (marks active sessions as killed, destroys PTYs, stops tunnel, closes DB — same as `before-quit` handler) → `app.relaunch()` + `app.exit()`
- `restart_app` is **only accepted from local connections**. Remote authenticated users see a "Restart pending — ask the host to restart" message instead.
- Fields that don't require restart (**General**, **Appearance**, **Shortcuts**) save immediately as they do today
- **Default Shell** is in the General category and does NOT require restart — it's applied per-session at spawn time

## Data Flow & Persistence

### Settings File Extension

`zeus-settings.json` gains new top-level keys:

```typescript
interface SettingsOnDisk {
  // existing
  claudeDefaults: ClaudeDefaults;
  lastUsedProjectId: string | null;
  activeThemeId: string;
  // new
  server: {
    port: number;                  // default 8888
    authToken: string | null;      // null = auto-generate on startup. Encrypted via safeStorage.
    autoStart: boolean;            // default true
  };
  tunnel: {
    enabled: boolean;              // master toggle, default false
    autoStart: boolean;            // start tunnel on launch, default false
    ngrokAuthToken: string | null; // encrypted via safeStorage
    ngrokDomain: string | null;    // optional static domain
  };
  general: {
    defaultShell: string;          // 'zsh' | 'bash' | 'fish', default detected from $SHELL
  };
}
```

### Sensitive Data Handling

- `ngrokAuthToken` and `authToken` are encrypted at rest using Electron's `safeStorage` API
- Decrypted only in memory at startup
- Renderer receives masked versions (e.g., `"ngrok_1a...f3"`) and an `isSet: boolean` flag
- To update: renderer sends new plaintext value → main process encrypts and persists
- Never logged to console in plaintext

### Env Var Backward Compatibility

Environment variables still work as overrides:
- `ZEUS_WS_PORT` → overrides `server.port`
- `ZEUS_AUTH_TOKEN` → overrides `server.authToken`
- `NGROK_AUTHTOKEN` → overrides `tunnel.ngrokAuthToken`
- `NGROK_DOMAIN` → overrides `tunnel.ngrokDomain`

If an env var is set, it takes priority over the settings file value.

### Migration for Existing Users

On first load when no `tunnel` key exists in the settings file:
- If `NGROK_AUTHTOKEN` env var is set → default `tunnel.enabled = true` and `tunnel.autoStart = true`
- Otherwise → default `tunnel.enabled = false` and `tunnel.autoStart = false`

This preserves existing behavior for users who relied on env-var-based auto-start.

### Startup Flow

1. `initSettings()` loads config from disk, decrypting secrets, applying migration if needed
2. `env.ts` reads from settings as fallback when no env var is present
3. `initAuthToken()` uses settings-based token (or generates one if `null`, persists the generated token back to settings)
4. `startTunnel()` uses settings-based ngrok config
5. Tunnel auto-start controlled by `tunnel.enabled && tunnel.autoStart` (replaces `shouldTunnel: !isDev`)

### WebSocket Payloads

New additions to `SettingsPayload` union:

```typescript
| { type: 'get_server_config' }
| { type: 'server_config'; config: {
    port: number;
    authTokenMasked: string | null;
    authTokenIsSet: boolean;
    autoStart: boolean;
  }}
| { type: 'update_server_config'; config: Partial<{
    port: number;
    authToken: string;
    autoStart: boolean;
  }>}
| { type: 'regenerate_auth_token' }
| { type: 'auth_token_regenerated'; maskedToken: string }
| { type: 'get_tunnel_config' }
| { type: 'tunnel_config'; config: {
    enabled: boolean;
    autoStart: boolean;
    ngrokAuthTokenMasked: string | null;
    ngrokAuthTokenIsSet: boolean;
    ngrokDomain: string | null;
  }}
| { type: 'update_tunnel_config'; config: Partial<{
    enabled: boolean;
    autoStart: boolean;
    ngrokAuthToken: string;
    ngrokDomain: string | null;
  }>}
| { type: 'get_general_config' }
| { type: 'general_config'; config: {
    defaultShell: string;
    availableShells: string[];  // detected shells on host
  }}
| { type: 'update_general_config'; config: Partial<{
    defaultShell: string;
  }>}
| { type: 'restart_app' }       // local-only, rejected for remote connections
| { type: 'restart_required' }  // server → client notification
```

**`regenerate_auth_token`**: Server generates a new token via `crypto.randomBytes(16).toString('hex')`, encrypts and persists it, then sends back the masked version. The renderer never generates security tokens.

**`restart_app`**: Only accepted from local connections (checked via `authenticatedClients` + `remoteAddress` tracking). Performs graceful shutdown before restart.

### StatusPayload Extension

`StatusPayload` in `shared/types.ts` becomes a discriminated union to accommodate auth messages:

```typescript
export type StatusPayload =
  | { type: 'status_update'; powerBlock: boolean; websocket: boolean; tunnel: string | null }
  | { type: 'get_status' }
  | { type: 'toggle_power' }
  | { type: 'toggle_tunnel' }
  | { type: 'stop_tunnel' }
  | { type: 'auth_success' };
```

## Security Considerations

- **Token in URL query param**: The existing `?token=` approach is kept for simplicity since WebSocket upgrade requests don't support custom headers from the browser. The token may appear in ngrok logs. This is an accepted tradeoff — users who want higher security can use ngrok's built-in auth layer or IP restrictions. The auth token should be treated as a shared secret, not a password.
- **Rate limiting**: 5 failed attempts per IP → 60-second cooldown prevents brute-force over tunnel.
- **`restart_app` scoping**: Local-only to prevent remote users from disrupting the host.
- **Message-level guard**: Defense-in-depth check in `handleMessage()` for unauthenticated sockets.

## Files to Create / Modify

### New Files
- `src/renderer/src/components/SettingsView.tsx` — full-page settings view
- `src/renderer/src/components/AuthGate.tsx` — auth login screen for remote connections

### Modified Files
- `src/shared/types.ts` — new `SettingsPayload` variants, `StatusPayload` discriminated union, `ViewMode` type, config types
- `src/main/services/settings.ts` — new `server`, `tunnel`, `general` fields, `safeStorage` encryption, getters/setters, migration logic
- `src/main/services/env.ts` — read from settings as fallback
- `src/main/services/auth.ts` — read token from settings instead of only env var, `regenerateToken()` function
- `src/main/services/tunnel.ts` — read ngrok config from settings instead of only env vars
- `src/main/services/websocket.ts` — `auth_success` message on remote auth, message-level auth guard, rate limiting, new settings channel handlers, `restart_app` handler (local-only), available shells detection
- `src/main/index.ts` — startup flow uses settings-based config, tunnel auto-start logic
- `src/renderer/src/App.tsx` — replace `SettingsModal` with `SettingsView` (viewMode), add `AuthGate` wrapper for remote connections
- `src/renderer/src/stores/useZeusStore.ts` — `serverConfig` / `tunnelConfig` / `generalConfig` state, `previousViewMode`, settings view actions
- `src/renderer/src/lib/ws.ts` — `isRemoteConnection()` helper, handle close code `4401` (no auto-reconnect, show auth gate), `4429` handling
- `src/renderer/src/components/SettingsModal.tsx` — deleted (replaced by SettingsView)
