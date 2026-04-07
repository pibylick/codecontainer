---
status: resolved
priority: p2
issue_id: "006"
tags: [code-review, architecture]
dependencies: []
---

# --cmd na istniejącym kontenerze nie zmieni CMD

## Problem Statement

Plan sekcja 4: "Istniejący kontener + headless: `docker start` + info, bez interactive".

Problem: istniejący kontener został stworzony z `sleep infinity` (interactive)
lub innym CMD. `docker start` uruchamia kontener z oryginalnym CMD — nie z nowym
`--cmd` z CLI. Docker nie pozwala zmienić CMD na istniejącym kontenerze.

Scenariusz:
1. `codecontainer run /project` → tworzy kontener z `sleep infinity`
2. Użytkownik dodaje `"cmd": "bash runner.sh"` do `.codecontainer.json`
3. `codecontainer run /project` → kontener istnieje, `docker start` → uruchamia `sleep infinity`
4. Użytkownik nie rozumie dlaczego runner nie startuje

## Findings

- `src/docker.ts:301` — `args.push("sleep", "infinity")` — CMD ustawiony przy create
- `src/commands.ts:246-279` — config drift detection istnieje, ale sprawdza hash `.codecontainer.json`
- Zmiana `cmd` w `.codecontainer.json` zmieni hash → `checkConfigDrift()` wykryje drift
- **Ale:** `--cmd` z CLI nie jest częścią `.codecontainer.json` → drift nie wykryty

## Proposed Solutions

### Option A: Config drift obejmuje CLI overrides

Przy `--cmd` z CLI, porównać z CMD kontenera. Jeśli się różni → oferować recreate.
Wymaga odczytania CMD z istniejącego kontenera (`docker inspect`).

- **Pros:** Kompletne rozwiązanie dla obu scenariuszy (config + CLI)
- **Cons:** Wymaga `docker inspect` + parsing CMD — dodatkowa złożoność
- **Effort:** Medium
- **Risk:** Low

### Option B: --cmd z CLI zawsze wymusza recreate

Jeśli podano `--cmd` a kontener istnieje → zawsze pytaj o recreate.
Prostsze niż porównywanie CMD.

- **Pros:** Proste, bezpieczne, przewidywalne
- **Cons:** Niepotrzebny recreate jeśli CMD się nie zmienił
- **Effort:** Small
- **Risk:** Low

## Recommended Action

*(do uzupełnienia po triage)*

## Technical Details

**Affected files:**
- `src/commands.ts` — `runContainer()`, `checkConfigDrift()`
- `src/docker.ts` — ewentualnie nowa funkcja do odczytu CMD kontenera

## Acceptance Criteria

- [ ] Zmiana `cmd` w `.codecontainer.json` → config drift wykryty, oferuje recreate
- [ ] `--cmd` z CLI na istniejącym kontenerze → oferuje recreate lub informuje
- [ ] Użytkownik nigdy nie dostaje kontenera z nieoczekiwanym CMD

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-04-07 | Utworzono todo z code review planu headless mode | Config drift z hasha .codecontainer.json pokrywa scenariusz config, ale nie CLI override |

## Resources

- Plan: `docs/plan-headless-mode.md` sekcja 4
- Config drift: `src/commands.ts:351-386`
