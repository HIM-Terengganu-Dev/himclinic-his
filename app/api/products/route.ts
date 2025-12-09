import { NextResponse } from 'next/server';
import { getProducts } from '@/lib/services/woocommerce';

export async function GET() {
  try {
    const products = await getProducts({ per_page: 100 });
    
    return NextResponse.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    console.error('Error in products API:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}




