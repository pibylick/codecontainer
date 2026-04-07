---
status: resolved
priority: p1
issue_id: "001"
tags: [code-review, architecture, security]
dependencies: []
---

# Duplikacja logiki SSH: entrypoint vs fixSshOwnership()

## Problem Statement

Plan headless mode wprowadza `codecontainer-entrypoint.sh` który kopiuje SSH klucze
z `/root/.ssh-host` do `/root/.ssh-local`. Jednocześnie `commands.ts:fixSshOwnership()`
(linia 197-214) robi dokładnie to samo, ale z inną logiką ścieżek:

- Entrypoint sprawdza tylko `/root/.ssh-host`
- `fixSshOwnership()` sprawdza `SSH_STAGING_PATH` a potem `/root/.ssh`
- Obie funkcje piszą do `/root/.ssh-local`

Po docker restart entrypoint użyje swoich ścieżek, a po re-attach `fixSshOwnership()`
nadpisze wynik entrypointa swoimi ścieżkami. Niespójność może prowadzić do
niedostępnych kluczy SSH.

## Findings

- `commands.ts:197-214` — `fixSshOwnership()` kopiuje z `SSH_STAGING_PATH` lub `/root/.ssh`
- Plan sekcja 1 — entrypoint kopiuje z `/root/.ssh-host`
- `SSH_STAGING_PATH` importowany z `mounts.ts` — trzeba zweryfikować czy to `/root/.ssh-host`
- Obie ścieżki piszą do `/root/.ssh-local` z `chown root:root` + `chmod 600`

## Proposed Solutions

### Option A: Entrypoint jako jedyne źródło prawdy

Usunąć `fixSshOwnership()` z `commands.ts`. Entrypoint obsługuje zarówno pierwszy
start jak i restarty. Przy re-attach nie trzeba ponownie kopiować SSH.

- **Pros:** Jedna ścieżka kodu, prostsze utrzymanie
- **Cons:** Entrypoint musi obsłużyć obie konwencje montowania (stare + nowe kontenery)
- **Effort:** Medium
- **Risk:** Stare kontenery bez entrypointa stracą SSH fix przy upgrade

### Option B: fixSshOwnership() jako jedyne źródło prawdy

Entrypoint robi tylko `exec "$@"` bez logiki SSH. `fixSshOwnership()` wywoływany
zarówno przy create jak i przy `docker start` (via `docker exec` przed CMD).

- **Pros:** Logika SSH w jednym miejscu w TypeScript, łatwiejsze testowanie
- **Cons:** Wymaga `docker exec` po każdym `docker start` — nie działa przy `docker restart`
- **Effort:** Small
- **Risk:** Nie rozwiązuje problemu dla headless restart (brak procesu host-side)

### Option C: Entrypoint deleguje do wspólnego skryptu

Stworzyć `/usr/local/bin/fix-ssh.sh` kopiowany do image. Entrypoint go wywołuje,
a `fixSshOwnership()` w commands.ts wywołuje go przez `docker exec`. Jeden skrypt,
dwa punkty wywołania.

- **Pros:** Logika w jednym miejscu, działa dla obu scenariuszy
- **Cons:** Wymaga synchronizacji skryptu między Dockerfile a commands.ts
- **Effort:** Medium
- **Risk:** Low

## Recommended Action

**Option C: Entrypoint deleguje do wspólnego skryptu `/usr/local/bin/fix-ssh.sh`.**

Skrypt `fix-ssh.sh` zawiera pełną logikę SSH: sprawdza `/root/.ssh-host` (nowa
konwencja), fallback do `/root/.ssh` (stare kontenery), kopiuje do `/root/.ssh-local`,
ustawia ownership/permissions, konfiguruje `GIT_SSH_COMMAND` w shell profiles.

Entrypoint wywołuje `fix-ssh.sh` przy starcie kontenera (obsługuje headless restart).
`fixSshOwnership()` w `commands.ts` zostanie zrefaktoryzowany do wywołania
`docker exec <container> /usr/local/bin/fix-ssh.sh` (obsługuje re-attach).

Plan zaktualizowany w `docs/plan-headless-mode.md` sekcja 1.

## Technical Details

**Affected files:**
- `src/commands.ts` — `fixSshOwnership()` (linia 197-214)
- `Dockerfile` — nowy entrypoint script
- `src/mounts.ts` — `SSH_STAGING_PATH` export

**Components:** container lifecycle, SSH key management

## Acceptance Criteria

- [ ] SSH klucze działają po `docker run` (pierwszy start)
- [ ] SSH klucze działają po `docker restart` (headless restart)
- [ ] SSH klucze działają po re-attach (`codecontainer run` na istniejący kontener)
- [ ] Logika SSH jest w jednym miejscu (brak duplikacji)
- [ ] Stare kontenery (bez entrypointa) nadal działają

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-04-07 | Utworzono todo z code review planu headless mode | Dwie ścieżki SSH z różnymi źródłami — trzeba ujednolicić przed implementacją |
| 2026-04-07 | Resolved: wybrano Option C, zaktualizowano plan headless mode sekcja 1 | Wspólny skrypt fix-ssh.sh eliminuje duplikację — entrypoint i commands.ts oba go wywołują |

## Resources

- Plan: `docs/plan-headless-mode.md` sekcja 1
- Istniejący kod: `src/commands.ts:197-214`
- Kontekst: commit `19e3822` (fix: handle .ssh bind mount on existing containers)
