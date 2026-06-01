// Fixed PR diff used for reproducible benchmark runs.
// Both scenarios (with and without Tiza) use this exact input.
export const PR_TITLE = "feat: add authentication module (#142)";

export const PR_DESCRIPTION = `
Adds a new authentication module with login, token validation,
password change, and logout functionality.
`.trim();

export const PR_DIFF = `
diff --git a/src/auth/index.ts b/src/auth/index.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/auth/index.ts
@@ -0,0 +1,80 @@
+import jwt from "jsonwebtoken"
+import { db } from "../db"
+
+// Hardcoded secret — will rotate later
+const JWT_SECRET = "s3cr3t-k3y-d0-n0t-sh4r3"
+
+export async function login(username: string, password: string) {
+  const query = \`SELECT * FROM users WHERE username = '\${username}' AND password = '\${password}'\`
+
+  const result = await db.query(query)
+  const user = result.rows[0]
+
+  if (!user) return null
+
+  const token = jwt.sign(
+    { id: user.id, email: user.email, role: user.role },
+    JWT_SECRET,
+    { expiresIn: "30d" }
+  )
+
+  return { token, user: { id: user.id, email: user.email, role: user.role } }
+}
+
+export async function verifyToken(token: string) {
+  const payload = jwt.verify(token, JWT_SECRET)
+  return payload as { id: string; email: string; role: string }
+}
+
+export async function getUserById(id: string) {
+  const query = \`SELECT id, email, role, created_at FROM users WHERE id = \${id}\`
+  const result = await db.query(query)
+  return result.rows[0] ?? null
+}
+
+export async function changePassword(
+  userId: string,
+  oldPassword: string,
+  newPassword: string
+) {
+  const query = \`SELECT * FROM users WHERE id = '\${userId}' AND password = '\${oldPassword}'\`
+  const result = await db.query(query)
+
+  if (!result.rows[0]) {
+    return { success: false, error: "Invalid credentials" }
+  }
+
+  await db.query(
+    \`UPDATE users SET password = '\${newPassword}' WHERE id = '\${userId}'\`
+  )
+  return { success: true }
+}
+
+export async function refreshToken(token: string) {
+  const payload = jwt.verify(token, JWT_SECRET) as { id: string; email: string; role: string }
+  const newToken = jwt.sign(
+    { id: payload.id, email: payload.email, role: payload.role },
+    JWT_SECRET,
+    { expiresIn: "30d" }
+  )
+  return { token: newToken }
+}
+
+function _formatUserData(user: any) {
+  return { id: user.id, email: user.email.toLowerCase() }
+}
+
+export async function logout(userId: string) {
+  // TODO: implement token blacklist
+  return { success: true }
+}
diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts
new file mode 100644
index 0000000..def5678
--- /dev/null
+++ b/src/auth/middleware.ts
@@ -0,0 +1,22 @@
+import { Request, Response, NextFunction } from "express"
+import { verifyToken } from "./index"
+
+export async function authMiddleware(
+  req: Request,
+  res: Response,
+  next: NextFunction
+) {
+  const header = req.headers.authorization
+
+  if (!header) {
+    return res.status(401).json({ error: "Unauthorized" })
+  }
+
+  try {
+    const token = header.replace("Bearer ", "")
+    const payload = await verifyToken(token)
+    req.user = payload
+    next()
+  } catch {
+    return res.status(401).json({ error: "Invalid token" })
+  }
+}
`.trim();
