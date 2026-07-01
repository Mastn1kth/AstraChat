import { useEffect, useRef } from 'react'

export default function LottieAnimation({ src, animationData, label = 'Animation' }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || (!src && !animationData)) return undefined

    let cancelled = false
    let animation = null

    import('lottie-web/build/player/lottie_light').then((module) => {
      if (cancelled || !containerRef.current) return
      const lottie = module.default || module
      animation = lottie.loadAnimation({
        container: containerRef.current,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        ...(src ? { path: src } : { animationData }),
      })
    }).catch(() => {})

    return () => {
      cancelled = true
      animation?.destroy()
    }
  }, [animationData, src])

  return (
    <span
      ref={containerRef}
      className="lottie-animation"
      data-lottie-src={src || undefined}
      role="img"
      aria-label={label}
    />
  )
}
