export interface HeldSku {
    sku: string;
    processing: number;
    pending_consult: number;
    pending_review: number;
}

export interface SandboxOrder {
    order_id: number;
    current_status: string;
    affected_skus: string[];
    first_seen_at: string;
    last_event_at: string;
    last_webhook_event: string;
    held_stock: HeldSku[];
}

const INITIAL_MOCK_ORDERS: SandboxOrder[] = [
    {
        order_id: 99101,
        current_status: 'processing',
        affected_skus: ['iqn100/4tab'],
        first_seen_at: new Date(Date.now() - 3600000 * 24).toISOString(),
        last_event_at: new Date(Date.now() - 3600000 * 2).toISOString(),
        last_webhook_event: 'order.processing',
        held_stock: [
            { sku: 'iqn100/4tab', processing: 1, pending_consult: 0, pending_review: 0 }
        ]
    },
    {
        order_id: 99102,
        current_status: 'pending-consult',
        affected_skus: ['tad20/4tab', 'tra/10tab'],
        first_seen_at: new Date(Date.now() - 3600000 * 48).toISOString(),
        last_event_at: new Date(Date.now() - 3600000 * 5).toISOString(),
        last_webhook_event: 'order.pending-consult',
        held_stock: [
            { sku: 'tad20/4tab', processing: 0, pending_consult: 2, pending_review: 0 },
            { sku: 'tra/10tab', processing: 0, pending_consult: 1, pending_review: 0 }
        ]
    },
    {
        order_id: 99103,
        current_status: 'pending-review',
        affected_skus: ['tad5/10tab'],
        first_seen_at: new Date(Date.now() - 3600000 * 12).toISOString(),
        last_event_at: new Date(Date.now() - 3600000 * 1).toISOString(),
        last_webhook_event: 'order.pending-review',
        held_stock: [
            { sku: 'tad5/10tab', processing: 0, pending_consult: 0, pending_review: 2 }
        ]
    }
];

let sandboxOrders: SandboxOrder[] = JSON.parse(JSON.stringify(INITIAL_MOCK_ORDERS));

export function getSandboxOrders(): SandboxOrder[] {
    return sandboxOrders;
}

export function resetSandboxOrders(): SandboxOrder[] {
    sandboxOrders = JSON.parse(JSON.stringify(INITIAL_MOCK_ORDERS));
    return sandboxOrders;
}

export function resolveSandboxOrder(
    orderId: number,
    reason: string,
    resolutionType: 'nv-pending-pickup' | 'cancelled' | 'refunded'
) {
    const orderIndex = sandboxOrders.findIndex(o => o.order_id === orderId);
    if (orderIndex === -1) {
        throw new Error(`Sandbox order #${orderId} not found`);
    }

    const order = sandboxOrders[orderIndex];
    const results = order.held_stock.map(h => {
        const totalCleared = h.processing + h.pending_consult + h.pending_review;
        const deducted = resolutionType === 'nv-pending-pickup' ? totalCleared : 0;
        return {
            sku: h.sku,
            processing_cleared: h.processing,
            pending_consult_cleared: h.pending_consult,
            pending_review_cleared: h.pending_review,
            in_warehouse_deducted: deducted,
        };
    });

    // Remove order from active sandbox list
    sandboxOrders.splice(orderIndex, 1);

    return results;
}
