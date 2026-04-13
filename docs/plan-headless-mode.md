# Plan: Headless Mode for Codecontainer

## Cel

Dodać tryb headless do codecontainer — kontener startuje z podanym CMD zamiast
interactive shell, obsługuje secrets (read-only bind mounts), restart policy,
i idempotent entrypoint.

**Motywacja:** Autonomiczne agenty ML na hackathonie potrzebują kontenerów
które startują `runner.sh`, przeżywają restarty, i mają bezpiecznie zamontowane
klucze API.

## Zmiany

### 1. Dockerfile — entrypoint script (Option C: shared script)

Dodać `/usr/local/bin/fix-ssh.sh` — wspólny skrypt SSH kopiowany do image.
Entrypoint deleguje do niego, a `fixSshOwnership()` w `commands.ts` również
go wywołuje przez `docker exec`. Logika SSH w jednym miejscu, dwa punkty wywołania.

**`/usr/local/bin/fix-ssh.sh`:**

```bash
#!/bin/bash
# ABOUTME: Shared SSH key setup script used by entrypoint and commands.ts.
# ABOUTME: Copies host SSH keys to /root/.ssh-local with correct ownership/permissions.

# Determine source path: new containers mount to /root/.ssh-host,
# old containers (pre-entrypoint) may still have /root/.ssh directly.
SSH_SOURCE=""
[ -d /root/.ssh-host ] && SSH_SOURCE="/root/.ssh-host"
[ -z "$SSH_SOURCE" ] && [ -d /root/.ssh ] && SSH_SOURCE="/root/.ssh"
[ -z "$SSH_SOURCE" ] && exit 0

SSH_LOCAL="/root/.ssh-local"
rm -rf "$SSH_LOCAL"
cp -a "$SSH_SOURCE" "$SSH_LOCAL" 2>/dev/null
chown -R root:root "$SSH_LOCAL" 2>/dev/null
chmod 700 "$SSH_LOCAL"
chmod 600 "$SSH_LOCAL"/* 2>/dev/null

# Configure GIT_SSH_COMMAND in shell profiles — matches logic from
# commands.ts:fixSshOwnership() with multiple identity files and
# explicit known_hosts path.
SSH_CMD='export GIT_SSH_COMMAND="ssh -F /dev/null -o IdentityFile=/root/.ssh-local/id_ed25519 -o IdentityFile=/root/.ssh-local/id_rsa -o UserKnownHostsFile=/root/.ssh-local/known_hosts -o StrictHostKeyChecking=no"'
for profile in /root/.bashrc /root/.zshrc; do
  grep -q "ssh-local" "$profile" 2>/dev/null || echo "$SSH_CMD" >> "$profile"
done
```

**`/usr/local/bin/codecontainer-entrypoint.sh`:**

```bash
#!/bin/bash
# ABOUTME: Idempotent entrypoint uruchamiany przy każdym starcie kontenera.
# ABOUTME: Deleguje SSH setup do fix-ssh.sh, konfiguruje git safe.directory.
/usr/local/bin/fix-ssh.sh
git config --system safe.directory '*' 2>/dev/null
exec "$@"
```

W Dockerfile na końcu:
```dockerfile
COPY fix-ssh.sh /usr/local/bin/fix-ssh.sh
COPY codecontainer-entrypoint.sh /usr/local/bin/codecontainer-entrypoint.sh
RUN chmod +x /usr/local/bin/fix-ssh.sh /usr/local/bin/codecontainer-entrypoint.sh
ENTRYPOINT ["codecontainer-entrypoint.sh"]
CMD ["/bin/bash"]
```

**Uwaga:** Obecne kontenery interactive nie zmienią zachowania — `CMD ["/bin/bash"]`
pozostaje domyślny. ENTRYPOINT dodaje tylko setup SSH/git przed każdym CMD.

**Uwaga:** `fixSshOwnership()` w `src/commands.ts` (linia 197-214) zostanie
zrefaktoryzowany, aby wywoływać `fix-ssh.sh` przez `docker exec` zamiast
duplikować logikę SSH w TypeScript. Dzięki temu oba scenariusze (entrypoint
przy starcie kontenera i re-attach przez commands.ts) korzystają z tego samego
kodu.

