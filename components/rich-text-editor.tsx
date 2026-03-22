"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import katex from "katex"
import hljs from "highlight.js"
import {
  ArrowLeft,
  Bold,
  Code2,
  ImageIcon,
  Italic,
  List,
  ListOrdered,
  ListX,
  Pilcrow,
  Quote,
  Sigma,
  Square,
  Underline,
} from "lucide-react"
import { convertFileSrc, isTauri } from "@tauri-apps/api/core"
import { open } from "@tauri-apps/plugin-dialog"
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $getRoot,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  DecoratorNode,
  FORMAT_TEXT_COMMAND,
  createCommand,
  type EditorState,
  type LexicalCommand,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ListPlugin } from "@lexical/react/LexicalListPlugin"
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND, ListItemNode, ListNode } from "@lexical/list"
import { AutoLinkNode, LinkNode } from "@lexical/link"
import { CodeNode } from "@lexical/code"
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  type MultilineElementTransformer,
  type TextMatchTransformer,
  type Transformer,
} from "@lexical/markdown"
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode } from "@lexical/rich-text"
import { mergeRegister } from "@lexical/utils"
import { $setBlocksType } from "@lexical/selection"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type InsertImagePayload = {
  src: string
  alt: string
}

type InsertEquationPayload = {
  equation: string
  inline: boolean
}

type SerializedImageNode = Spread<
  {
    type: "wysiwyg-image"
    version: 1
    src: string
    alt: string
  },
  SerializedLexicalNode
>

type SerializedEquationNode = Spread<
  {
    type: "wysiwyg-equation"
    version: 1
    equation: string
    inline: boolean
  },
  SerializedLexicalNode
>

type SerializedCodeBlockNode = Spread<
  {
    type: "wysiwyg-code-block"
    version: 1
    code: string
    language: string
  },
  SerializedLexicalNode
>

const INSERT_IMAGE_COMMAND: LexicalCommand<InsertImagePayload> = createCommand("INSERT_IMAGE_COMMAND")
const INSERT_EQUATION_COMMAND: LexicalCommand<InsertEquationPayload> = createCommand("INSERT_EQUATION_COMMAND")

class ImageNode extends DecoratorNode<React.JSX.Element> {
  __src: string
  __alt: string

  static getType(): string {
    return "wysiwyg-image"
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.__key)
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return new ImageNode(serializedNode.src, serializedNode.alt)
  }

  constructor(src: string, alt: string, key?: NodeKey) {
    super(key)
    this.__src = src
    this.__alt = alt
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      type: "wysiwyg-image",
      version: 1,
      src: this.__src,
      alt: this.__alt,
    }
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    span.className = "block"
    return span
  }

  updateDOM(): false {
    return false
  }

  isInline(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return (
      <figure className="my-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={this.__src} alt={this.__alt} className="h-auto w-full rounded-md object-contain" />
        {this.__alt ? <figcaption className="mt-2 text-sm text-muted-foreground">{this.__alt}</figcaption> : null}
      </figure>
    )
  }
}

class EquationNode extends DecoratorNode<React.JSX.Element> {
  __equation: string
  __inline: boolean

  static getType(): string {
    return "wysiwyg-equation"
  }

  static clone(node: EquationNode): EquationNode {
    return new EquationNode(node.__equation, node.__inline, node.__key)
  }

  static importJSON(serializedNode: SerializedEquationNode): EquationNode {
    return new EquationNode(serializedNode.equation, serializedNode.inline)
  }

  constructor(equation: string, inline: boolean, key?: NodeKey) {
    super(key)
    this.__equation = equation
    this.__inline = inline
  }

  exportJSON(): SerializedEquationNode {
    return {
      ...super.exportJSON(),
      type: "wysiwyg-equation",
      version: 1,
      equation: this.__equation,
      inline: this.__inline,
    }
  }

  createDOM(): HTMLElement {
    return document.createElement(this.__inline ? "span" : "div")
  }

  updateDOM(): false {
    return false
  }

  isInline(): boolean {
    return this.__inline
  }

