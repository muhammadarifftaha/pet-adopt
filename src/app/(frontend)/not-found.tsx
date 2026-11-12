import Link from 'next/link'
import React from 'react'

export default function NotFound() {
  return (
    <section className="section spacing-lg align-center">
      <div className="container prose">
        <h1>Page not found</h1>
        <p>We could not find what you were looking for.</p>
        <Link href="/pets" className="btn btn-primary">
          See adoptable pets
        </Link>
      </div>
    </section>
  )
}
