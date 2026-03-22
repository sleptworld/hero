"use client"

import * as React from "react"
import { EditorState } from "lexical"
import { AutoLinkNode, LinkNode } from "@lexical/link"
import { ListItemNode, ListNode } from "@lexical/list"
import { TRANSFORMERS, $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { CodeNode } from "@lexical/code"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"

const editorTheme = {
  paragraph: "mb-2",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
  },
  heading: {
    h1: "text-2xl font-semibold",
    h2: "text-xl font-semibold",
    h3: "text-lg font-semibold",
  },
  quote: "border-l-2 border-border pl-3 italic text-muted-foreground",
  list: {
    ul: "list-disc ml-6",
    ol: "list-decimal ml-6",
    listitem: "mb-1",
  },
  link: "text-primary underline",
  code: "rounded bg-muted px-1.5 py-0.5 font-mono text-sm",
}

function MarkdownSyncPlugin({
  markdown,
  readOnly,
}: {
  markdown: string
  readOnly: boolean
}) {
  const [editor] = useLexicalComposerContext()
  const lastMarkdownRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  React.useEffect(() => {
    if (lastMarkdownRef.current === markdown) {
      return
    }
    editor.update(() => {
      $convertFromMarkdownString(markdown ?? "", TRANSFORMERS)
    })
    lastMarkdownRef.current = markdown
  }, [editor, markdown])

  return null
}

type MarkdownLexicalProps = {
  markdown: string
  onMarkdownChange?: (value: string) => void
  readOnly?: boolean
  placeholder?: string
}

export function MarkdownLexical({
  markdown,
  onMarkdownChange,
  readOnly = false,
  placeholder = "Write your markdown content...",
}: MarkdownLexicalProps) {
  const initialConfig = React.useMemo(
    () => ({
      namespace: readOnly ? "hexo-markdown-preview" : "hexo-markdown-editor",
      theme: editorTheme,
      editable: !readOnly,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode],
      onError(error: Error) {
        throw error
      },
    }),
    [readOnly]
  )

  const handleChange = React.useCallback(
    (editorState: EditorState) => {
      if (!onMarkdownChange || readOnly) {
        return
      }
      editorState.read(() => {
        onMarkdownChange($convertToMarkdownString(TRANSFORMERS))
      })
    },
    [onMarkdownChange, readOnly]
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className={`rounded-lg ${readOnly ? "bg-muted/20" : "bg-background"} p-4`}>
        <RichTextPlugin
          contentEditable={
            <ContentEditable className="min-h-[420px] outline-none" aria-label="Markdown editor" />
          }
          placeholder={
            <div className="pointer-events-none absolute text-sm text-muted-foreground">
              {placeholder}
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        {!readOnly ? <HistoryPlugin /> : null}
        {!readOnly ? <MarkdownShortcutPlugin transformers={TRANSFORMERS} /> : null}
        <MarkdownSyncPlugin markdown={markdown} readOnly={readOnly} />
        {!readOnly ? <OnChangePlugin onChange={handleChange} /> : null}
      </div>
    </LexicalComposer>
  )
}
