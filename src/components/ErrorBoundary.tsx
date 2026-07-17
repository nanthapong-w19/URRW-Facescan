import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Catches any render-time error anywhere in the app and shows a readable
// Thai message with the actual error text, instead of the previous failure
// mode: an uncaught exception leaves the page a blank white screen with
// nothing but a console error most users never open.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('FaceIn crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500" />
          <h1 className="font-display text-xl font-bold text-foreground">เกิดข้อผิดพลาดที่ไม่คาดคิด</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            แอปพลิเคชันขัดข้องระหว่างการแสดงผล ลองรีเฟรชหน้านี้ ถ้ายังพบปัญหาเดิม กรุณาคัดลอกข้อความด้านล่างไปแจ้งทีมพัฒนา
          </p>
          <pre className="mt-2 max-w-lg overflow-auto rounded-lg bg-muted p-3 text-left text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