  decorate(): React.JSX.Element {
    return <EquationView nodeKey={this.getKey()} equation={this.__equation} inline={this.__inline} />
  }

  setEquation(equation: string): this {
    const writable = this.getWritable()
    writable.__equation = equation
    return writable
  }

  setInline(inline: boolean): this {
    const writable = this.getWritable()
    writable.__inline = inline
    return writable
  }
}

class CodeBlockNode extends DecoratorNode<React.JSX.Element> {
  __code: string
  __language: string

  static getType(): string {
    return "wysiwyg-code-block"
  }

  static clone(node: CodeBlockNode): CodeBlockNode {
    return new CodeBlockNode(node.__code, node.__language, node.__key)
  }

  static importJSON(serializedNode: SerializedCodeBlockNode): CodeBlockNode {
    return new CodeBlockNode(serializedNode.code, serializedNode.language)
  }

  constructor(code: string, language: string, key?: NodeKey) {
    super(key)
    this.__code = code
    this.__language = language
  }

  exportJSON(): SerializedCodeBlockNode {
    return {
      ...super.exportJSON(),
      type: "wysiwyg-code-block",
      version: 1,
      code: this.__code,
      language: this.__language,
    }
  }

  createDOM(): HTMLElement {
    return document.createElement("div")
  }

  updateDOM(): false {
    return false
  }

  isInline(): false {
    return false
  }

  decorate(): React.JSX.Element {
    return <CodeBlockView nodeKey={this.getKey()} code={this.__code} language={this.__language} />
  }

  setCode(code: string): this {
    const writable = this.getWritable()
    writable.__code = code
    return writable
  }

  setLanguage(language: string): this {
    const writable = this.getWritable()
    writable.__language = language
    return writable
  }
}

function $createImageNode(src: string, alt: string): ImageNode {
  return new ImageNode(src, alt)
}

function $createEquationNode(equation: string, inline: boolean): EquationNode {
  return new EquationNode(equation, inline)
}

function $createCodeBlockNode(code: string, language: string): CodeBlockNode {
  return new CodeBlockNode(code, language)
}

function $isEquationNode(node: unknown): node is EquationNode {
  return node instanceof EquationNode
}

function $isCodeBlockNode(node: unknown): node is CodeBlockNode {
  return node instanceof CodeBlockNode
}

const IMAGE_TRANSFORMER: TextMatchTransformer = {
  type: "text-match",
  dependencies: [ImageNode],
  trigger: ")",
  regExp: /!\[([^\]]*)\]\(([^)]+)\)$/,
  importRegExp: /!\[([^\]]*)\]\(([^)]+)\)/,
  replace: (textNode, match) => {
    const alt = match[1] ?? ""
    const src = match[2] ?? ""
    textNode.replace($createImageNode(src, alt))
  },
  export: (node) => {
    if (!(node instanceof ImageNode)) {
      return null
    }
    return `![${node.__alt}](${node.__src})`
  },
}

const INLINE_EQUATION_TRANSFORMER: TextMatchTransformer = {
  type: "text-match",
  dependencies: [EquationNode],
  trigger: "$",
  regExp: /\$([^$\n]+)\$$/,
  importRegExp: /\$([^$\n]+)\$/,
  replace: (textNode, match) => {
    const equation = (match[1] ?? "").trim()
    textNode.replace($createEquationNode(equation || "x", true))
  },
  export: (node) => {
    if (!(node instanceof EquationNode) || !node.__inline) {
      return null
    }
    return `$${node.__equation}$`
  },
}

const BLOCK_EQUATION_TRANSFORMER: MultilineElementTransformer = {
  type: "multiline-element",
  dependencies: [EquationNode],
  regExpStart: /^\$\$\s*$/,
  regExpEnd: /^\$\$\s*$/,
  replace: (rootNode, _children, _startMatch, _endMatch, linesInBetween) => {
    const equation = (linesInBetween ?? []).join("\n").trim() || "x"
    rootNode.append($createEquationNode(equation, false))
    rootNode.append($createParagraphNode())
  },
  export: (node) => {
    if (!(node instanceof EquationNode) || node.__inline) {
      return null
    }
    return `$$\n${node.__equation}\n$$`
  },
}

