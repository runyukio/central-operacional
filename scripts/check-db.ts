import net from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

loadDotEnv();

const databaseUrl = process.env.DATABASE_URL;
const directUrl = process.env.DIRECT_URL;
const localMode = process.env.USE_LOCAL_DB === "true" || process.env.APP_ENV === "local";

async function main() {
  console.log("Central Operacional - diagnóstico de banco");
  const database = inspectUrl("DATABASE_URL", databaseUrl, true);
  inspectUrl("DIRECT_URL", directUrl, false);

  if (!database.ok || !database.url) {
    process.exitCode = 1;
    return;
  }

  const tcp = await checkTcp(database.url);
  if (!tcp.ok) {
    console.error(`✗ Banco inacessível em ${database.url.hostname}:${database.url.port || "5432"}`);
    if (isLocalHost(database.url)) {
      console.error("  O .env aponta para Postgres local. Rode `npm run db:up` e tente novamente.");
    } else {
      console.error("  Verifique rede, host, porta, firewall e connection string do banco.");
    }
    process.exitCode = 1;
    return;
  }
  console.log(`✓ Porta acessível em ${database.url.hostname}:${database.url.port || "5432"}`);

  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log("✓ Prisma conectou e executou SELECT 1");
  } catch (error) {
    process.exitCode = 1;
    printPrismaError(error);
  } finally {
    await prisma.$disconnect();
  }
}

function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function inspectUrl(name: string, value: string | undefined, required: boolean) {
  if (!value) {
    const message = `${name} ausente no .env.`;
    if (required) console.error(`✗ ${message}`);
    else console.warn(`! ${message} Necessária para migrations.`);
    return { ok: !required, url: null as URL | null };
  }

  if (hasPlaceholder(value) && !localMode) {
    console.error(`✗ ${name} ainda contém placeholders. Substitua PROJECT_REF, REGION e URL_ENCODED_PASSWORD pelos dados reais do Supabase.`);
    return { ok: false, url: null as URL | null };
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      console.error(`✗ ${name} precisa começar com postgresql:// ou postgres://`);
      return { ok: false, url };
    }
    if (!url.username || !url.hostname || !url.pathname || url.pathname === "/") {
      console.error(`✗ ${name} está incompleta. Esperado usuário, host e database.`);
      return { ok: false, url };
    }
    console.log(`✓ ${name}: ${url.protocol}//${url.username}:***@${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`);
    if (isLocalHost(url)) {
      if (localMode) {
        console.log(`✓ ${name}: modo local usando Postgres em ${url.hostname}:${url.port || "5432"}`);
      } else {
        console.warn(`! ${name}: a aplicação está usando banco local (${url.hostname}) fora do modo local.`);
      }
    }
    if (/[#?/:@&=+%]/.test(decodeURIComponent(url.password)) && !/%[0-9A-Fa-f]{2}/.test(url.password)) {
      console.warn(`! ${name}: se sua senha tiver caracteres especiais, use URL encoding.`);
    }
    return { ok: true, url };
  } catch {
    console.error(`✗ ${name} inválida. Revise aspas, caracteres especiais e URL encoding da senha.`);
    return { ok: false, url: null as URL | null };
  }
}

function hasPlaceholder(value: string) {
  return /PROJECT_REF|URL_ENCODED_PASSWORD|SUPABASE_|REGION|USER:PASSWORD|HOST/.test(value);
}

function isLocalHost(url: URL) {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

function checkTcp(url: URL) {
  const port = Number(url.port || 5432);
  return new Promise<{ ok: boolean }>((resolvePromise) => {
    const socket = net.createConnection({ host: url.hostname, port, timeout: 5000 });
    socket.once("connect", () => {
      socket.destroy();
      resolvePromise({ ok: true });
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolvePromise({ ok: false });
    });
    socket.once("error", () => resolvePromise({ ok: false }));
  });
}

function printPrismaError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const help: Record<string, string> = {
      P1000: "Autenticação falhou. Confira usuário e senha. Se a senha tem caracteres especiais, aplique URL encoding.",
      P1001: localMode ? "Banco local inacessível. Rode `npm run db:up` e tente novamente." : "Banco inacessível. Confira host, porta, rede e se o projeto está ativo.",
      P1002: "Conexão abriu, mas expirou. Confira pooler, região e firewall.",
      P1003: localMode ? "Database local não existe. Confira POSTGRES_DB no docker-compose.yml." : "Database não existe. No Supabase normalmente use /postgres.",
      P1010: "Usuário não tem permissão para acessar o database.",
      P1011: "Erro de TLS/SSL. Em Supabase, use sslmode=require quando a string pedir.",
      P1013: "Connection string inválida."
    };
    console.error(`✗ Prisma ${error.code}: ${help[error.code] ?? error.message}`);
    return;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    console.error(`✗ Prisma não inicializou: ${error.message}`);
    return;
  }

  console.error("✗ Erro desconhecido ao conectar no banco:", error);
}

main().catch((error) => {
  console.error("Erro inesperado no diagnóstico de banco:", error);
  process.exitCode = 1;
});