**Kompatybilność wsteczna:** Stare kontenery (zbudowane przed dodaniem
entrypointa) nie mają `fix-ssh.sh` w image. Dla tych kontenerów
`fixSshOwnership()` w `commands.ts` powinien zachować fallback: jeśli
`docker exec <container> /usr/local/bin/fix-ssh.sh` zwróci błąd (skrypt nie
istnieje), wykonać dotychczasową logikę inline jako fallback. Po przebudowaniu
image (`codecontainer build`) stare kontenery zostaną zastąpione nowymi
z entrypointem i skryptem `fix-ssh.sh`. Fallback można usunąć w przyszłej
wersji po deprecation period.

### 2. src/project-config.ts — rozszerzenie schematu

Dodać 3 nowe pola do `ProjectConfigSchema`:

```typescript
secrets: z.array(z.object({
  name: z.string()
    .regex(/^[a-zA-Z0-9_-]+$/, "secret name: only alphanumeric, dash, underscore"),
  file: z.string()
    .refine(f => !f.includes('..'), "secret file: path traversal not allowed")
})).optional(),
cmd: z.string().optional(),
restart: z.enum(["no", "on-failure", "unless-stopped", "always"]).optional(),
```

W `hasSecuritySensitiveFields()` — dodać `secrets` i `cmd` jako sensitive
(wymagają potwierdzenia użytkownika). `restart` NIE jest sensitive.

**Walidacja secrets (runtime):** W `createNewContainer()` (docker.ts), przed
montowaniem secrets dodać runtime check:

```typescript
if (projectConfig?.secrets) {
  for (const secret of projectConfig.secrets) {
    if (!fs.existsSync(secret.file)) {
      printError(`Secret file not found: ${secret.file}`);
      process.exit(1);
    }
    if (!fs.statSync(secret.file).isFile()) {
      printError(`Secret path is not a file: ${secret.file}`);
      process.exit(1);
    }
  }
}
```

Walidacja Zod chroni przed path traversal w `name` i `..` w `file`.
Runtime check chroni przed nieistniejącymi plikami (Docker cicho tworzy
pusty katalog) i przed katalogami zamiast plików.
Wzorzec analogiczny do istniejącej walidacji `runArgs` (project-config.ts:59-68).

### 3. src/docker.ts — createNewContainer()

Rozszerzyć `createNewContainer()` o nowe opcje:

```typescript
interface ContainerCreateOptions {
  cmd?: string;
  restart?: string;
  secrets?: Array<{ name: string; file: string }>;
}
```

W budowaniu args do `docker run`:
- `--restart <policy>` jeśli podano (pominąć dla Apple Container)
- Secrets jako volume mounts: `-v ${secret.file}:/run/secrets/${secret.name}:ro`
- CMD override: zamiast domyślnego `sleep infinity`, użyj `bash -c <cmd>`

**Apple Container warnings:** Analogicznie do istniejącego wzorca dla `runArgs`
(docker.ts:290-292), dodać explicite warnings gdy features są pomijane:

```typescript
if (isAppleContainer()) {
  if (options.secrets && options.secrets.length > 0) {
    printWarning("secrets are not supported on Apple Container, skipping");
  }
  if (options.restart) {
    printWarning("restart policy is not supported on Apple Container, skipping");
  }
}
```

**Istniejące zachowanie (interactive):** Bez zmian. Gdy brak `cmd` → `sleep infinity`
jak dotychczas.

**Restart policy a `codecontainer stop`:** `stopContainer()` w `docker.ts` musi
wywołać `docker update --restart no` PRZED `docker stop`, aby Docker nie restartował
kontenera natychmiast po zatrzymaniu (Option C z TODO-004). Przy ponownym uruchomieniu
przez `codecontainer run`, `startContainer()` przywraca restart policy odczytaną
z `.codecontainer.json` wywołując `docker update --restart <policy>` po `docker start`.
`docker update` jest dostępny tylko na Docker/Podman — na Apple Container restart
policy nie jest obsługiwana, więc ten krok jest pomijany (non-issue).

### 4. src/commands.ts — headless branch w runContainer()

W `runContainer()` dodać branch:
- Jeśli `projectConfig.cmd` lub CLI `--cmd` → tryb headless
- Po post-setup (packages, git config): wyświetl info o kontenerze, NIE attachuj shella
- Istniejący kontener + headless: `docker start` + prompt o attach (patrz niżej)

**CMD override na istniejącym kontenerze:**

