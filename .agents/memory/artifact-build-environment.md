---
name: Artifact build environment
description: The environment values required when validating an artifact build outside its managed workflow.
---

Standalone Vite build commands for registered artifacts require both `PORT` and `BASE_PATH`; managed artifact workflows inject them automatically.

**Why:** The frontend Vite config intentionally fails fast when either value is absent, so a plain package build can fail before compilation even when the source is valid.

**How to apply:** For a root-preview artifact, use the assigned validation port and `BASE_PATH=/` for a direct build; do not change the Vite config just to make local validation pass.