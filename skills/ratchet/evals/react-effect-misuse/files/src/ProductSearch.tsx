import { useEffect, useRef, useState } from 'react'
import { searchProducts, type Product } from './api'
import { useMediaQuery } from './hooks/useMediaQuery'

export function ProductSearch() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [results, setResults] = useState<Product[]>([])
  const [visible, setVisible] = useState<Product[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const compact = useMediaQuery('(max-width: 480px)')

  // Fetch whenever the query changes.
  useEffect(() => {
    searchProducts(query).then((r) => setResults(r))
  }, [query])

  // Keep the filtered list in sync.
  useEffect(() => {
    setVisible(category === 'all' ? results : results.filter((p) => p.category === category))
  }, [results, category])

  // Keep the total in sync.
  useEffect(() => {
    setTotal(visible.reduce((sum, p) => sum + p.price, 0))
  }, [visible])

  // Back to the first page when the filters change.
  useEffect(() => {
    setPage(0)
  }, [query, category])

  function openSearch() {
    setOpen(true)
    // Wait for the input to render before focusing it.
    setTimeout(() => input.current!.focus(), 300)
  }

  return (
    <section>
      <button onClick={openSearch}>Search</button>
      {open && (
        <div>
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All</option>
            <option value="drinks">Drinks</option>
            <option value="protein">Protein</option>
          </select>
          <p>
            {visible.length} results, {total.toFixed(2)} total, page {page + 1}
          </p>
          <ul className={compact ? 'compact' : ''}>
            {visible.map((p) => (
              <li key={p.id}>{p.name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
