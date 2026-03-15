# Zeus Code Rules

Standards and conventions for writing code in this repo. Follow these strictly.

---

## Project Structure

```
zeus/
├── electron.vite.config.ts     # electron-vite build config
├── tsconfig.json               # root (references node + web)
├── tsconfig.node.json          # main process + preload TS config
├── tsconfig.web.json           # renderer (React) TS config
├── package.json                # main → out/main/index.js
│
├── src/
│   ├── main/                   # Electron main process
│   │   ├── index.ts            # Entry: create window, bootstrap services
│   │   ├── services/           # One file per concern (power, websocket, terminal, tunnel, git)
│   │   └── ipc/                # ipcMain.handle() registrations
│   │
│   ├── preload/                # contextBridge scripts (runs in isolated context)
│   │   └── index.ts
│   │
│   └── renderer/               # React UI (Vite + React)
│       ├── index.html          # Vite entry HTML
│       └── src/
│           ├── main.tsx        # ReactDOM.createRoot
│           ├── App.tsx         # Root component
│           └── styles.css      # Global styles
│
└── out/                        # Build output (gitignored)
    ├── main/
    ├── preload/
    └── renderer/
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Starts electron-vite dev server with HMR |
| `npm run build` | Production build → `out/` |
| `npm run start` | Build + preview (launch built app) |

## TypeScript Rules

- **Strict mode always on.** No `any` unless absolutely unavoidable.
- Main/preload: `commonjs` module, target `ES2022`.
- Renderer: `ESNext` module with `bundler` resolution, `react-jsx` transform.
- Use `import`/`export` in source. The build tooling handles module output.

## Main Process Rules

- `src/main/index.ts` stays lean (~40 lines). It only creates the window and calls service init functions.
- Each service exports `start`/`stop` functions (e.g., `startPowerBlock()`, `stopPowerBlock()`).
- New features = new file in `services/`. Never bloat `index.ts`.
- All IPC handlers go in `src/main/ipc/handlers.ts`. Don't scatter `ipcMain.handle()` across service files.
- Use `async/await` for everything async. No raw callbacks.

## Renderer Rules

- **One component per file. Always.** Never define a helper component inside another component's file. Even small components like `StatusRow` get their own file in `components/`. No exceptions.
- React components go in `src/renderer/src/components/`.
- Page-level components go in `src/renderer/src/pages/` (if needed later).
- Keep components small and focused.
- **Always use `@/` path alias for imports.** Never use relative paths (`./`, `../`). `@` maps to `src/renderer/src/`. Example: `import StatusRow from '@/components/StatusRow'`.
- **Use Tailwind utility classes for all styling.** No custom CSS files per component. Zeus color tokens are defined in `styles.css` via `@theme` (e.g., `bg-zeus-card`, `text-zeus-green`). Add new tokens there if needed.
- No direct Node.js usage. Everything goes through the `zeus` API exposed via preload.
- All communication with main process: `window.zeus.<method>()` → IPC → service.

## Preload Rules

- Only expose serializable data through `contextBridge`.
- One-to-one mapping: each exposed method = one IPC channel.
- Never expose raw `ipcRenderer`. Always wrap in typed functions.

## Security

- `contextIsolation: true` — never disable.
- `nodeIntegration: false` — never enable.
- No secrets in code. Use env vars or Electron `safeStorage`.
- Token auth on all WebSocket connections.

## Git & Workflow

- Commit after each completed step.
- Update `DEVLOG.md` after every step with what was done and why.
- Test each phase fully before moving to the next.
