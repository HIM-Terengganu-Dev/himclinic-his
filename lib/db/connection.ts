import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not defined');
}

// Create a connection pool to the database
export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // Required for Neon DB in some environments
    },
    max: 10, // Max number of clients in the pool
    idleTimeoutMillis: 30000,
});

// Helper to query the database
export const query = async (text: string, params?: any[]) => {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    // Uncomment for debug logging
    // console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
};
