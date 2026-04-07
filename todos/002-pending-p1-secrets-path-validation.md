---
status: resolved
priority: p1
issue_id: "002"
tags: [code-review, security]
dependencies: []
---

# Brak walidacji ścieżek plików secrets

## Problem Statement

Plan definiuje secrets jako:
```typescript
secrets: z.array(z.object({ name: z.string(), file: z.string() })).optional()
```

Montowane jako: `-v ${secret.file}:/run/secrets/${secret.name}:ro`

Brak walidacji obu pól:
- `secret.name` może zawierać `../` → path traversal w kontenerze
- `secret.file` może wskazywać na dowolny plik hosta (`/etc/shadow`, `/root/.ssh/id_rsa`)
- `secret.file` może nie istnieć → Docker utworzy pusty katalog zamiast pliku (ciche błędy)

Security gate (`confirmProjectConfig`) wymaga potwierdzenia użytkownika, ale to
nie chroni przed `.codecontainer.json` pobranym z niezaufanego repo.

## Findings

- `src/project-config.ts:48-51` — Zod schema bez walidacji formatu
- `src/project-config.ts:88-94` — `SECURITY_SENSITIVE_FIELDS` lista — secrets będzie dodane
- Analogia: `runArgs` (linia 59-68) już waliduje shell operators — precedens dla walidacji
- Docker zachowanie: `-v /nonexistent:/run/secrets/x:ro` tworzy pusty katalog, nie błąd

## Proposed Solutions

### Option A: Walidacja w Zod schema (inline)

Dodać refinements do Zod:
```typescript
secrets: z.array(z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, "name: only alphanumeric, dash, underscore"),
  file: z.string().refine(f => !f.includes('..'), "file: path traversal not allowed")
})).optional()
```

Plus runtime check w `createNewContainer()`: `fs.existsSync(secret.file)` + `fs.statSync().isFile()`.

- **Pros:** Walidacja blisko definicji, czytelne komunikaty błędów
- **Cons:** Zod refinement na `file` nie wystarczy — trzeba też runtime check
- **Effort:** Small
- **Risk:** Low

### Option B: Osobna funkcja walidująca secrets

Dodać `validateSecrets()` w `project-config.ts` wywoływaną po parse:

```typescript
function validateSecrets(secrets: Array<{name: string, file: string}>): string[] {
  const errors: string[] = [];
  for (const s of secrets) {
    if (!/^[a-zA-Z0-9_-]+$/.test(s.name)) errors.push(`Invalid secret name: ${s.name}`);
    if (!fs.existsSync(s.file)) errors.push(`Secret file not found: ${s.file}`);
    if (fs.existsSync(s.file) && !fs.statSync(s.file).isFile()) errors.push(`Not a file: ${s.file}`);
  }
  return errors;
}
```

- **Pros:** Wyraźna separacja walidacji, lepsze komunikaty, łatwe do testowania
- **Cons:** Dwa miejsca walidacji (Zod + runtime)
- **Effort:** Small
- **Risk:** Low

## Recommended Action

*(do uzupełnienia po triage)*

## Technical Details

**Affected files:**
- `src/project-config.ts` — schema + walidacja
- `src/docker.ts` — `createNewContainer()` gdzie secrets są montowane

**Components:** project config, container creation

## Acceptance Criteria

- [ ] `secret.name` akceptuje tylko `[a-zA-Z0-9_-]`
- [ ] `secret.name` z `../` jest odrzucany z czytelnym błędem
- [ ] `secret.file` które nie istnieje powoduje błąd (nie ciche tworzenie katalogu)
- [ ] `secret.file` wskazujący na katalog jest odrzucany
- [ ] Testy pokrywają walidację (prawidłowe i nieprawidłowe dane)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-04-07 | Utworzono todo z code review planu headless mode | Analogia do walidacji runArgs w liniach 59-68 — ten sam wzorzec |

## Resources

- Plan: `docs/plan-headless-mode.md` sekcja 2
- Istniejąca walidacja: `src/project-config.ts:59-68` (runArgs shell operator check)
- Docker docs: bind mount behavior when source doesn't exist
