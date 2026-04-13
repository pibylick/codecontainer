---
status: resolved
priority: p2
issue_id: "005"
tags: [code-review, ux]
dependencies: []
---

# Apple Container — ciche pomijanie secrets i restart

## Problem Statement

Plan mówi: "pominąć restart dla Apple Container" i "secrets bind mounts — na razie
tylko Docker/Podman". Ale nie przewiduje żadnego komunikatu dla użytkownika.

Użytkownik konfiguruje secrets w `.codecontainer.json`, uruchamia na Apple Container,
i sekrety po cichu nie są montowane. Kontener startuje bez dostępu do API keys,
agent pada z niezrozumiałym błędem.

Istniejący precedens: `src/docker.ts:290-292` — `runArgs` na Apple Container
generuje `printWarning("runArgs are not supported on Apple Container, skipping")`.

## Findings

- `src/docker.ts:282-292` — precedens: warning dla runArgs na Apple Container
- Plan sekcja 3 — "pominąć restart dla Apple Container" — bez warning
- Plan "Ryzyka" — wspomina problem ale nie proponuje rozwiązania UX

## Proposed Solutions

### Option A: printWarning() dla każdej pomijanej feature

Analogicznie do runArgs: dodać warning gdy secrets lub restart są skonfigurowane
ale runtime to Apple Container.

- **Pros:** Spójne z istniejącym wzorcem, minimalna zmiana
- **Cons:** Nie rozwiązuje problemu — użytkownik nadal nie ma secrets
- **Effort:** Small
- **Risk:** Low

## Recommended Action

*(do uzupełnienia po triage)*

## Technical Details

**Affected files:**
- `src/docker.ts` — `createNewContainer()`, sekcja Apple Container

## Acceptance Criteria

- [ ] Warning wyświetlany gdy secrets skonfigurowane a runtime to Apple Container
- [ ] Warning wyświetlany gdy restart skonfigurowane a runtime to Apple Container
- [ ] Komunikaty spójne ze stylem istniejących warnings (runArgs)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-04-07 | Utworzono todo z code review planu headless mode | Precedens: runArgs warning w docker.ts:290-292 |

## Resources

- Plan: `docs/plan-headless-mode.md` sekcja 3, "Ryzyka"
- Istniejący wzorzec: `src/docker.ts:290-292`
