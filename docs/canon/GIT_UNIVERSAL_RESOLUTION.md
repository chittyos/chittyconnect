# git.chitty.cc — Universal Package Resolution Standard (ChittyCanon)

Purpose
- Provide a memorable, canonical resolver for any ChittyOS service/package.
- Unify documentation, metadata, and install flows under a consistent URL space.

Canonical routes
- git.chitty.cc/{name} → Human-friendly landing/redirect to canonical repo/docs
- git.chitty.cc/{name}.json → Machine-readable package metadata
- git.chitty.cc/{name}/install → One-line install script (curl | sh)
- git.chitty.cc/{name}/config → Default config template(s)
- git.chitty.cc/{name}@{version} → Version-specific reference/metadata

Examples
- git.chitty.cc/sync → github.com/chittyos/chittysync
- git.chitty.cc/sync.json → JSON metadata for ChittySync
- git.chitty.cc/sync/install → Install script

JSON metadata (minimal shape)
```
{
  "name": "sync",
  "title": "ChittySync",
  "version": "3.0.3",
  "repo": "https://github.com/chittyos/chittysync",
  "docs": "https://sync.chitty.cc/docs",
  "npm": {
    "packages": ["@chitty/sync"],
    "install": "npm i @chitty/sync"
  },
  "bin": ["chittysync"],
  "install": {
    "script": "https://git.chitty.cc/sync/install"
  }
}
```

Governance
- Ownership: service owners maintain `{name}` records.
- Source of truth: Ecosystem Authority/Registry (write via ChittyRegister; this resolver reads it).
- Validation: JSON schema + CI checks before publish.

Roadmap (impl sketch)
- Worker `chittygit` at git.chitty.cc
  - GET /{name} → 302 to canonical repo/docs
  - GET /{name}.json → metadata (from Registry)
  - GET /{name}/install → dynamic script (template + metadata)
  - GET /{name}/config → renders config templates
- Backing store: Authority/Registry (read-only from this worker)

References
- docs/onboarding/SERVICE_TEMPLATE.md
- docs/architecture/ARCHITECTURE_MAGNET_BOARD.md

