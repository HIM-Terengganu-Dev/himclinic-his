import { Pool } from 'pg';

// Create a connection pool to the database
// DATABASE_URL is required for authentication to work
let pool: Pool | null = null;

if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false, // Required for Neon DB in some environments
        },
        max: 10, // Max number of clients in the pool
        idleTimeoutMillis: 30000,
    });

    // Set timezone and search_path for all connections
    pool.on('connect', async (client) => {
        try {
            await client.query("SET timezone = 'Asia/Kuala_Lumpur'");
            // Set search_path to the schema (try both cases)
            await client.query('SET search_path = "his_db", "$user", public');
        } catch (error) {
            console.error('Failed to set timezone/search_path:', error);
            // If lowercase fails, try uppercase
            try {
                await client.query('SET search_path = "HIS_db", "$user", public');
            } catch (error2) {
                console.error('Failed to set search_path with uppercase schema:', error2);
            }
        }
    });
} else {
    console.warn('⚠️ DATABASE_URL not set - authentication will not work. Please set DATABASE_URL in .env.local');
}

export { pool };

// Helper to query the database
export const query = async (text: string, params?: any[]) => {
    if (!pool) {
        throw new Error('Database not configured. Please set DATABASE_URL in .env.local');
    }
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // Uncomment for debug logging
    // console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
};
