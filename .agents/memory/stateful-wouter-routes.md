---
name: Stateful Wouter routes
description: Preserve stateful UI and background capture across parent updates and route navigation.
---

Render stateful route content through stable component references. If a route owns a user-authorized capture or monitoring runtime that must continue elsewhere, mount it above route switching and hide only its visible surface.

**Why:** The live assistant first lost carousel position because parent updates recreated its route component identity, then stopped screen monitoring when navigation unmounted the route.

**How to apply:** For long-lived interactive routes, use stable children/components; keep required background runtimes outside conditional route branches; test both parent updates and cross-page navigation.