# Cladel

Research thought-mapping desktop application built with Tauri v2. Combines literature management (PDF import), personal thought mapping on a knowledge graph, and AI agents (Claude / Gemini) as collaborative research partners.

## Requirements

### System

| Tool | Minimum Version | Notes |
|------|----------------|-------|
| **Node.js** | 18+ | Tested with v24.x |
| **npm** | 9+ | Comes with Node.js |
| **Rust** | 1.77+ | Install via [rustup](https://rustup.rs/) |
| **Cargo** | 1.77+ | Comes with Rust |

### Platform-Specific

**macOS**
- Xcode Command Line Tools: `xcode-select --install`

**Windows**
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- WebView2 (pre-installed on Windows 10/11)

**Linux**
- System libraries for WebView2 and GTK. See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## Getting Started

```bash
# Clone the repository
git clone <repository-url>
cd Tsumugix

# Install frontend dependencies
npm install

# Run in development mode (starts both Vite dev server and Tauri window)
npm run tauri dev
```

The app launches at `http://localhost:1420` inside a Tauri WebView window.

## Development

### Commands

| Command | Description |
|---------|-------------|
| `npm run tauri dev` | Start the app in development mode (hot-reload) |
| `npm run tauri build` | Build a production release |
| `npm run dev` | Start Vite dev server only (frontend) |
| `npm run build` | Build frontend only (`tsc && vite build`) |
| `npx tsc --noEmit` | TypeScript type-check without emitting files |

### Rust Environment

If `cargo` is not in your PATH, source the Rust environment first:

```bash
source "$HOME/.cargo/env"
```

### Type Checking

For quick validation without starting the full app:

```bash
npx tsc --noEmit
```

### Project Structure

```
Tsumugix/
├── src/                          # Frontend (React + TypeScript)
│   ├── App.tsx                   # Main app shell
│   ├── main.tsx                  # Entry point (HashRouter)
│   ├── types/index.ts            # Shared interfaces & defaults
│   ├── lib/
│   │   ├── tauri-commands.ts     # Typed wrappers for Tauri invoke
│   │   ├── detached-window.ts    # Multi-window management
│   │   ├── sync-events.ts        # Cross-window event bus
│   │   └── userColors.ts         # User-based coloring palette
│   ├── store/                    # Zustand stores (11 stores)
│   ├── hooks/                    # React hooks (idle, triggers)
│   └── components/
│       ├── graph/                # Canvas, node types, edge types
│       ├── panels/               # Right sidebar, viewers, editors
│       ├── dialogs/              # Modal dialogs (settings, import, etc.)
│       └── layers/               # Layer bar
├── src-tauri/                    # Backend (Rust)
│   ├── src/
│   │   ├── main.rs               # Entry point
│   │   ├── lib.rs                # Command registration (111 commands)
│   │   ├── db.rs                 # SQLite schema & migrations
│   │   └── commands/             # Command modules (22 submodules)
│   │       ├── agent/            # AI agent subsystem
│   │       ├── nodes.rs          # Node CRUD
│   │       ├── edges.rs          # Edge CRUD
│   │       ├── pdf_import.rs     # PDF import pipeline
│   │       ├── pdf_export.rs     # PDF export (genpdf)
│   │       └── ...
│   ├── fonts/                    # Bundled LiberationSerif fonts
│   ├── Cargo.toml
│   └── tauri.conf.json
├── sample/                       # Sample .cld file
├── package.json
└── CLAUDE.md                     # Full codebase reference
```

### Tech Stack

- **Framework**: Tauri v2 (Rust backend + WebView frontend)
- **Frontend**: React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, MUI 7, React Flow 12, Zustand 5
- **Backend**: rusqlite (bundled SQLite), reqwest, pdf-extract, genpdf, serde
- **AI**: Anthropic Claude API, Google Gemini API

### File Format

Cladel uses `.cld` files (SQLite databases in DELETE journal mode) as single portable files. Legacy `.klv` and `.tmgx` formats are supported for reading only.

- Text and metadata only -- PDFs and images are referenced by local file path, not stored in the database.
- The app starts with an in-memory database; no file is created until the user performs Save As.
- `VACUUM INTO` is used for Save As to produce a compacted copy.

### Database Migrations

Schema is version-tracked (`SCHEMA_VERSION = 19`). Migrations run automatically on file open. They are append-only -- never reorder existing migrations. See `src-tauri/src/db.rs` for details.

### Adding a New Tauri Command

1. Implement the command function in the appropriate file under `src-tauri/src/commands/`
2. Register it in the `generate_handler![]` macro in `src-tauri/src/lib.rs`
3. Add a typed frontend wrapper in `src/lib/tauri-commands.ts`

### IPC Conventions

- **Command names**: `snake_case` in Rust and `invoke()` calls
- **Function params**: auto-converted to `camelCase` by Tauri boundary
- **Struct fields inside wrapped params**: stay `snake_case`
- **Response fields**: `snake_case` as defined in Rust `Serialize` structs

## Configuration

### API Keys

Configured in-app via Settings dialog (gear icon or `Cmd+,`):

- **Anthropic API Key** -- Required for Claude-powered features (global agent, agent nodes, comment agent, PDF import fallback)
- **Gemini API Key** -- Required for paper summarization/chat, NanoBanana image generation; optional for agent nodes

### Settings Storage

Settings are stored at:

```
~/Library/Application Support/com.cladel.desktop/settings.json
```

(via `tauri-plugin-store`)

## Building for Production

```bash
npm run tauri build
```

Output binaries are placed in `src-tauri/target/release/bundle/`.

## Reference

See [`CLAUDE.md`](./CLAUDE.md) for comprehensive codebase documentation including:

- Complete data model and schema
- All 111 registered Tauri commands
- Node type specifications and visual design tokens
- Agent system architecture
- Feature specifications
- Known issues and lessons learned