const MARKDOWN_TRANSFORMERS: Transformer[] = [
  ...TRANSFORMERS,
  IMAGE_TRANSFORMER,
  INLINE_EQUATION_TRANSFORMER,
  BLOCK_EQUATION_TRANSFORMER,
]

function EquationView({
  nodeKey,
  equation,
  inline,
}: {
  nodeKey: NodeKey
  equation: string
  inline: boolean
}) {
  const [editor] = useLexicalComposerContext()
  const [editing, setEditing] = React.useState(false)
  const [draftEquation, setDraftEquation] = React.useState(equation)
  const [draftInline, setDraftInline] = React.useState(inline)

  React.useEffect(() => {
    if (!editing) {
      setDraftEquation(equation)
      setDraftInline(inline)
    }
  }, [equation, inline, editing])

  const html = React.useMemo(() => {
    try {
      return katex.renderToString(draftEquation, {
        throwOnError: false,
        displayMode: !draftInline,
      })
    } catch {
      return ""
    }
  }, [draftEquation, draftInline])

  const save = React.useCallback(() => {
    const normalized = draftEquation.trim() || "x"
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isEquationNode(node)) {
        node.setEquation(normalized)
        node.setInline(draftInline)
      }
    })
    setEditing(false)
  }, [draftEquation, draftInline, editor, nodeKey])

  if (editing) {
    return (
      <div className={draftInline ? "inline-block align-middle" : "my-4 block"}>
        <div className="w-[min(560px,90vw)] space-y-3 rounded-md border bg-background p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={draftInline ? "default" : "outline"}
              onClick={() => setDraftInline(true)}
            >
              Inline
            </Button>
            <Button
              size="sm"
              variant={!draftInline ? "default" : "outline"}
              onClick={() => setDraftInline(false)}
            >
              Block
            </Button>
          </div>
          <Textarea
            value={draftEquation}
            onChange={(event) => setDraftEquation(event.target.value)}
            className="min-h-24 font-mono text-sm"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={save}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!html) {
    return (
      <button
        type="button"
        className="rounded bg-muted px-1 py-0.5 text-left"
        onClick={() => setEditing(true)}
      >
        {equation}
      </button>
    )
  }

  return (
    <button
      type="button"
      className={draftInline ? "mx-0.5 inline-block align-middle" : "my-4 block w-full overflow-x-auto text-center"}
      onClick={() => setEditing(true)}
      title="Edit equation"
    >
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </button>
  )
}

