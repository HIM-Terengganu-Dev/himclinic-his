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
