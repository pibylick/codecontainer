import * as path from "path";
import * as readline from "readline";

export function printInfo(message: string): void {
  console.log(`\x1b[34m[INFO]\x1b[0m ${message}`);
}

export function printSuccess(message: string): void {
  console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`);
}

export function printWarning(message: string): void {
  console.log(`\x1b[33m[WARNING]\x1b[0m ${message}`);
}

export function printError(message: string): void {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${message}`);
}

export function resolveProjectPath(projectPath: string | undefined): string {
  if (!projectPath) {
    return process.cwd();
  }

  return path.resolve(projectPath);
}

export function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${question} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export function promptSelect<T extends string>(title: string, options: Array<{ label: string; value: T }>, defaultIndex: number = 0): Promise<T> {
  let cursor = defaultIndex;

  function render(): void {
    process.stdout.write(`\x1b[${options.length + 2}A`);
    printMenu();
  }

  function printMenu(): void {
    console.log(`\n${title} (↑↓ navigate, enter confirm)`);
    options.forEach((opt, i) => {
      const pointer = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
      console.log(`  ${pointer} ${opt.label}`);
    });
  }

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(options[defaultIndex].value);
      return;
    }

    printMenu();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onKey = (key: string): void => {
      if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onKey);
        process.exit(0);
      }

      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onKey);
        resolve(options[cursor].value);
        return;
      }

      if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }
    };

    process.stdin.on("data", onKey);
  });
}

export function promptAgentSelection(agents: Array<{ id: string; name: string }>): Promise<string[]> {
  const selected = new Array(agents.length).fill(true);
  let cursor = 0;

  function render(): void {
    // Move cursor up to overwrite previous render (except first render)
    process.stdout.write(`\x1b[${agents.length + 2}A`);
    printMenu();
  }

  function printMenu(): void {
    console.log("\nWhich agents would you like to use? (↑↓ navigate, space toggle, enter confirm)");
    agents.forEach((agent, i) => {
      const check = selected[i] ? "\x1b[32m✔\x1b[0m" : " ";
      const pointer = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
      console.log(`  ${pointer} [${check}] ${agent.name}`);
    });
  }

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Fallback for non-interactive: select all
      resolve(agents.map(a => a.id));
      return;
    }

    printMenu();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onKey = (key: string): void => {
      // Ctrl+C
      if (key === "\x03") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onKey);
        process.exit(0);
      }

      // Enter
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onKey);
        const result = agents
          .filter((_, i) => selected[i])
          .map(a => a.id);
        resolve(result.length > 0 ? result : agents.map(a => a.id));
        return;
      }

      // Space — toggle
      if (key === " ") {
        selected[cursor] = !selected[cursor];
        render();
        return;
      }

      // Arrow up / k
      if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + agents.length) % agents.length;
        render();
        return;
      }

      // Arrow down / j
      if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % agents.length;
        render();
        return;
      }

      // 'a' — toggle all
      if (key === "a") {
        const allSelected = selected.every(Boolean);
        selected.fill(!allSelected);
        render();
        return;
      }
    };

    process.stdin.on("data", onKey);
  });
}
