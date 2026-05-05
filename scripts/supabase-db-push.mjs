import { spawn } from "node:child_process";

const MAX_ATTEMPTS = Number.parseInt(process.env.SUPABASE_DB_PUSH_ATTEMPTS ?? "5", 10);
const BACKOFF_MS = Number.parseInt(process.env.SUPABASE_DB_PUSH_BACKOFF_MS ?? "1500", 10);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runOnce() {
  return new Promise((resolve) => {
    // Usamos npx para asegurar que corre el CLI del proyecto en Windows.
    const args = [
      "supabase",
      "db",
      "push",
      "--dns-resolver",
      "https",
      ...(process.argv.includes("--debug") ? ["--debug"] : []),
    ];

    const child = spawn("npx", args, {
      stdio: "inherit",
      shell: true,
    });

    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const exitCode = await runOnce();
    if (exitCode === 0) process.exit(0);

    // El pooler de Supabase puede cerrar conexiones de forma intermitente en algunas redes.
    if (attempt < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS * attempt;
      console.log(
        `\nReintentando supabase db push (${attempt}/${MAX_ATTEMPTS}) en ${wait} ms...\n`,
      );
      await sleep(wait);
      continue;
    }

    process.exit(exitCode);
  }
}

main().catch(() => process.exit(1));

