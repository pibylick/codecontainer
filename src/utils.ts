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

export function promptAgentSelection(agents: Array<{ id: string; name: string }>): Promise<string[]> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("");
  console.log("Which agents would you like to use?");
  agents.forEach((agent, i) => {
    console.log(`  [${i + 1}] ${agent.name}`);
  });
  console.log(`  [a] All agents (default)`);
  console.log("");

  return new Promise((resolve) => {
    rl.question("Enter numbers separated by commas (e.g., 1,3) or 'a' for all: ", (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();

      if (!trimmed || trimmed === "a") {
        resolve(agents.map(a => a.id));
        return;
      }

      const indices = trimmed.split(",")
        .map(s => parseInt(s.trim(), 10))
        .filter(n => !isNaN(n) && n >= 1 && n <= agents.length);

      if (indices.length === 0) {
        resolve(agents.map(a => a.id));
        return;
      }

      const selected = [...new Set(indices.map(i => agents[i - 1].id))];
      resolve(selected);
    });
  });
}
