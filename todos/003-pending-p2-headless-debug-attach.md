---
status: resolved
priority: p2
issue_id: "003"
tags: [code-review, architecture, ux]
dependencies: []
---

# Brak przepływu debug/attach dla headless kontenerów

## Problem Statement

Plan headless mode (sekcja 4) po starcie kontenera robi `return` bez `execInteractive()`.
Użytkownik nie ma sposobu żeby interaktywnie debugować headless kontener przez CLI
codecontainer. Jedyna wskazówka to `printInfo("Logs: docker logs -f ...")`.

Scenariusz: agent runner padł, użytkownik chce wejść do kontenera i sprawdzić stan.
Musi ręcznie wpisać `docker exec -it <name> bash` — codecontainer nie oferuje tej ścieżki.

## Findings

- `src/commands.ts:217-324` — `runContainer()` — headless branch będzie robić early return
- Brak komendy `attach` lub `exec` w CLI (`src/main.ts:121-132` — validCommands)
- `codecontainer run` na istniejącym headless kontenerze — plan mówi "docker start + info"
  ale nie mówi czy oferować interactive attach

## Proposed Solutions

### Option A: `codecontainer run` na headless kontenerze oferuje attach

Jeśli kontener istnieje i ma CMD (headless), `runContainer()` pyta:
"Container running in headless mode. Attach interactive shell? [y/N]"

- **Pros:** Nie wymaga nowej komendy, naturalny flow
- **Cons:** Zmienia zachowanie `run` — użytkownik może chcieć tylko sprawdzić status
- **Effort:** Small
- **Risk:** Low

### Option B: Nowa komenda `codecontainer exec`

Dodać `exec` do validCommands — otwiera interaktywny shell w istniejącym kontenerze
(zarówno headless jak i interactive).

- **Pros:** Czyste rozdzielenie odpowiedzialności, nie zmienia istniejących flows
- **Cons:** Kolejna komenda do utrzymania
- **Effort:** Small
- **Risk:** Low

## Recommended Action

*(do uzupełnienia po triage)*

## Technical Details

**Affected files:**
- `src/commands.ts` — nowy flow lub nowa funkcja
- `src/main.ts` — nowa komenda w `validCommands` (jeśli Option B)

## Acceptance Criteria

- [ ] Użytkownik może interaktywnie wejść do headless kontenera przez codecontainer CLI
- [ ] Dokumentacja (usage/help) opisuje jak debugować headless kontener
- [ ] Istniejące interactive flow nie jest zmienione

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-04-07 | Utworzono todo z code review planu headless mode | |

## Resources

- Plan: `docs/plan-headless-mode.md` sekcja 4