Docker nie pozwala zmienić CMD po `docker create`. Dwa scenariusze wymagają
osobnej obsługi:

1. **`--cmd` z CLI:** Gdy użytkownik podaje `--cmd` a kontener już istnieje →
   zawsze prompt o recreate (nie porównujemy z aktualnym CMD kontenera —
   prostsze i bezpieczniejsze). Użytkownik świadomie podaje `--cmd`, więc
   oczekuje że kontener uruchomi się z tym poleceniem.

2. **`cmd` w `.codecontainer.json`:** Zmiana `cmd` w pliku konfiguracyjnym
   zmienia hash pliku → `checkConfigDrift()` (linie 246-279) automatycznie
   wykrywa drift i oferuje recreate. Nie wymaga dodatkowej logiki.

```typescript
// Before config drift check, when container exists:
if (cliCmd && (containerRunning(containerName) || containerExists(containerName))) {
  printWarning(`--cmd passed but container already exists with a different CMD.`);
  printWarning(`Docker does not allow changing CMD on existing containers.`);
  const shouldRecreate = await confirmPrompt("Recreate container with new CMD?");
  if (shouldRecreate) {
    if (containerRunning(containerName)) stopContainer(containerName);
    removeContainer(containerName);
    // Fall through to create new container
  } else {
    printInfo("Keeping existing container. --cmd ignored.");
    // Continue with existing container
  }
}
```

```typescript
// After post-setup:
if (headless) {
  printSuccess(`Container running in headless mode: ${containerName}`);
  printInfo(`CMD: ${cmd}`);
  printInfo(`Logs: docker logs -f ${containerName}`);
  return;  // don't enter interactive shell
}
```

**Istniejący kontener headless** — gdy `codecontainer run` trafia na już działający
kontener z CMD (headless), oferuje interaktywny attach zamiast cichego early return:

```typescript
// Inside the "container already exists" branch (lines 246-278),
// after config drift check, when container is running and headless:
if (headless) {
  printInfo(`Container '${containerName}' is running in headless mode.`);
  printInfo(`CMD: ${cmd}`);
  printInfo(`Logs: docker logs -f ${containerName}`);

  const attach = await promptYesNo(
    "Attach interactive shell? [y/N]",
    false
  );
  if (attach) {
    execInteractive(containerName, projectName);
    // Don't stop container after detach — headless keeps running
  }
  return;
}
```

Kluczowe zachowania:
- Prompt domyślnie `N` — samo wejście nie attachuje, trzeba świadomie wybrać `y`
- Po wyjściu z interactive shell kontener NIE jest zatrzymywany (w przeciwieństwie
  do interactive mode, który woła `stopContainerIfLastSession`). Headless kontener
  kontynuuje pracę CMD w tle.
- Jeśli kontener jest zatrzymany (istnieje ale nie działa), `docker start` go wznawia
  i wyświetla ten sam prompt

### 5. src/main.ts — nowe CLI flagi

```
--headless              Uruchom kontener w tle (bez interactive shell)
--cmd "bash runner.sh"  Override CMD (implikuje --headless)
--restart <policy>      Docker restart policy (no|on-failure|unless-stopped|always)
```

Dodać do `usage()` i do parsera argumentów. CLI flags mają priorytet nad
`.codecontainer.json`.

### 6. Testy — src/__tests__/project-config.test.ts

Dodać testy:
- Parsowanie `secrets`, `cmd`, `restart` z JSON
- `hasSecuritySensitiveFields()` → true dla secrets i cmd
- Walidacja restart enum (odrzuca nieprawidłowe wartości)
- Shell injection w cmd (rejectuje operatory shell?)
  → **Decyzja:** cmd to celowy shell command, nie rejectujemy operatorów.
  Wystarczy security prompt.

## Kolejność implementacji

1. Dockerfile + entrypoint script + fix-ssh.sh (niezależne)
2. project-config.ts (schema + security check)
3. Testy schema
4. docker.ts (createNewContainer options)
5. commands.ts (headless branch + refaktor fixSshOwnership → docker exec fix-ssh.sh)
6. main.ts (CLI flags + usage)
7. Test E2E: `codecontainer run --cmd "echo hello" --restart no`

## Przykład .codecontainer.json (headless agent)

