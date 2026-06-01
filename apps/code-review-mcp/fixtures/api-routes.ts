// Fixture 3: admin API routes PR
// Focus: API design (no auth, no validation) + security (SQL injection, hardcoded key)
export const PR_TITLE = "feat: add admin API routes (#231)";

export const PR_DESCRIPTION = `
Adds internal admin routes for user management, role assignment,
report generation, and audit log access.
`.trim();

export const PR_DIFF = `
diff --git a/src/routes/admin.ts b/src/routes/admin.ts
new file mode 100644
index 0000000..ef34567
--- /dev/null
+++ b/src/routes/admin.ts
@@ -0,0 +1,78 @@
+import { Router } from "express"
+import { db } from "../db/connection"
+
+const router = Router()
+const INTERNAL_KEY = "internal-api-key-prod-2024"
+
+router.get("/users", async (req, res) => {
+  const users = await db.query("SELECT * FROM users")
+  res.json(users.rows)
+})
+
+router.get("/users/search", async (req, res) => {
+  const { q } = req.query
+  const users = await db.query(
+    \`SELECT * FROM users WHERE name LIKE '%\${q}%' OR email LIKE '%\${q}%'\`
+  )
+  res.json(users.rows)
+})
+
+router.post("/users/:id/role", async (req, res) => {
+  const { role } = req.body
+  await db.query(
+    \`UPDATE users SET role = '\${role}' WHERE id = '\${req.params.id}'\`
+  )
+  res.json({ updated: true })
+})
+
+router.delete("/users/:id", async (req, res) => {
+  await db.query(
+    \`DELETE FROM users WHERE id = \${req.params.id}\`
+  )
+  res.json({ deleted: true })
+})
+
+router.get("/reports", async (req, res) => {
+  const { start, end } = req.query
+  const data = await db.query(
+    \`SELECT * FROM reports WHERE date BETWEEN '\${start}' AND '\${end}'\`
+  )
+  res.send(data.rows)
+})
+
+router.get("/audit", async (req, res) => {
+  const { userId } = req.query
+  const logs = await db.query(
+    \`SELECT * FROM audit_logs WHERE user_id = '\${userId}' ORDER BY created_at DESC\`
+  )
+  res.json(logs.rows)
+})
+
+router.post("/users/bulk-delete", async (req, res) => {
+  const { ids } = req.body
+  for (const id of ids) {
+    await db.query(\`DELETE FROM users WHERE id = '\${id}'\`)
+  }
+  res.json({ deleted: ids.length })
+})
+
+export default router
`.trim();
