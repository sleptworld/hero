import { Suspense } from "react"
import "katex/dist/katex.min.css"
import "highlight.js/styles/github.css"
import { EditorWorkspace } from "@/components/editor-workspace"

export default function Page() {
  return (
    <Suspense fallback={<main className="h-svh min-h-svh bg-background" />}>
      <EditorWorkspace />
    </Suspense>
  )
}
