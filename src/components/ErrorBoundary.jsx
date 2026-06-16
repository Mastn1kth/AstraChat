import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ui] render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="error-boundary" role="alert">
        <section>
          <div className="error-boundary-mark">!</div>
          <h1>Something went wrong</h1>
          <p>The interface hit a rendering error. Reload the app to start from a clean state.</p>
          <button onClick={() => window.location.reload()}>Reload app</button>
        </section>
      </main>
    )
  }
}