```json
{
  "name": "agent-cc",
  "cmd": "bash /root/aissecobs-cc/.agent/runner.sh",
  "restart": "unless-stopped",
  "containerEnv": { "RUNNER": "claude" },
  "packages": ["jq", "bc", "openssh-client"],
  "secrets": [
    { "name": "anthropic_key", "file": "/home/wokoziej/dev/hackology_2026/secrets/anthropic.key" },
    { "name": "runpod_key", "file": "/home/wokoziej/dev/hackology_2026/secrets/runpod_cc.key" },
    { "name": "github_token", "file": "/home/wokoziej/dev/hackology_2026/secrets/github_cc.token" }
  ]
}
```

## Ryzyka

- ENTRYPOINT zmienia zachowanie istniejących kontenerów → mitigacja: `exec "$@"`
  przekazuje sterowanie do CMD, więc interactive bash działa bez zmian
- Secrets na Apple Container: bind mounts działają inaczej → na razie tylko Docker/Podman
- cmd z shell operatorami → security prompt wystarcza (user świadomie konfiguruje)

## Resolved concerns

- **SSH logic duplication (TODO-001):** Plan pierwotnie wprowadzał entrypoint
  z logiką SSH niezależną od `fixSshOwnership()` w `commands.ts`, co prowadziło
  do duplikacji i niespójności (różne ścieżki źródłowe, różne flagi SSH, różne
  profile). Przyjęto Option C -- wspólny skrypt `/usr/local/bin/fix-ssh.sh`
  baked into the image. Skrypt obsługuje obie konwencje montowania SSH
  (`/root/.ssh-host` dla nowych kontenerów, `/root/.ssh` dla starych).
  Entrypoint wywołuje go przy starcie kontenera, a `fixSshOwnership()` wywołuje
  go przez `docker exec`. GIT_SSH_COMMAND w skrypcie jest zsynchronizowany
  z aktualną logiką w `commands.ts` (multiple identity files, explicit
  known_hosts, `-F /dev/null`, grep na `ssh-local`, profile `.bashrc`
  i `.zshrc`). Stare kontenery bez skryptu obsługiwane przez fallback inline
  w `fixSshOwnership()`. Szczegóły: `todos/001-pending-p1-ssh-logic-duplication.md`

- **restart policy + `codecontainer stop`** (TODO-004): `stopContainer()` resetuje
  restart policy do `no` przed zatrzymaniem kontenera (`docker update --restart no`),
  a `codecontainer run` przywraca oryginalną policy z `.codecontainer.json`.
  Dotyczy tylko Docker/Podman — Apple Container nie obsługuje restart policy.

- **CMD override na istniejącym kontenerze (TODO-006):** Docker nie pozwala
  zmienić CMD po `docker create`. Rozwiązanie: `--cmd` z CLI zawsze promptuje
  o recreate (Option B — proste i bezpieczne). Zmiana `cmd` w
  `.codecontainer.json` jest pokryta przez istniejący mechanizm config drift
  hash w `checkConfigDrift()`. Szczegóły w sekcji 4.

- **Walidacja secrets (TODO-002):** Zod schema waliduje `name` regexem
  `[a-zA-Z0-9_-]+` (blokuje path traversal) i `file` refine'm (blokuje `..`).
  Runtime check w `createNewContainer()` weryfikuje `fs.existsSync()` i `isFile()`
  przed montowaniem — zapobiega cichemu tworzeniu pustych katalogów przez Docker.

- **Apple Container silent skip (TODO-005):** Secrets i restart policy są pomijane
  na Apple Container. Dodano explicite `printWarning()` w sekcji 3 (`docker.ts —
  createNewContainer`) analogicznie do istniejącego wzorca dla `runArgs` w
  `docker.ts:290-292`. Użytkownik zobaczy komunikat zamiast cichego pominięcia.

- **Brak przepływu debug/attach dla headless kontenerów (TODO-003):** Plan
  headless mode robił early return bez `execInteractive()`, co uniemożliwiało
  interaktywne debugowanie headless kontenera przez CLI codecontainer.
  Rozwiązanie: Option A — `codecontainer run` na istniejącym headless kontenerze
  wyświetla status i oferuje prompt "Attach interactive shell? [y/N]". Nie wymaga
  nowej komendy CLI, naturalny flow. Po wyjściu z shella kontener kontynuuje
  pracę CMD w tle (bez `stopContainerIfLastSession`). Szczegóły w sekcji 4
  ("Istniejący kontener headless").