function CodeBlockView({
  nodeKey,
  code,
  language,
}: {
  nodeKey: NodeKey
  code: string
  language: string
}) {
  const [editor] = useLexicalComposerContext()
  const [editing, setEditing] = React.useState(false)
  const [draftCode, setDraftCode] = React.useState(code)
  const [draftLanguage, setDraftLanguage] = React.useState(language)

  React.useEffect(() => {
    if (!editing) {
      setDraftCode(code)
      setDraftLanguage(language)
    }
  }, [code, language, editing])

  const highlighted = React.useMemo(() => {
    const source = draftCode || ""
    try {
      if (draftLanguage && hljs.getLanguage(draftLanguage)) {
        return hljs.highlight(source, { language: draftLanguage }).value
      }
      return hljs.highlightAuto(source).value
    } catch {
      return source
    }
  }, [draftCode, draftLanguage])

  const save = React.useCallback(() => {
    const normalizedCode = draftCode.trim() || "// code"
    const normalizedLanguage = draftLanguage.trim() || "plaintext"
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isCodeBlockNode(node)) {
        node.setCode(normalizedCode)
        node.setLanguage(normalizedLanguage)
      }
    })
    setEditing(false)
  }, [draftCode, draftLanguage, editor, nodeKey])

  if (editing) {
    return (
      <div className="my-4 space-y-3 rounded-md border bg-background p-3 shadow-sm">
        <Input
          value={draftLanguage}
          onChange={(event) => setDraftLanguage(event.target.value)}
          placeholder="language (e.g. javascript)"
          className="h-9"
        />
        <Textarea
          value={draftCode}
          onChange={(event) => setDraftCode(event.target.value)}
          className="min-h-36 font-mono text-sm"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      className="my-4 block w-full overflow-hidden rounded-lg bg-muted/30 text-left"
      onClick={() => setEditing(true)}
      title="Edit code block"
    >
      <div className="border-b px-3 py-1 text-xs text-muted-foreground">{language || "plaintext"}</div>
      <pre className="overflow-x-auto px-3 py-3 text-sm">
        <code className={`hljs language-${language || "plaintext"}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </button>
  )
}

function InsertMediaPlugin() {
  const [editor] = useLexicalComposerContext()

  React.useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        INSERT_IMAGE_COMMAND,
        ({ src, alt }) => {
          editor.update(() => {
            let selection = $getSelection()
            if (!$isRangeSelection(selection)) {
              $getRoot().selectEnd()
              selection = $getSelection()
            }
            if (!$isRangeSelection(selection)) {
              return
            }
            $insertNodes([$createImageNode(src, alt), $createParagraphNode()])
          })
          return true
        },
        COMMAND_PRIORITY_EDITOR
      ),
      editor.registerCommand(
        INSERT_EQUATION_COMMAND,
        ({ equation, inline }) => {
          editor.update(() => {
            let selection = $getSelection()
            if (!$isRangeSelection(selection)) {
              $getRoot().selectEnd()
              selection = $getSelection()
            }
            if (!$isRangeSelection(selection)) {
              return
            }
            if (inline) {
              selection.insertNodes([$createEquationNode(equation, true)])
              return
            }
            $insertNodes([$createEquationNode(equation, false), $createParagraphNode()])
          })
          return true
        },
        COMMAND_PRIORITY_EDITOR
      )
    )
  }, [editor])

  return null
}

function MarkdownSyncPlugin({ markdown, docKey }: { markdown: string; docKey: string }) {
  const [editor] = useLexicalComposerContext()

  React.useEffect(() => {
    editor.update(() => {
      $convertFromMarkdownString(markdown ?? "", MARKDOWN_TRANSFORMERS)
    })
  }, [docKey, editor, markdown])

  return null
}

const theme = {
  paragraph: "mb-2",
  text: {
    bold: "font-semibold",
    italic: "italic",
    underline: "underline",
  },
  heading: {
    h1: "text-2xl font-semibold mb-2",
    h2: "text-xl font-semibold mb-2",
    h3: "text-lg font-semibold mb-2",
    h4: "text-base font-semibold mb-2",
    h5: "text-sm font-semibold mb-2",
    h6: "text-sm font-medium uppercase tracking-wide mb-2 text-muted-foreground",
  },
  quote: "border-l-2 border-border pl-3 italic text-muted-foreground",
  list: {
    ul: "list-disc ml-6",
    ol: "list-decimal ml-6",
    listitem: "mb-1",
  },
}

function Toolbar() {
  const [editor] = useLexicalComposerContext()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [headingValue, setHeadingValue] = React.useState("paragraph")
  const [showImageUrlDialog, setShowImageUrlDialog] = React.useState(false)
  const [imageUrl, setImageUrl] = React.useState("")
  const [imageAlt, setImageAlt] = React.useState("")

  const formatBlock = React.useCallback(
    (kind: "paragraph" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "quote") => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          return
        }
        if (kind === "paragraph") {
          $setBlocksType(selection, () => $createParagraphNode())
          return
        }
        if (kind === "quote") {
          $setBlocksType(selection, () => $createQuoteNode())
          return
        }
        $setBlocksType(selection, () => $createHeadingNode(kind))
      })
    },
    [editor]
  )

  const insertImageByValue = React.useCallback(
    (url: string, alt: string) => {
      const normalizedUrl = url.trim()
      if (!normalizedUrl) {
        return
      }
      editor.dispatchCommand(INSERT_IMAGE_COMMAND, { src: normalizedUrl, alt })
      editor.focus()
    },
    [editor]
  )

  const insertImageFromUrl = React.useCallback(() => {
    if (!imageUrl.trim()) {
      return
    }
    insertImageByValue(imageUrl, imageAlt)
    setShowImageUrlDialog(false)
    setImageUrl("")
    setImageAlt("")
  }, [imageAlt, imageUrl, insertImageByValue])

  const insertImageFromLocal = React.useCallback(async () => {
    if (isTauri()) {
      const selected = await open({
        title: "Choose an image",
        multiple: false,
        filters: [
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
          },
        ],
      })
      if (!selected || Array.isArray(selected)) {
        return
      }
      const fileName = selected.split("/").pop()?.split(".")[0] ?? ""
      insertImageByValue(convertFileSrc(selected), fileName)
      return
    }
    fileInputRef.current?.click()
  }, [insertImageByValue])

  const onNativeFileChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }
      const src = URL.createObjectURL(file)
      const alt = file.name.replace(/\.[^.]+$/, "")
      insertImageByValue(src, alt)
      event.target.value = ""
    },
    [insertImageByValue]
  )

  const insertEquation = React.useCallback(
    (inline: boolean) => {
      const input = inline ? "E=mc^2" : "\\int_a^b f(x)\\,dx"
      editor.update(() => {
        let selection = $getSelection()
        if (!$isRangeSelection(selection)) {
          $getRoot().selectEnd()
          selection = $getSelection()
        }
        if (!$isRangeSelection(selection)) {
          return
        }
        if (inline) {
          selection.insertNodes([$createEquationNode(input, true)])
          return
        }
        $insertNodes([$createEquationNode(input, false), $createParagraphNode()])
      })
      editor.focus()
    },
    [editor]
  )

  const insertCodeBlock = React.useCallback(() => {
    editor.update(() => {
      let selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        $getRoot().selectEnd()
        selection = $getSelection()
      }
      if (!$isRangeSelection(selection)) {
        return
      }
      $insertNodes([$createCodeBlockNode("// write code here", "javascript"), $createParagraphNode()])
    })
    editor.focus()
  }, [editor])

  const headingLabel = React.useMemo(() => {
    if (headingValue === "paragraph") {
      return "P"
    }
    return headingValue.toUpperCase()
  }, [headingValue])

  return (
    <div className="sticky top-0 z-10 px-4 py-3 md:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-background/90 px-4 py-3 shadow-[0_14px_30px_-22px_rgba(0,0,0,0.72)] backdrop-blur dark:shadow-[0_18px_36px_-22px_rgba(0,0,0,0.9)]">
          <Button size="icon" variant="ghost" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")} aria-label="Bold" title="Bold">
            <Bold className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")} aria-label="Italic" title="Italic">
            <Italic className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")} aria-label="Underline" title="Underline">
            <Underline className="size-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs">
                {headingLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => {
                  setHeadingValue("paragraph")
                  formatBlock("paragraph")
                }}
              >
                Paragraph
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setHeadingValue("h1"); formatBlock("h1") }}>H1</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setHeadingValue("h2"); formatBlock("h2") }}>H2</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setHeadingValue("h3"); formatBlock("h3") }}>H3</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setHeadingValue("h4"); formatBlock("h4") }}>H4</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setHeadingValue("h5"); formatBlock("h5") }}>H5</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setHeadingValue("h6"); formatBlock("h6") }}>H6</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon" variant="ghost" onClick={() => formatBlock("quote")} aria-label="Quote" title="Quote">
            <Quote className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => formatBlock("paragraph")} aria-label="Paragraph" title="Paragraph">
            <Pilcrow className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} aria-label="Bullet list" title="Bullet list">
            <List className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} aria-label="Numbered list" title="Numbered list">
            <ListOrdered className="size-4" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined)} aria-label="Clear list" title="Clear list">
            <ListX className="size-4" />
          </Button>
      <Button size="icon" variant="ghost" onClick={() => insertEquation(true)} aria-label="LaTeX inline" title="LaTeX inline">
        <Sigma className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" onClick={() => insertEquation(false)} aria-label="LaTeX block" title="LaTeX block">
        <Square className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" onClick={insertCodeBlock} aria-label="Code block" title="Code block">
        <Code2 className="size-4" />
      </Button>
      <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label="Image" title="Image">
                <ImageIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setShowImageUrlDialog(true)}>From URL</DropdownMenuItem>
              <DropdownMenuItem onClick={insertImageFromLocal}>From File</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog
            open={showImageUrlDialog}
            onOpenChange={(open) => {
              setShowImageUrlDialog(open)
              if (!open) {
                setImageUrl("")
                setImageAlt("")
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Insert Image From URL</DialogTitle>
              </DialogHeader>
              <Input
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="https://example.com/image.png"
                className="h-9"
              />
              <Input
                value={imageAlt}
                onChange={(event) => setImageAlt(event.target.value)}
                placeholder="Alt text"
                className="h-9"
              />
              <DialogFooter>
                <Button size="sm" variant="ghost" onClick={() => setShowImageUrlDialog(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={insertImageFromUrl}>
                  Insert
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onNativeFileChange}
          />
        </div>
      </div>
    </div>
  )
}

type RichTextEditorProps = {
  initialTitle?: string
  initialMarkdown?: string
  docKey?: string
  onChange?: (editorState: string) => void
  onTitleChange?: (title: string) => void
  onMarkdownChange?: (markdown: string) => void
  topActions?: React.ReactNode
  onBack?: () => void
}

export function RichTextEditor({
  initialTitle = "",
  initialMarkdown = "",
  docKey = "default",
  onChange,
  onTitleChange,
  onMarkdownChange,
  topActions,
  onBack,
}: RichTextEditorProps) {
  const router = useRouter()
  const [title, setTitle] = React.useState(initialTitle)

  React.useEffect(() => {
    setTitle(initialTitle)
  }, [initialTitle])
  const initialConfig = React.useMemo(
    () => ({
      namespace: "hero-rich-text-editor",
      theme,
      nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, ImageNode, EquationNode, CodeBlockNode],
      onError(error: Error) {
        throw error
      },
    }),
    []
  )

  const handleChange = React.useCallback(
    (editorState: EditorState) => {
      if (!onChange) {
        if (onMarkdownChange) {
          editorState.read(() => {
            onMarkdownChange($convertToMarkdownString(MARKDOWN_TRANSFORMERS))
          })
        }
        return
      }
      onChange(JSON.stringify(editorState.toJSON()))
      if (onMarkdownChange) {
        editorState.read(() => {
          onMarkdownChange($convertToMarkdownString(MARKDOWN_TRANSFORMERS))
        })
      }
    },
    [onChange, onMarkdownChange]
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex items-center gap-2 px-4 pt-3 md:px-6">
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => {
              if (onBack) {
                onBack()
                return
              }
              if (window.history.length > 1) {
                router.back()
              } else {
                router.push("/list")
              }
            }}
          >
            <ArrowLeft className="size-4" />
            <span>Back</span>
          </Button>
          {topActions ? <div className="ml-auto">{topActions}</div> : null}
        </div>
        <div className="px-4 pb-2 md:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                onTitleChange?.(event.target.value)
              }}
              placeholder="Untitled"
              className="h-20 w-full border-0 bg-transparent px-2 md:px-3 text-[40px] md:text-[40px] font-semibold leading-[1.05] tracking-tight outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
        <Toolbar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative mx-auto w-full max-w-3xl px-8 py-10">
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="min-h-[calc(100svh-230px)] text-[17px] leading-8 outline-none"
                  aria-label="Rich text editor"
                />
              }
              placeholder={
                <div className="pointer-events-none absolute top-10 text-base text-muted-foreground">
                  Start writing your post...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <ListPlugin />
            <MarkdownSyncPlugin markdown={initialMarkdown} docKey={docKey} />
            <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
            <InsertMediaPlugin />
            <OnChangePlugin onChange={handleChange} />
          </div>
          <div className="h-12" />
        </div>
      </div>
    </LexicalComposer>
  )
}
