import { search } from './engine/search.js'

try {
  console.log('Starting search test...')
  const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  const result = search(fen, 3, 1000, (info) => {
    console.log(`Depth ${info.depth}: best move=${info.move?.san || info.move}, score=${info.score}, nodes=${info.nodes}`)
  })
  console.log('Search completed successfully!')
  console.log('Result:', result)
} catch (err) {
  console.error('Search threw an error:', err)
}
