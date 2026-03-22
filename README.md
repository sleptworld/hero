# Hero

[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

Desktop app built with Next.js 16, React 19, and Tauri 2.

## Features

- Cross-platform desktop build (macOS, Linux, Windows)
- Modern frontend stack with App Router
- Native desktop runtime via Tauri 2 (Rust backend)
- Automated GitHub Release pipeline with `tauri-apps/tauri-action`

## Tech Stack

- Next.js 16
- React 19
- TypeScript
- Tauri 2
- Rust (stable)
- Tailwind CSS + shadcn/ui

## Requirements

- Node.js 20+
- npm 10+
- Rust stable (via `rustup`)
- Platform-specific Tauri system dependencies

## Getting Started

Install dependencies:

```bash
npm install
```

Run web development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Run desktop development mode:

```bash
npx tauri dev
```

## Build

Build frontend:

```bash
npm run build
```

Build desktop bundles:

```bash
npx tauri build
```

## Release (GitHub Actions)

Workflow file:

- [`.github/workflows/tauri.yml`](.github/workflows/tauri.yml)

Trigger options:

- Push a tag matching `v*` (example: `v0.1.0`)
- Manual trigger via `workflow_dispatch`

What it does:

- Builds on `macos-latest`, `ubuntu-22.04`, and `windows-latest`
- Creates/updates a GitHub Release draft using `tauri-apps/tauri-action`


## Project Structure

```txt
app/                 # Next.js App Router
components/          # UI and feature components
lib/                 # Shared utilities and logic
src-tauri/           # Rust + Tauri project
.github/workflows/   # CI/CD workflows
```

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Commit your changes.
4. Open a pull request.

For larger changes, please open an issue first to discuss scope and design.
