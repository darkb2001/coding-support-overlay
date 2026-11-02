import { useState, useRef, useEffect, useCallback } from 'react'

interface AnnotationEditorProps {
  imagePath: string
  onSave: (annotatedImageData: string) => void
  onCancel: () => void
}

type Tool = 'pen' | 'arrow' | 'rectangle' | 'circle' | 'highlight' | 'text'

interface DrawAction {
  tool: Tool
  color: string
  lineWidth: number
  points?: { x: number; y: number }[]
  start?: { x: number; y: number }
  end?: { x: number; y: number }
  text?: string
  textPosition?: { x: number; y: number }
}

const COLORS = [
  '#f87171', // red
  '#fb923c', // orange
  '#fbbf24', // yellow
  '#4ade80', // green
  '#818cf8', // blue
  '#c084fc', // purple
  '#ffffff', // white
  '#000000'  // black
]

const LINE_WIDTHS = [2, 4, 6, 8]

export default function AnnotationEditor({ imagePath, onSave, onCancel }: AnnotationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool] = useState<Tool>('rectangle') // Fixed to rectangle only
  const [color] = useState('#f87171') // Fixed red color
  const [lineWidth] = useState(8) // Fixed line width 8px
  const [isDrawing, setIsDrawing] = useState(false)
  const [actions, setActions] = useState<DrawAction[]>([])
  const [currentAction, setCurrentAction] = useState<DrawAction | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Load image
  useEffect(() => {
    console.log('[AnnotationEditor] useEffect triggered')
    console.log('[AnnotationEditor] imagePath:', imagePath?.substring(0, 100))
    
    setIsLoading(true)
    setLoadError(null)
    
    const img = new Image()
    img.crossOrigin = 'anonymous' // For data URLs
    
    img.onload = () => {
      console.log('[AnnotationEditor] Image loaded:', img.width, 'x', img.height)
      setImage(img)
      setIsLoading(false)
      // Set canvas size to match image
      if (canvasRef.current) {
        canvasRef.current.width = img.width
        canvasRef.current.height = img.height
        console.log('[AnnotationEditor] Canvas size set:', canvasRef.current.width, 'x', canvasRef.current.height)
        redraw(img, [])
      } else {
        console.error('[AnnotationEditor] Canvas ref is null!')
      }
    }
    
    img.onerror = (e) => {
      console.error('[AnnotationEditor] Failed to load image:', e)
      setLoadError('Failed to load screenshot')
      setIsLoading(false)
    }
    
    console.log('[AnnotationEditor] Setting img.src...')
    img.src = imagePath
  }, [imagePath])

  // Redraw canvas with image and all actions
  const redraw = useCallback((img: HTMLImageElement, actionsList: DrawAction[]) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear and draw image
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)

    // Draw all actions
    actionsList.forEach(action => {
      ctx.strokeStyle = action.color
      ctx.fillStyle = action.color
      ctx.lineWidth = action.lineWidth
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      if (action.tool === 'highlight') {
        ctx.globalAlpha = 0.3
      } else {
        ctx.globalAlpha = 1
      }

      switch (action.tool) {
        case 'pen':
          if (action.points && action.points.length > 1) {
            ctx.beginPath()
            ctx.moveTo(action.points[0].x, action.points[0].y)
            action.points.forEach(p => ctx.lineTo(p.x, p.y))
            ctx.stroke()
          }
          break

        case 'arrow':
          if (action.start && action.end) {
            drawArrow(ctx, action.start, action.end, action.lineWidth)
          }
          break

        case 'rectangle':
          if (action.start && action.end) {
            const width = action.end.x - action.start.x
            const height = action.end.y - action.start.y
            ctx.strokeRect(action.start.x, action.start.y, width, height)
          }
          break

        case 'circle':
          if (action.start && action.end) {
            const radiusX = Math.abs(action.end.x - action.start.x) / 2
            const radiusY = Math.abs(action.end.y - action.start.y) / 2
            const centerX = action.start.x + (action.end.x - action.start.x) / 2
            const centerY = action.start.y + (action.end.y - action.start.y) / 2
            ctx.beginPath()
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
            ctx.stroke()
          }
          break

        case 'highlight':
          if (action.start && action.end) {
            const width = action.end.x - action.start.x
            const height = action.end.y - action.start.y
            ctx.fillRect(action.start.x, action.start.y, width, height)
          }
          break

        case 'text':
          if (action.text && action.textPosition) {
            ctx.globalAlpha = 1
            ctx.font = `bold ${action.lineWidth * 4}px system-ui, -apple-system, sans-serif`
            ctx.fillText(action.text, action.textPosition.x, action.textPosition.y)
          }
          break
      }

      ctx.globalAlpha = 1
    })
  }, [])

  // Helper: Draw arrow
  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    start: { x: number; y: number },
    end: { x: number; y: number },
    width: number
  ) => {
    const headLength = width * 3
    const angle = Math.atan2(end.y - start.y, end.x - start.x)

    // Draw line
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()

    // Draw arrow head
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(
      end.x - headLength * Math.cos(angle - Math.PI / 6),
      end.y - headLength * Math.sin(angle - Math.PI / 6)
    )
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(
      end.x - headLength * Math.cos(angle + Math.PI / 6),
      end.y - headLength * Math.sin(angle + Math.PI / 6)
    )
    ctx.stroke()
  }

  // Get mouse position relative to canvas
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e)
    setIsDrawing(true)

    const newAction: DrawAction = {
      tool: 'rectangle',
      color,
      lineWidth,
      start: pos,
      end: pos
    }

    setCurrentAction(newAction)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentAction || !image) return

    const pos = getMousePos(e)
    const updatedAction = {
      ...currentAction,
      end: pos
    }
    setCurrentAction(updatedAction)
    redraw(image, [...actions, updatedAction])
  }

  const handleMouseUp = () => {
    if (currentAction && isDrawing) {
      setActions([...actions, currentAction])
      setCurrentAction(null)
    }
    setIsDrawing(false)
  }

  // Undo
  const handleUndo = () => {
    if (actions.length === 0) return
    const newActions = actions.slice(0, -1)
    setActions(newActions)
    if (image) redraw(image, newActions)
  }

  // Clear all
  const handleClear = () => {
    setActions([])
    if (image) redraw(image, [])
  }

  // Save annotated image
  const handleSave = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dataURL = canvas.toDataURL('image/png')
    onSave(dataURL)
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0,0,0,0.95)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      {/* Toolbar - Floating at bottom */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e1e2e',
          border: '3px solid #444',
          borderRadius: 10,
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
          zIndex: 99999,
          pointerEvents: 'auto'
        }}
      >
        <button
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            console.log('[AnnotationEditor] Clear clicked')
            handleClear()
          }}
          style={{
            padding: '8px 16px',
            background: '#333',
            border: '2px solid #555',
            borderRadius: 6,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          Clear
        </button>

        <button
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            console.log('[AnnotationEditor] Undo clicked, actions:', actions.length)
            if (actions.length > 0) handleUndo()
          }}
          style={{
            padding: '8px 16px',
            background: actions.length === 0 ? '#222' : '#333',
            border: '2px solid #555',
            borderRadius: 6,
            color: actions.length === 0 ? '#666' : '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: actions.length === 0 ? 'not-allowed' : 'pointer',
            opacity: actions.length === 0 ? 0.5 : 1,
            userSelect: 'none'
          }}
        >
          ↶ Undo
        </button>

        <button
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            console.log('[AnnotationEditor] Done clicked')
            handleSave()
          }}
          style={{
            padding: '8px 20px',
            background: '#22c55e',
            border: '2px solid #16a34a',
            borderRadius: 6,
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          ✓ Done
        </button>

        <button
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            console.log('[AnnotationEditor] Cancel clicked')
            onCancel()
          }}
          style={{
            padding: '8px 20px',
            background: '#ef4444',
            border: '2px solid #dc2626',
            borderRadius: 6,
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          × Cancel
        </button>
      </div>

      {/* Canvas */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px 20px 20px',
          pointerEvents: 'auto',
          zIndex: 9999
        }}
      >
        {isLoading && (
          <div style={{
            position: 'absolute',
            color: 'var(--text-muted)',
            fontSize: 14,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            zIndex: 10
          }}>
            <div style={{
              width: 24,
              height: 24,
              border: '2px solid var(--border)',
              borderTop: '2px solid var(--accent-bright)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }} />
            Loading screenshot...
          </div>
        )}
        
        {loadError && (
          <div style={{
            position: 'absolute',
            color: '#f87171',
            fontSize: 14,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 10
          }}>
            <div>⚠️ {loadError}</div>
            <button
              onClick={onCancel}
              style={{
                padding: '6px 16px',
                background: 'rgba(248, 113, 113, 0.2)',
                border: '1px solid rgba(248, 113, 113, 0.4)',
                borderRadius: 6,
                color: '#f87171',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        )}
        
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            border: '2px solid var(--border)',
            borderRadius: 8,
            cursor: 'crosshair',
            maxWidth: '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto',
            objectFit: 'contain',
            display: isLoading || loadError ? 'none' : 'block',
            backgroundColor: '#000'
          }}
        />
      </div>
    </div>
  )
}
