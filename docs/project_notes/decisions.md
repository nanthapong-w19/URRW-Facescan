# Architectural Decisions

Architectural Decision Records (ADRs) for face-checkin-app.

## Format

```
### ADR-XXX: Decision Title (YYYY-MM-DD)

**Context:**
- Why the decision was needed

**Decision:**
- What was chosen

**Alternatives Considered:**
- Option -> Why rejected

**Consequences:**
- Benefits
- Trade-offs
```

Number sequentially. Keep all decisions (lightweight, historical value). Update entry + add revision date if a decision changes.

## Entries

### ADR-001: Use Tailwind logical-property utilities for new UI code (2026-07-23)

**Context:**
- App had physical-direction utilities (`left-`, `pl-`, `mr-`, `-ml-`, `-right-`) scattered across pages for icon/search-bar positioning and back-button offsets
- Tailwind 3.4.1 (already in use) ships logical equivalents (`start-`, `end-`, `ps-`, `pe-`, `ms-`, `me-`) at no extra cost

**Decision:**
- Use logical properties (`start-`/`end-`/`ps-`/`pe-`/`ms-`/`me-`) instead of physical (`left-`/`right-`/`pl-`/`pr-`/`ml-`/`mr-`) in app-authored code going forward
- Scope: `src/pages/`, `src/components/*.tsx` — NOT `src/components/ui/*` (vendor shadcn primitives, left as-is; regenerable from shadcn CLI)

**Alternatives Considered:**
- Leave as physical properties -> Rejected: no cost to switching now, and it's the correct default even though the app isn't currently localized to an RTL language
- Refactor `components/ui/*` too -> Rejected: vendor code, mass-editing 40+ generated files for no functional gain isn't worth the diff/regeneration risk

**Consequences:**
- Benefits: correct-by-default if RTL locale is ever added; no behavior change in current LTR-only usage
- Trade-offs: none identified; purely a naming/property swap
