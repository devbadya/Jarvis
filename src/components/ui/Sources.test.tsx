import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sources } from './Sources'

describe('Sources', () => {
  it('names each pill by its site and links to the page', () => {
    render(<Sources urls={['https://www.example.com/a/long/path?x=1']} />)

    const link = screen.getByRole('link', { name: 'example.com' })
    expect(link).toHaveAttribute('href', 'https://www.example.com/a/long/path?x=1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Source')).toBeInTheDocument()
  })

  it('says Sources when there is more than one', () => {
    render(<Sources urls={['https://a.example/x', 'https://b.example/y']} />)

    expect(screen.getByText('Sources')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })

  it('renders nothing when the reply cited nothing', () => {
    const { container } = render(<Sources urls={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
