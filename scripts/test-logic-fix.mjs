import assert from 'assert';

// Definition of isDeferredAloneSku and checkOrderHasMedication
function isDeferredAloneSku(sku) {
    const s = (sku || '').trim().toLowerCase();
    return s === 'him1' || s === 'her1' || s === 'himsp' || s === 'cofcup' ||
           s === 'buku/bk' || s === 'buku/sm' || s === 'bkbk' ||
           s === 'tra/10tab';
}

function checkOrderHasMedication(lineItems, singleSkuMap, comboSkuMap) {
    for (const item of lineItems) {
        if (!item.sku) continue;
        const sku = item.sku.trim();

        // 1. Direct single SKU
        if (singleSkuMap.has(sku)) {
            if (!isDeferredAloneSku(sku)) {
                return true;
            }
        }
        // 2. Combo SKU
        else if (comboSkuMap.has(sku)) {
            const combo = comboSkuMap.get(sku);
            if (!combo) continue;
            const components = Array.isArray(combo.components)
                ? combo.components
                : JSON.parse(combo.components || '[]');

            for (const comp of components) {
                if (comp.sku && !isDeferredAloneSku(comp.sku)) {
                    return true;
                }
            }
        }
    }
    return false;
}

// Mock SKU maps
const singleSkuMap = new Map([
    ['him1', { sku: 'him1', name: 'HIM Coffee' }],
    ['her1', { sku: 'her1', name: 'HER Coffee' }],
    ['tra/10tab', { sku: 'tra/10tab', name: 'Pil Tahan Lama' }],
    ['tad20/4tab', { sku: 'tad20/4tab', name: 'Pil Hujung Minggu 20mg' }],
    ['tad5/10tab', { sku: 'tad5/10tab', name: 'Pil Harian 5mg' }],
    ['spu1', { sku: 'spu1', name: 'Spray Up 10ml' }],
    ['via100/4tab', { sku: 'via100/4tab', name: 'Pil Biru 100mg' }],
    ['iqn50/4tab', { sku: 'iqn50/4tab', name: 'Pil Biru 50mg' }],
    ['cofcup', { sku: 'cofcup', name: 'Coffee Cup' }],
    ['buku/BK', { sku: 'buku/BK', name: 'Buku' }]
]);

const comboSkuMap = new Map([
    ['him3', { sku: 'him3', components: [{ sku: 'him1', quantity: 3 }] }],
    ['him9', { sku: 'him9', components: [{ sku: 'him1', quantity: 9 }] }],
    ['tra/30tab', { sku: 'tra/30tab', components: [{ sku: 'tra/10tab', quantity: 3 }] }],
    ['kom/tad20+Him', { sku: 'kom/tad20+Him', components: [{ sku: 'him1', quantity: 1 }, { sku: 'tad20/4tab', quantity: 1 }] }],
    ['kom/spu+tra', { sku: 'kom/spu+tra', components: [{ sku: 'spu1', quantity: 1 }, { sku: 'tra/10tab', quantity: 1 }] }],
    ['kom/tad20+tra', { sku: 'kom/tad20+tra', components: [{ sku: 'tra/10tab', quantity: 1 }, { sku: 'tad20/4tab', quantity: 1 }] }],
    ['kom/spu+him', { sku: 'kom/spu+him', components: [{ sku: 'spu1', quantity: 1 }, { sku: 'him1', quantity: 1 }] }]
]);

console.log('--- TEST CASES ---');

// Test 1: Single coffee alone
assert.strictEqual(checkOrderHasMedication([{ sku: 'him1', quantity: 1 }], singleSkuMap, comboSkuMap), false, 'him1 alone should NOT have meds');
console.log('✅ Test 1: HIM Coffee alone has NO meds -> deferred');

// Test 2: Coffee combo alone (him3)
assert.strictEqual(checkOrderHasMedication([{ sku: 'him3', quantity: 1 }], singleSkuMap, comboSkuMap), false, 'him3 combo should NOT have meds');
console.log('✅ Test 2: HIM Coffee combo him3 has NO meds -> deferred');

// Test 3: Tra/10tab alone
assert.strictEqual(checkOrderHasMedication([{ sku: 'tra/10tab', quantity: 1 }], singleSkuMap, comboSkuMap), false, 'tra/10tab alone should NOT have meds');
console.log('✅ Test 3: Tra/10tab alone has NO meds -> deferred');

// Test 4: Tra combo alone (tra/30tab)
assert.strictEqual(checkOrderHasMedication([{ sku: 'tra/30tab', quantity: 1 }], singleSkuMap, comboSkuMap), false, 'tra/30tab combo should NOT have meds');
console.log('✅ Test 4: Tra combo tra/30tab has NO meds -> deferred');

// Test 5: Coffee + Tra/10tab (no other meds)
assert.strictEqual(checkOrderHasMedication([{ sku: 'him1', quantity: 1 }, { sku: 'tra/10tab', quantity: 1 }], singleSkuMap, comboSkuMap), false, 'him1 + tra/10tab should NOT have meds');
console.log('✅ Test 5: Coffee + Tra/10tab together has NO other meds -> both deferred');

// Test 6: Coffee + Tad20
assert.strictEqual(checkOrderHasMedication([{ sku: 'him1', quantity: 1 }, { sku: 'tad20/4tab', quantity: 1 }], singleSkuMap, comboSkuMap), true, 'him1 + tad20/4tab MUST have meds');
console.log('✅ Test 6: Coffee + Tad20 HAS meds -> Coffee deducted earlier in pending');

// Test 7: Tra/10tab + Tad20
assert.strictEqual(checkOrderHasMedication([{ sku: 'tra/10tab', quantity: 1 }, { sku: 'tad20/4tab', quantity: 1 }], singleSkuMap, comboSkuMap), true, 'tra/10tab + tad20/4tab MUST have meds');
console.log('✅ Test 7: Tra/10tab + Tad20 HAS meds -> Tra deducted earlier in pending');

// Test 8: Combo kom/tad20+Him
assert.strictEqual(checkOrderHasMedication([{ sku: 'kom/tad20+Him', quantity: 1 }], singleSkuMap, comboSkuMap), true, 'kom/tad20+Him MUST have meds');
console.log('✅ Test 8: Combo kom/tad20+Him HAS meds -> Coffee component deducted earlier in pending');

// Test 9: Combo kom/spu+tra
assert.strictEqual(checkOrderHasMedication([{ sku: 'kom/spu+tra', quantity: 1 }], singleSkuMap, comboSkuMap), true, 'kom/spu+tra MUST have meds');
console.log('✅ Test 9: Combo kom/spu+tra HAS meds -> Tra component deducted earlier in pending');

// Test 10: Tad20 alone
assert.strictEqual(checkOrderHasMedication([{ sku: 'tad20/4tab', quantity: 1 }], singleSkuMap, comboSkuMap), true, 'tad20/4tab alone IS a med');
console.log('✅ Test 10: Tad20 alone IS a med -> deducted on pending consult/review');

console.log('\n🎉 ALL 10 TESTS PASSED!');
