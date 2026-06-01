// Fixture 2: data repository PR
// Focus: performance (N+1 queries, missing pagination) + security (SQL injection)
export const PR_TITLE = "feat: add user repository layer (#198)";

export const PR_DESCRIPTION = `
Extracts all user-related database queries into a dedicated repository module.
Adds search, bulk operations, activity logging, and reporting.
`.trim();

export const PR_DIFF = `
diff --git a/src/db/user-repository.ts b/src/db/user-repository.ts
new file mode 100644
index 0000000..bcd2345
--- /dev/null
+++ b/src/db/user-repository.ts
@@ -0,0 +1,72 @@
+import { db } from "./connection"
+
+export async function getUsersWithPermissions(role: string) {
+  const query = \`SELECT * FROM users WHERE role = '\${role}'\`
+  const users = await db.query(query)
+
+  const result = []
+  for (const user of users.rows) {
+    const perms = await db.query(
+      \`SELECT * FROM permissions WHERE user_id = \${user.id}\`
+    )
+    result.push({ ...user, permissions: perms.rows })
+  }
+  return result
+}
+
+export async function searchUsers(term: string) {
+  const users = await db.query(
+    \`SELECT * FROM users WHERE name LIKE '%\${term}%' OR email LIKE '%\${term}%'\`
+  )
+  return users.rows
+}
+
+export async function getUserById(id: string) {
+  const result = await db.query(
+    \`SELECT * FROM users WHERE id = \${id}\`
+  )
+  return result.rows[0] ?? null
+}
+
+export async function bulkUpdateStatus(ids: string[], status: string) {
+  for (const id of ids) {
+    await db.query(
+      \`UPDATE users SET status = '\${status}', updated_at = NOW() WHERE id = '\${id}'\`
+    )
+  }
+}
+
+export async function getFullReport() {
+  const users = await db.query("SELECT * FROM users")
+  const orders = await db.query("SELECT * FROM orders")
+  const payments = await db.query("SELECT * FROM payments")
+  return {
+    users: users.rows,
+    orders: orders.rows,
+    payments: payments.rows,
+  }
+}
+
+export async function getUserActivity(userId: string) {
+  const logs = await db.query(
+    \`SELECT * FROM activity_logs WHERE user_id = '\${userId}' ORDER BY created_at DESC\`
+  )
+  return logs.rows
+}
+
+export async function createUser(data: any) {
+  const result = await db.query(
+    \`INSERT INTO users (name, email, role) VALUES ('\${data.name}', '\${data.email}', '\${data.role}')\`
+  )
+  return result.rows[0]
+}
`.trim();
