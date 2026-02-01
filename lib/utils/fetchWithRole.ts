/**
 * Fetch wrapper that automatically adds the switched role header for dev users
 * This allows dev users to test different role views
 */
export async function fetchWithRole(url: string, options: RequestInit = {}): Promise<Response> {
    // Get switched role from sessionStorage if user is dev
    // Check if we're in browser environment (sessionStorage is available)
    let switchedRole: string | null = null;
    if (typeof window !== 'undefined' && window.sessionStorage) {
        try {
            switchedRole = sessionStorage.getItem('switchedRole');
        } catch (e) {
            // sessionStorage might not be available (e.g., in private browsing)
            console.warn('sessionStorage not available:', e);
        }
    }
    
    // Add header if switched role exists
    const headers = new Headers(options.headers);
    if (switchedRole && (switchedRole === 'admin' || switchedRole === 'dev' || switchedRole === 'user')) {
        headers.set('x-switched-role', switchedRole);
    }
    
    return fetch(url, {
        ...options,
        headers
    });
}
