# Installation

This document covers installing, enabling, updating, and uninstalling **LifeCode Skill Center 1.0.1** in
DeepSeek Harness. It also states exactly which installation route is verified and which is still pending.

> **Status of GitHub installation: not verified.** The repository is a monorepo; the installable bundle is
> the `lifecode-skill-center/` package inside it. The Host plugin manager accepts a Git address, but an
> install from GitHub has not been exercised against a temporary profile. Section
> [GitHub installation (candidate)](#github-installation-candidate) records the candidate syntax and the
> pending test. Do not present the candidate as a supported route until that test passes.

## 1. Prerequisites

- A DeepSeek Harness installation whose Web client and **Plugins** manager are available.
- The Host's built-in web server enabled; the panel API is served under
  `/lifecode-skill-center/api` on the same origin as the DSH web UI.
- A writable DSH home directory. Precedence: the configured home, then `DSH_HOME`, then `~/.dsh`.
- Node.js available to the Harness (the plugin declares `@deepseek-ai/dsh-tools` as its runtime dependency).

The plugin does not open its own network port and does not need a database.

## 2. Verified route — clone and install from a local path

This is the route exercised in this repository.

### 2.1 Clone

```sh
git clone https://github.com/designerbyron/plugins-dsh.git
cd plugins-dsh/lifecode-skill-center
```

Windows PowerShell equivalent:

```powershell
git clone https://github.com/designerbyron/plugins-dsh.git C:\src\plugins-dsh
Set-Location C:\src\plugins-dsh\lifecode-skill-center
```

### 2.2 Install the plugin's dependencies

```sh
npm install
```

This step is mandatory for a path install. The profile links the plugin directory, so the plugin loads its
declared dependency from that directory. Without `npm install`, the bundle can install and then fail at
activation with a module-resolution error.

### 2.3 Add the bundle in the Plugins page

1. Open **Plugins** in the DSH sidebar.
2. Choose **Add plugin**.
3. Paste the **absolute path** of the plugin directory, for example:
   - Linux/macOS: `/home/<user>/src/plugins-dsh/lifecode-skill-center`
   - Windows: `C:\src\plugins-dsh\lifecode-skill-center`
4. Review what the Host read (package name, version, description) and confirm the install.
5. When the result is **Installed**, choose **Enable now**.

The package declares `dsh.bundle.patch: ./cordis.patch.yml`. A package without a bundle patch is not a
plugin; the manager will say so before installing.

### 2.4 Restart, then reload

The HTTP route is registered when the plugin mounts its `webServer` hook. A running Harness that already
served requests keeps the old module until it is restarted.

1. Restart the Harness if the install result asks for it.
2. Reload the DSH web page so the browser loads the client half of the plugin.
3. Confirm the sidebar entry **LifeCode Skill Center** appears.

### 2.5 Verify the installation

With the Harness running, request the health and capability surfaces:

```sh
curl -i http://127.0.0.1:<port>/lifecode-skill-center/api/health
curl -i http://127.0.0.1:<port>/lifecode-skill-center/api/capabilities
```

Expected:

- `health` → `200` with `{ "ok": true, "apiVersion": 1, ... }`.
- `capabilities` → `200` with `contractVersion: 2`, `plugin.version: "1.0.1"`, and the advertised contract
  surface (`projects`, `inventory`, `inspect-project`, `register-project`, `adopt-project`,
  `materialize-project`, `preflight`, `legacy-workspaces`, and `activity`). `GET /api/activity` appears in the
  announced `routes`; the addition is additive, so `contractVersion` stays at `2`.
- `401` from `capabilities` commonly means the request crossed the Host admission gate, or that the running
  backend predates the route. Restart after installing and retry.
- `404` on `/lifecode-skill-center/api/...` means the prefix is not served, or the running backend module
  predates the route; the response body names the API prefix.

The browser may be the only admitted peer for some surfaces; the panel itself is the reference client.
Use the panel for end-to-end verification and the HTTP checks for routing/admission diagnosis.

## 3. First run

1. Open the panel from the sidebar.
2. Pick a project in the header selector. The list comes from the Host's workspace registry.
3. Go to **Projects → Discovered**; inspect a workspace without writing to it.
4. Register a project only when you want the center to administer it. Registration creates an
   administrative record and a manifest in the center's store; it does not write inside the project.
5. Library and Analytics start empty until the first Skill exists. This is an empty state, not an error.

## 4. Activation states

The plugin can be installed but not enabled. The state is visible in the Plugins page and in the panel:

| State | Meaning | What to do |
|---|---|---|
| Installed, not enabled | The package is present; its layer is off. | Choose **Enable now** or switch it on. |
| Enabled, waiting for restart | The Host has not reloaded the server module. | Restart the Harness. |
| Enabled and mounted | Routes and panel are live. | Reload the page if the client is stale. |
| Incompatible contract | The backend and the client do not share a version. | Follow the compatibility banner; update both halves. |

## 5. GitHub installation (candidate)

**Not verified.** What is known:

- The Host plugin manager accepts a **package name**, a **Git address**, a **tarball**, or an **absolute
  local path**; the install spec is what follows `dsh plugin add` in a package README.
- This repository is a monorepo. The root is not the plugin package; the installable package lives in
  `lifecode-skill-center/` and is marked `"private": true`, so it is not published to npm.
- The naive Git address of the repository does not identify the subdirectory package.

Candidate commands (to be tested against a temporary profile before being documented as supported):

```sh
# Candidate A — subdirectory spec; the installable package is in the monorepo
dsh plugin add github:designerbyron/plugins-dsh#path:/lifecode-skill-center

# Candidate B — same spec pinned to a commit (SHA after #, then &path:)
dsh plugin add github:designerbyron/plugins-dsh#<sha>&path:/lifecode-skill-center

# Candidate C — pack the subdirectory and install the tarball
cd plugins-dsh/lifecode-skill-center
npm pack
dsh plugin add ./local-lifecode-skill-center-1.0.1.tgz
```

A plain repository URL (`https://github.com/designerbyron/plugins-dsh.git`) is not enough: it names the
repository root, which has no bundle. A `/tree/...` web URL is **not** a valid installer spec either — it is a
browser page, not a package address. The `#path:` selector identifies the package directory, and the commit
after `#` pins it for reproducibility; the plugin-market index documents the expanded pnpm form as
`git+https://github.com/designerbyron/plugins-dsh.git#<commit>&path:/<dir>`. None of the candidates has been
exercised; the pending test is recorded in the project's audit trail as **PENDIENTE — prueba con perfil
temporal**.

The plugin manager page describes how to install a third-party plugin, including Git addresses and local
directories. Where this document and the running Host disagree, the running Host wins.

## 6. Updating

1. Replace the plugin files with the new version (pull the repository, or install the new package).
2. Keep the store: it lives under `DSH_HOME/lifecode-skill-center/`, outside the plugin directory.
3. Restart the Harness so the new server module mounts.
4. Reload the page. The compatibility handshake reports whether the client and backend still agree.

Do not disable and re-enable the plugin as a substitute for a restart. The server module is not reloaded by
toggling the layer.

## 7. Uninstalling

Use the Host's plugin manager to remove or disable the bundle. The store is separate user data:

- The installable bundle contains code, docs, and assets only.
- The knowledge (Skills, versions, assignments, projects, events) remains under
  `DSH_HOME/lifecode-skill-center/` unless you delete it deliberately.
- Make a backup before deleting the store; `center.json` and `knowledge.json` are the two documents that
  matter, and `center.json.bak` / `.bak.sha256` are the last-good copies.

## 8. What installation does not do

- It does not approve, publish, assign, or enable any Skill.
- It does not modify projects or their `.dsh/skills` directories.
- It does not require an internet connection at runtime.
- It does not install OS-level notifications or a background service.
