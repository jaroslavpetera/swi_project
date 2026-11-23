// C10 — minimální provozní log: jeden JSON řádek na událost (čas, úroveň, komponenta, událost).
// Loguje se jen to, co je potřeba k diagnostice: start/zastavení procesu a technické chyby (500).
// Běžný úspěch ani doménové zamítnutí (409/410) se nelogují — výsledek nese odpověď a stav v DB.
// Nikdy nelogovat tělo požadavku, e-maily, jména, hesla ani DATABASE_URL.
type Level = "info" | "error";

export function logEvent(level: Level, component: string, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, component, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

// Z chyby vytáhne jen diagnosticky užitečné a bezpečné údaje: typ, kód (např. Prisma P1017),
// poslední řádek zprávy (skutečná příčina) a první místo ve vlastním kódu `src/`.
export function describeError(err: unknown) {
  if (!(err instanceof Error)) return { errorType: typeof err };
  const lines = err.message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const frame = err.stack?.split("\n").find((l) => /[\\/]src[\\/]/.test(l) && !l.includes("node_modules"));
  const where = frame?.match(/[\\/](src[\\/][^:()]+:\d+)/)?.[1]?.replaceAll("\\", "/");
  const code = (err as { code?: unknown }).code;
  return {
    errorType: err.name,
    ...(typeof code === "string" ? { code } : {}),
    cause: lines.at(-1)?.slice(0, 200),
    ...(where ? { where } : {}),
  };
}
