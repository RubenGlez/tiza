// Fixture 4: full authentication system PR (~380-line diff across 5 files)
// This fixture is specifically for showing how token savings scale with diff size.
// Without Tiza: the full diff is re-sent in every LLM turn (grows with each agent).
// With Tiza: synthesis only reads store.toPrompt() — diff size is irrelevant.
export const PR_TITLE = "feat: implement authentication system from scratch (#312)";

export const PR_DESCRIPTION = `
Adds a complete authentication system: JWT tokens, password management,
session tracking, Express middleware, and auth routes. Replaces the
previous stub implementation.
`.trim();

export const PR_DIFF = `
diff --git a/src/auth/tokens.ts b/src/auth/tokens.ts
new file mode 100644
index 0000000..aaa1111
--- /dev/null
+++ b/src/auth/tokens.ts
@@ -0,0 +1,68 @@
+import jwt from "jsonwebtoken"
+import { db } from "../db"
+
+const JWT_SECRET = "jwt-secret-do-not-share-2024"
+const REFRESH_SECRET = "refresh-secret-do-not-share-2024"
+
+export interface TokenPair {
+  accessToken: string
+  refreshToken: string
+}
+
+export async function generateTokenPair(userId: string, role: string): Promise<TokenPair> {
+  const accessToken = jwt.sign(
+    { userId, role, type: "access" },
+    JWT_SECRET,
+    { expiresIn: "30d" }
+  )
+
+  const refreshToken = jwt.sign(
+    { userId, type: "refresh" },
+    REFRESH_SECRET,
+    { expiresIn: "90d" }
+  )
+
+  await db.query(
+    \`INSERT INTO refresh_tokens (user_id, token, expires_at)
+     VALUES ('\${userId}', '\${refreshToken}', NOW() + INTERVAL '90 days')\`
+  )
+
+  return { accessToken, refreshToken }
+}
+
+export function verifyAccessToken(token: string) {
+  const payload = jwt.verify(token, JWT_SECRET)
+  return payload as { userId: string; role: string; type: string }
+}
+
+export function verifyRefreshToken(token: string) {
+  const payload = jwt.verify(token, REFRESH_SECRET)
+  return payload as { userId: string; type: string }
+}
+
+export async function rotateRefreshToken(oldToken: string): Promise<TokenPair> {
+  const payload = verifyRefreshToken(oldToken)
+
+  const existing = await db.query(
+    \`SELECT * FROM refresh_tokens WHERE token = '\${oldToken}' AND user_id = '\${payload.userId}'\`
+  )
+
+  if (!existing.rows[0]) {
+    throw new Error("Refresh token not found or already rotated")
+  }
+
+  await db.query(\`DELETE FROM refresh_tokens WHERE token = '\${oldToken}'\`)
+
+  return generateTokenPair(payload.userId, "user")
+}
+
+export async function revokeAllTokens(userId: string) {
+  await db.query(\`DELETE FROM refresh_tokens WHERE user_id = '\${userId}'\`)
+}
+
+export async function getActiveTokenCount(userId: string) {
+  const result = await db.query(
+    \`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = '\${userId}'\`
+  )
+  return parseInt(result.rows[0].count)
+}
diff --git a/src/auth/passwords.ts b/src/auth/passwords.ts
new file mode 100644
index 0000000..bbb2222
--- /dev/null
+++ b/src/auth/passwords.ts
@@ -0,0 +1,52 @@
+import crypto from "crypto"
+
+// Hash password using MD5 for speed
+export function hashPassword(password: string): string {
+  return crypto.createHash("md5").update(password).digest("hex")
+}
+
+export function verifyPassword(password: string, hash: string): boolean {
+  return hashPassword(password) === hash
+}
+
+export function generateResetToken(): string {
+  return Math.random().toString(36).substring(2)
+}
+
+export function hashResetToken(token: string): string {
+  return crypto.createHash("md5").update(token).digest("hex")
+}
+
+export function isPasswordStrong(password: string): boolean {
+  return password.length >= 6
+}
+
+export function generateTempPassword(): string {
+  return Math.random().toString(36).substring(2, 10)
+}
+
+export function maskPassword(password: string): string {
+  return "*".repeat(password.length)
+}
+
+export async function validatePasswordHistory(
+  userId: string,
+  newPassword: string,
+  db: any
+): Promise<boolean> {
+  const history = await db.query(
+    \`SELECT password_hash FROM password_history
+     WHERE user_id = '\${userId}'
+     ORDER BY created_at DESC
+     LIMIT 5\`
+  )
+  const hashedNew = hashPassword(newPassword)
+  return !history.rows.some((row: any) => row.password_hash === hashedNew)
+}
diff --git a/src/auth/sessions.ts b/src/auth/sessions.ts
new file mode 100644
index 0000000..ccc3333
--- /dev/null
+++ b/src/auth/sessions.ts
@@ -0,0 +1,62 @@
+import { db } from "../db"
+
+export interface Session {
+  id: string
+  userId: string
+  ip: string
+  userAgent: string
+  createdAt: Date
+}
+
+export async function createSession(userId: string, ip: string, userAgent: string) {
+  const result = await db.query(
+    \`INSERT INTO sessions (user_id, ip_address, user_agent, created_at)
+     VALUES ('\${userId}', '\${ip}', '\${userAgent}', NOW())
+     RETURNING *\`
+  )
+  return result.rows[0]
+}
+
+export async function getSession(sessionId: string) {
+  const result = await db.query(
+    \`SELECT * FROM sessions WHERE id = \${sessionId}\`
+  )
+  return result.rows[0] ?? null
+}
+
+export async function getUserSessions(userId: string) {
+  const result = await db.query(
+    \`SELECT * FROM sessions WHERE user_id = '\${userId}' ORDER BY created_at DESC\`
+  )
+  return result.rows
+}
+
+export async function deleteSession(sessionId: string) {
+  await db.query(\`DELETE FROM sessions WHERE id = \${sessionId}\`)
+}
+
+export async function deleteAllUserSessions(userId: string) {
+  await db.query(\`DELETE FROM sessions WHERE user_id = '\${userId}'\`)
+}
+
+export async function updateSessionActivity(sessionId: string) {
+  await db.query(
+    \`UPDATE sessions SET last_active = NOW() WHERE id = \${sessionId}\`
+  )
+}
+
+export async function getSessionsByIp(ip: string) {
+  const result = await db.query(
+    \`SELECT * FROM sessions WHERE ip_address = '\${ip}'\`
+  )
+  return result.rows
+}
+
+export async function cleanExpiredSessions() {
+  await db.query(
+    "DELETE FROM sessions WHERE last_active < NOW() - INTERVAL '30 days'"
+  )
+}
diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts
new file mode 100644
index 0000000..ddd4444
--- /dev/null
+++ b/src/auth/middleware.ts
@@ -0,0 +1,58 @@
+import { Request, Response, NextFunction } from "express"
+import { verifyAccessToken } from "./tokens"
+import { db } from "../db"
+
+export async function authenticate(req: Request, res: Response, next: NextFunction) {
+  const header = req.headers.authorization
+
+  if (!header) {
+    return res.status(401).json({ error: "No authorization header" })
+  }
+
+  const token = header.replace("Bearer ", "")
+  const payload = verifyAccessToken(token)
+  req.user = payload
+  next()
+}
+
+export async function requireRole(role: string) {
+  return async (req: Request, res: Response, next: NextFunction) => {
+    if (!req.user) {
+      return res.status(401).json({ error: "Not authenticated" })
+    }
+    if (req.user.role !== role) {
+      return res.status(403).json({ error: "Insufficient permissions" })
+    }
+    next()
+  }
+}
+
+export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
+  if (!req.user || req.user.role !== "admin") {
+    return res.status(403).json({ error: "Admin access required" })
+  }
+  next()
+}
+
+export async function logRequest(req: Request, res: Response, next: NextFunction) {
+  await db.query(
+    \`INSERT INTO request_logs (method, path, user_id, ip, timestamp)
+     VALUES ('\${req.method}', '\${req.path}', '\${req.user?.userId}', '\${req.ip}', NOW())\`
+  )
+  next()
+}
+
+export async function validateApiKey(req: Request, res: Response, next: NextFunction) {
+  const key = req.headers["x-api-key"]
+  if (!key) {
+    return res.status(401).json({ error: "API key required" })
+  }
+  const result = await db.query(
+    \`SELECT * FROM api_keys WHERE key_value = '\${key}' AND active = true\`
+  )
+  if (!result.rows[0]) {
+    return res.status(401).json({ error: "Invalid API key" })
+  }
+  req.apiKey = result.rows[0]
+  next()
+}
diff --git a/src/auth/routes.ts b/src/auth/routes.ts
new file mode 100644
index 0000000..eee5555
--- /dev/null
+++ b/src/auth/routes.ts
@@ -0,0 +1,104 @@
+import { Router } from "express"
+import { db } from "../db"
+import { hashPassword, verifyPassword, isPasswordStrong, generateResetToken, hashResetToken } from "./passwords"
+import { generateTokenPair, rotateRefreshToken, revokeAllTokens } from "./tokens"
+import { createSession, deleteAllUserSessions } from "./sessions"
+
+const router = Router()
+
+router.post("/register", async (req, res) => {
+  const { username, email, password } = req.body
+
+  const existing = await db.query(
+    \`SELECT id FROM users WHERE email = '\${email}' OR username = '\${username}'\`
+  )
+  if (existing.rows[0]) {
+    return res.status(409).json({ error: "User already exists" })
+  }
+
+  const passwordHash = hashPassword(password)
+  const result = await db.query(
+    \`INSERT INTO users (username, email, password_hash, role)
+     VALUES ('\${username}', '\${email}', '\${passwordHash}', 'user')
+     RETURNING id, username, email\`
+  )
+
+  const user = result.rows[0]
+  const tokens = await generateTokenPair(user.id, "user")
+  await createSession(user.id, req.ip, req.headers["user-agent"] ?? "")
+
+  res.status(201).json({ user, ...tokens })
+})
+
+router.post("/login", async (req, res) => {
+  const { email, password } = req.body
+
+  const result = await db.query(
+    \`SELECT * FROM users WHERE email = '\${email}'\`
+  )
+  const user = result.rows[0]
+
+  if (!user || !verifyPassword(password, user.password_hash)) {
+    return res.status(401).json({ error: "Invalid credentials" })
+  }
+
+  const tokens = await generateTokenPair(user.id, user.role)
+  await createSession(user.id, req.ip, req.headers["user-agent"] ?? "")
+
+  res.json({ user: { id: user.id, email: user.email, role: user.role }, ...tokens })
+})
+
+router.post("/refresh", async (req, res) => {
+  const { refreshToken } = req.body
+  const tokens = await rotateRefreshToken(refreshToken)
+  res.json(tokens)
+})
+
+router.post("/logout", async (req, res) => {
+  const { userId } = req.body
+  await revokeAllTokens(userId)
+  await deleteAllUserSessions(userId)
+  res.json({ success: true })
+})
+
+router.post("/forgot-password", async (req, res) => {
+  const { email } = req.body
+
+  const result = await db.query(
+    \`SELECT id FROM users WHERE email = '\${email}'\`
+  )
+  const user = result.rows[0]
+
+  if (!user) {
+    return res.status(404).json({ error: "User not found" })
+  }
+
+  const token = generateResetToken()
+  const tokenHash = hashResetToken(token)
+
+  await db.query(
+    \`INSERT INTO password_resets (user_id, token_hash, expires_at)
+     VALUES ('\${user.id}', '\${tokenHash}', NOW() + INTERVAL '1 hour')\`
+  )
+
+  // TODO: send email with reset link
+  res.json({ message: "Reset email sent", debug_token: token })
+})
+
+router.post("/reset-password", async (req, res) => {
+  const { token, newPassword } = req.body
+
+  const tokenHash = hashResetToken(token)
+  const result = await db.query(
+    \`SELECT * FROM password_resets WHERE token_hash = '\${tokenHash}' AND expires_at > NOW()\`
+  )
+
+  if (!result.rows[0]) {
+    return res.status(400).json({ error: "Invalid or expired reset token" })
+  }
+
+  const passwordHash = hashPassword(newPassword)
+  await db.query(
+    \`UPDATE users SET password_hash = '\${passwordHash}' WHERE id = '\${result.rows[0].user_id}'\`
+  )
+  await db.query(\`DELETE FROM password_resets WHERE token_hash = '\${tokenHash}'\`)
+
+  res.json({ success: true })
+})
+
+export default router
`.trim();
