/* -------------------------------------------------------------------------- */
/*  Autenticación — registro/login con scrypt + tokens firmados (HMAC-SHA256).  */
/*  Sin dependencias (node:crypto). Suficiente para un MVP; en producción se     */
/*  recomienda rotar el secret y usar cookies Secure detrás de HTTPS.            */
/* -------------------------------------------------------------------------- */

import {scryptSync, randomBytes, timingSafeEqual, createHmac, randomUUID} from "node:crypto";
import {readFileSync, writeFileSync, existsSync, mkdirSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import * as store from "./db-store.mjs";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const SECRET_FILE = join(DATA_DIR, ".secret");

// Secret persistente para firmar tokens (o desde env).
function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (existsSync(SECRET_FILE)) return readFileSync(SECRET_FILE, "utf8");
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, {recursive: true});
  const s = randomBytes(32).toString("hex");
  writeFileSync(SECRET_FILE, s);
  return s;
}
const SECRET = loadSecret();
const TOKEN_TTL = 7 * 24 * 3600 * 1000; // 7 días

/* ------------------------------ passwords -------------------------------- */

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return {salt, hash};
}
function verifyPassword(password, salt, expectedHash) {
  const {hash} = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* -------------------------------- tokens --------------------------------- */

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const sign = (data) => createHmac("sha256", SECRET).update(data).digest("base64url");

export function issueToken(userId) {
  const payload = b64({uid: userId, exp: Date.now() + TOKEN_TTL});
  return `${payload}.${sign(payload)}`;
}
export async function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (sign(payload) !== sig) return null;
  try {
    const {uid, exp} = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > exp) return null;
    return await store.getUserById(uid);
  } catch {
    return null;
  }
}

/* ---------------------------- signup / login ----------------------------- */

export async function slugify(name) {
  // NFD separa la letra de su acento; quitamos todo lo no-ASCII (los acentos).
  const base = name.toLowerCase().normalize("NFD").replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "negocio";
  let slug = base, n = 1;
  while (await store.getTenantBySlug(slug)) slug = `${base}-${++n}`;
  return slug;
}

export async function signup({email, password, businessName, services, hours}) {
  if (!email || !password || password.length < 6) return {ok: false, error: "Email y contraseña (mín 6) requeridos."};
  if (await store.getUserByEmail(email)) return {ok: false, error: "Ese email ya está registrado."};

  const tenant = await store.upsertTenant({
    name: businessName || "Mi negocio",
    slug: await slugify(businessName || email.split("@")[0]),
    services: services?.length ? services : ["consulta"],
    hours,
    plan: "trial",
  });
  const {salt, hash} = hashPassword(password);
  const user = await store.addUser({email, password_hash: hash, salt, tenant_id: tenant.id});
  return {ok: true, token: issueToken(user.id), tenant, user: {id: user.id, email: user.email}};
}

/** Crea un usuario para un tenant existente si no existe (para el seed demo). */
export async function ensureUser({email, password, tenantId}) {
  const existing = await store.getUserByEmail(email);
  if (existing) return existing;
  const {salt, hash} = hashPassword(password);
  return await store.addUser({email, password_hash: hash, salt, tenant_id: tenantId});
}

export async function login({email, password}) {
  const user = email && (await store.getUserByEmail(email));
  if (!user || !verifyPassword(password, user.salt, user.password_hash))
    return {ok: false, error: "Email o contraseña incorrectos."};
  return {ok: true, token: issueToken(user.id), tenant: await store.getTenantById(user.tenant_id)};
}
