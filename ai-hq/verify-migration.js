const { query } = require("../db");

async function verify() {
  try {
    console.log("Verifying AI Headquarters tables...\n");

    const result = await query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE 'ai_%'
            ORDER BY table_name
        `);

    if (result.rowCount === 0) {
      console.log("❌ No AI Headquarters tables found.");
      console.log("Run: node ai-hq/db/migrate.js up");
      process.exit(1);
    }

    console.log(`✅ Found ${result.rowCount} AI Headquarters tables:\n`);
    result.rows.forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.table_name}`);
    });

    // Check for required functions
    const functions = await query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_name IN ('ai_hq_write_audit_event', 'ai_hq_revoke_owner')
        `);

    console.log(`\n✅ Found ${functions.rowCount} AI HQ functions:`);
    functions.rows.forEach((row) => {
      console.log(`  - ${row.routine_name}`);
    });

    // Check seed data
    const settings = await query(`SELECT COUNT(*) as count FROM ai_settings`);
    const pricing = await query(
      `SELECT COUNT(*) as count FROM ai_model_pricing`,
    );

    console.log(`\n✅ Seed data:`);
    console.log(`  - Settings: ${settings.rows[0].count} rows`);
    console.log(`  - Model pricing: ${pricing.rows[0].count} rows`);

    console.log("\n✅ Migration verification complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Verification failed:", error.message);
    process.exit(1);
  }
}

verify();
