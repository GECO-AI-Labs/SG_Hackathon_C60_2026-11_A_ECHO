/**
 * Create a login for a teammate or demo reviewer.
 *   npm run user:create -- <email> "<Display Name>" <password>
 * Example:
 *   npm run user:create -- manager@echo.demo "Marketing Manager" choose-a-password
 */
import { adminClient, log } from "./_env";

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) {
    console.error('Usage: npm run user:create -- <email> "<Display Name>" <password>');
    process.exit(1);
  }
  const db = adminClient();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error) throw error;
  log(`created ${email} (${data.user.id})`);
}

main().catch((e) => {
  console.error("✗", e.message ?? e);
  process.exit(1);
});
