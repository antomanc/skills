export type Product = { id: number; name: string; category: string; price: number }

// Pretends to be a slow server: later answers can arrive before earlier ones.
export async function searchProducts(query: string): Promise<Product[]> {
  const all: Product[] = [
    { id: 1, name: 'Oat milk', category: 'drinks', price: 2.1 },
    { id: 2, name: 'Tofu', category: 'protein', price: 3.4 },
    { id: 3, name: 'Tempeh', category: 'protein', price: 3.9 },
    { id: 4, name: 'Cold brew', category: 'drinks', price: 4.5 },
  ]
  await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 400))
  const data: any = all.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
  return data
}
