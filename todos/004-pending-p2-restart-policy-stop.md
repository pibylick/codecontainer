---
status: resolved
priority: p2
issue_id: "004"
tags: [code-review, architecture]
dependencies: []
---

# restart policy + codecontainer stop — kontener się restartuje

## Problem Statement

Headless kontener z `restart: unless-stopped` po wywołaniu `codecontainer stop`
zostanie zatrzymany przez `docker stop`, ale Docker natychmiast go zrestartuje
(zgodnie z polityką restart). Użytkownik myśli że kontener jest zatrzymany,
a on wciąż działa.

`stopContainer()` w `docker.ts:176-184` wywołuje tylko `docker stop` —
nie resetuje restart policy.

## Findings

- `src/docker.ts:176-184` — `stopContainer()` — tylko `docker stop --timeout 3`
- `src/commands.ts:388-403` — `stopContainerForProject()` — wywołuje `stopContainer()`
- Docker behavior: `docker stop` + `restart: unless-stopped` → kontener się restartuje
- Docker fix: `docker update --restart no <name>` przed `docker stop`

## Proposed Solutions

### Option A: Reset restart policy w stopContainer()

Przed `docker stop`, wywołać `docker update --restart no`. Przy ponownym starcie
przez `codecontainer run`, przywrócić oryginalną policy.

- **Pros:** Poprawne zachowanie, użytkownik dostaje to czego oczekuje
- **Cons:** Wymaga śledzenia oryginalnej policy (label?) żeby przywrócić
- **Effort:** Medium
- **Risk:** Low

### Option B: Dokumentacja + ostrzeżenie

Dodać `printWarning()` w `stopContainerForProject()` jeśli kontener ma restart policy.
Użytkownik musi sam zdecydować: `stop` vs `remove`.

- **Pros:** Minimalna zmiana, użytkownik świadomy
- **Cons:** Słabe UX, użytkownik musi sam rozwiązać problem
- **Effort:** Small
- **Risk:** Low

### Option C: `codecontainer stop` zawsze resetuje restart policy

Traktować `stop` jako "zatrzymaj i nie restartuj". `codecontainer run` przywraca
policy z `.codecontainer.json`.

- **Pros:** Intuicyjne zachowanie, spójne z oczekiwaniami użytkownika
- **Cons:** `docker update` nie działa na Apple Container / Podman (sprawdzić)
- **Effort:** Small
- **Risk:** Medium (kompatybilność runtime)

## Recommended Action

*(do uzupełnienia po triage)*

## Technical Details

**Affected files:**
- `src/docker.ts` — `stopContainer()`
- `src/commands.ts` — `stopContainerForProject()`

## Acceptance Criteria

- [ ] `codecontainer stop` na kontenerze z restart policy skutecznie zatrzymuje kontener
- [ ] Kontener nie restartuje się automatycznie po `codecontainer stop`
- [ ] `codecontainer run` po `stop` przywraca oryginalną restart policy
- [ ] Zachowanie działa na Docker i Podman

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-04-07 | Utworzono todo z code review planu headless mode | docker update --restart działa na Docker, sprawdzić Podman |

## Resources

- Plan: `docs/plan-headless-mode.md` sekcja 3 (restart policy)
- Docker docs: `docker update --restart`
