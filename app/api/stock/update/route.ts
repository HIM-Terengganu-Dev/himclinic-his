import { NextResponse } from 'next/server';
import { updateProductStock } from '@/lib/services/woocommerce';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productId, stockQuantity } = body;

    if (!productId || stockQuantity === undefined) {
      return NextResponse.json(
        { success: false, error: 'productId and stockQuantity are required' },
        { status: 400 }
      );
    }

    const updatedProduct = await updateProductStock(productId, stockQuantity);

    return NextResponse.json({
      success: true,
      product: updatedProduct,
    });
  } catch (error) {
    console.error('Error in stock update API:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update stock' },
      { status: 500 }
    );
  }
}



