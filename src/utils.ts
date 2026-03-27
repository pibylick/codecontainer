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

export function promptMultiSelect(
  title: string,
  items: Array<{ id: string; name: string }>,
  defaultSelected: boolean = true,
): Promise<string[]> {
  const selected = new Array(items.length).fill(defaultSelected);
  let cursor = 0;

  function render(): void {
    process.stdout.write(`\x1b[${items.length + 2}A`);
    printMenu();
  }

  function printMenu(): void {
    console.log(`\n${title} (↑↓ navigate, space toggle, a toggle all, enter confirm)`);
    items.forEach((item, i) => {
      const check = selected[i] ? "\x1b[32m✔\x1b[0m" : " ";
      const pointer = i === cursor ? "\x1b[36m❯\x1b[0m" : " ";
      console.log(`  ${pointer} [${check}] ${item.name}`);
    });
  }

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve(defaultSelected ? items.map(a => a.id) : []);
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
        resolve(items.filter((_, i) => selected[i]).map(a => a.id));
        return;
      }

      if (key === " ") {
        selected[cursor] = !selected[cursor];
        render();
        return;
      }

      if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
        return;
      }

      if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % items.length;
        render();
        return;
      }

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

export function promptAgentSelection(agents: Array<{ id: string; name: string }>): Promise<string[]> {
  return promptMultiSelect("Which agents would you like to use?", agents, true).then(
    result => result.length > 0 ? result : agents.map(a => a.id)
  );
}
